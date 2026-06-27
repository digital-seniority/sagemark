"use client";

/**
 * Operator sign-in page (DR-003, lane auth) — email + PASSWORD.
 *
 * THE FRONT DOOR. `requireOperator()` redirects an unauthenticated request here.
 * The form calls `signInWithPassword({ email, password })`; on success the
 * `@supabase/ssr` browser client writes the cookie session and we navigate to `/`,
 * where the server reads it via `getUser()` (the proxy refreshes it per request).
 *
 * WHY PASSWORD (not magic-link): Supabase's built-in email service is rate-limited
 * to a few magic-links/hour, which blocks onboarding. Password sign-in sends NO
 * email. Operators are provisioned in the Supabase dashboard (Auth -> Users -> Add
 * user, "Auto Confirm") so there is no signup email either. The `/auth/callback`
 * code-exchange route is retained (harmless) for a future magic-link path.
 *
 * The browser client never persists a credential beyond the Supabase session
 * cookie; the password is sent once over TLS to Supabase Auth and not stored here.
 *
 * Colours/spacing come from the `globals.css` tokens (`--foreground`/`--background`
 * via `currentColor` + opacity) — NO hardcoded palette. Clean ASCII / UTF-8.
 */

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

type Status =
  | { kind: "idle" }
  | { kind: "signing-in" }
  | { kind: "error"; message: string };

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  opacity: 0.6,
  marginBottom: 6,
};

const FIELD: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  fontSize: 16,
  color: "var(--foreground)",
  background: "var(--background)",
  border: "1px solid currentColor",
  borderRadius: 8,
  outline: "none",
};

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) return;

    setStatus({ kind: "signing-in" });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }
      // Session cookie is set by the browser client; the server resolves the
      // operator on the next request. Full navigation so the server re-reads it.
      window.location.assign("/");
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not sign in.",
      });
    }
  }

  const busy = status.kind === "signing-in";

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "6rem 1.5rem" }}>
      <p
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 12,
          opacity: 0.6,
        }}
      >
        SEO Creator
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>Sign in</h1>

      <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
        <p style={{ fontSize: 15, opacity: 0.8, marginBottom: 16 }}>
          Enter your operator email and password.
        </p>

        <label htmlFor="email" style={LABEL}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="you@example.com"
          style={{ ...FIELD, opacity: busy ? 0.6 : 1 }}
        />

        <label htmlFor="password" style={{ ...LABEL, marginTop: 16 }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          placeholder="Your password"
          style={{ ...FIELD, opacity: busy ? 0.6 : 1 }}
        />

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "0.6rem 0.75rem",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--background)",
            background: "var(--foreground)",
            border: "1px solid currentColor",
            borderRadius: 8,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        {status.kind === "error" ? (
          <p role="alert" style={{ marginTop: 12, fontSize: 14, opacity: 0.85 }}>
            {status.message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
