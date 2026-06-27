/**
 * Session-refresh PROXY (DR-003, lane auth).
 *
 * NEXT 16 NOTE — this is the file the Supabase SSR guides call "middleware". In
 * Next.js 16 the `middleware` convention was RENAMED to `proxy` (deprecation in
 * `node_modules/next/dist/docs/.../version-16.md`: "The `middleware` filename is
 * deprecated, and has been renamed to `proxy`"). The proxy runs on the `nodejs`
 * runtime (the old edge-only middleware limitation no longer applies), which is
 * exactly what `@supabase/ssr` needs. Same job, current filename.
 *
 * WHAT IT DOES. On every matched request it re-binds a cookie-aware Supabase client
 * to the request/response and calls `supabase.auth.getUser()`. That call refreshes
 * an expiring session and writes the rotated cookies back onto the response, so the
 * downstream Server Components / route handlers (which only READ cookies) always
 * see a FRESH session. Without this, a server read could see a stale/expired token
 * and spuriously treat the operator as signed-out (the documented SSR failure
 * mode). It performs NO authorization/redirect itself — the studio chokepoint
 * `requireOperator()` is the gate; the proxy only keeps the session warm
 * (per the Next "optimistic checks, not full auth" guidance).
 *
 * FAIL-OPEN ON REFRESH ONLY (not on auth). If the host has no public Supabase creds
 * the proxy is a transparent pass-through (the server reads then fail-closed to "no
 * operator" and the guard redirects) — the proxy never blocks traffic on a config
 * gap. It is NOT an auth decision point; it cannot grant access.
 *
 * ENV CONTRACT (DR-015): `NEXT_PUBLIC_SUPABASE_URL` +
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Clean ASCII / UTF-8.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // No creds -> transparent pass-through (the proxy is not an auth gate).
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror the refreshed cookies onto BOTH the request (so any further read
        // in this pass sees them) and a fresh response (so the browser receives the
        // Set-Cookie). Rebuilding the response from `request` is the documented
        // @supabase/ssr pattern.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: this `getUser()` call is what triggers the token refresh + the
  // `setAll` write above. Do not remove it, and do not run logic between creating
  // the client and calling it.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on every path EXCEPT Next static assets, image optimizer, the favicon, and
  // common static image types — those never carry an auth session and refreshing on
  // them is wasted work.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
