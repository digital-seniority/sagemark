/**
 * Magic-link CALLBACK route (DR-003, lane auth) — the code-exchange handler.
 *
 * THE SESSION HANDSHAKE. The Supabase magic link returns the operator to
 * `/auth/callback?code=<pkce-code>`. This Route Handler exchanges that code for a
 * cookie session via `supabase.auth.exchangeCodeForSession(code)` — and because the
 * server client's `setAll` writes through `next/headers` `cookies()` (writable in a
 * Route Handler, unlike a Server Component render), the refreshed session cookies
 * are SET on the response here. It then redirects to `/`, now authenticated, where
 * `requireOperator()` passes.
 *
 * `next` (optional query param) lets a future deep-link return the operator to the
 * page they were headed to; it is constrained to a SAME-ORIGIN relative path
 * (leading `/`, not `//`) so the callback can never be turned into an open
 * redirect. Default target is `/`.
 *
 * FAIL-CLOSED: a missing/empty code, or an exchange error, redirects to
 * `/sign-in?error=...` (no session established) rather than silently landing on a
 * studio surface. The studio guard then sends them back to sign-in anyway, but the
 * explicit redirect is clearer.
 *
 * Per the documented Supabase Next App-Router pattern. Clean ASCII / UTF-8.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

/** Constrain `next` to a same-origin relative path (no open-redirect). */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  // Must be a relative path rooted at "/" and NOT protocol-relative ("//host").
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing-code`);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    // Host not configured (no public Supabase creds) — cannot establish a session.
    return NextResponse.redirect(`${origin}/sign-in?error=not-configured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange-failed`);
  }

  // Session cookies were written via the server client's `setAll` (cookies() is
  // writable in a Route Handler). Land the now-authenticated operator on the app.
  return NextResponse.redirect(`${origin}${next}`);
}
