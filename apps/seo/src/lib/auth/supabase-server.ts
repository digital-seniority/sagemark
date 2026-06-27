/**
 * Cookie-bound SERVER Supabase client factory (DR-003, lane auth).
 *
 * THE OPERATOR-SESSION READER. This is the anon/publishable-key Supabase client
 * the host uses to read the CURRENT operator's session out of the request cookies
 * — the `@supabase/ssr` `createServerClient` wired to `next/headers` `cookies()`,
 * the documented Next-App-Router pattern. It is the ONLY way the auth seam
 * (`apps/seo/src/lib/auth.ts`) learns "who is signed in": `supabase.auth.getUser()`
 * re-validates the cookie session against Supabase Auth on every call (never a
 * decode-only `getSession`).
 *
 * NOT the service-role client. This client carries the PUBLISHABLE (anon) key and
 * is subject to RLS — it can ONLY ever see the signed-in operator's own session.
 * The workspace/membership resolution that derives tenancy uses the SEPARATE
 * service-role client (`getCurrentWorkspace` in auth.ts), never this one. Keeping
 * the two apart is load-bearing: a session read must never be able to widen into a
 * cross-tenant data read.
 *
 * COOKIE WRITE SAFETY (the documented SSR caveat). In a Server Component, Next
 * forbids writing cookies during render — so `setAll` is wrapped in a try/catch
 * and a write there is a NO-OP. That is SAFE because the `proxy.ts` session-refresh
 * runs on every request and writes the refreshed cookies back; the Server-Component
 * client only ever READS. In a Route Handler / Server Action (the `auth/callback`
 * route), the cookie store IS writable, so `setAll` lands the session there.
 *
 * ENV CONTRACT (DR-015): `NEXT_PUBLIC_SUPABASE_URL` +
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_…` anon key). Both are
 * public by design. Read lazily so importing this module is cred-free.
 *
 * Next 16: `cookies()` is ASYNC (await it). Clean ASCII / UTF-8.
 */

import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The public Supabase creds the cookie-bound server client needs. Returns null
 * when either is absent so callers can fail-closed (no session ⇒ no operator)
 * rather than throw on a misconfigured host.
 */
export function readPublicSupabaseCreds(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Build a request-scoped, cookie-bound Supabase client, or null when the host is
 * not configured. NEVER cache/share the returned client across requests — each
 * render/request binds its own `cookies()` store (the documented SSR rule).
 *
 * `getAll` reads the incoming request cookies; `setAll` writes refreshed session
 * cookies back where allowed (Route Handler / Server Action) and is a safe no-op
 * during Server-Component render (the proxy handles the refresh write there).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const creds = readPublicSupabaseCreds();
  if (!creds) return null;

  const cookieStore = await cookies();

  return createServerClient(creds.url, creds.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookie writes are
          // forbidden. Safe to ignore: `proxy.ts` refreshes the session and
          // writes the cookies back on every request.
        }
      },
    },
  });
}
