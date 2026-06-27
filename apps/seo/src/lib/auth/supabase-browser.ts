/**
 * BROWSER Supabase client factory (DR-003, lane auth).
 *
 * THE SIGN-IN CLIENT. This is the anon/publishable-key Supabase client the
 * client-side sign-in form (`app/sign-in/page.tsx`) uses to call
 * `supabase.auth.signInWithOtp(...)` — the email magic-link request. It is a
 * `@supabase/ssr` `createBrowserClient`, which manages the auth cookies itself
 * (no custom cookie methods needed in the browser), so the session the magic-link
 * callback establishes is shared with the cookie-bound SERVER client.
 *
 * NO secrets: only the PUBLIC `NEXT_PUBLIC_*` creds (URL + publishable key) ever
 * reach the browser bundle. There is no password path and no service-role key
 * here — the only operation this client performs is requesting a magic link.
 *
 * ENV CONTRACT (DR-015): `NEXT_PUBLIC_SUPABASE_URL` +
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both are inlined at build time by Next
 * because of the `NEXT_PUBLIC_` prefix. Clean ASCII / UTF-8.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Build the browser Supabase client. Throws a clear error if the public creds are
 * missing — a sign-in page with no Supabase URL/key is a misconfiguration the
 * operator must see, not a silent no-op.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "createSupabaseBrowserClient: missing NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return createBrowserClient(url, anonKey);
}
