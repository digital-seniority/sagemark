"use client";

/**
 * Operator sign-in page (DR-003, lane auth) — email MAGIC LINK only, no password.
 *
 * THE FRONT DOOR. `requireOperator()` redirects an unauthenticated request here.
 * The form requests a Supabase magic link via `signInWithOtp({ email, options: {
 * emailRedirectTo: <origin>/auth/callback } })`; the operator clicks the emailed
 * link, lands on `/auth/callback` (the code-exchange route), and is redirected to
 * `/` with a cookie session established. There is NO password field and no
 * credential ever stored client-side — the browser client only ever requests a
 * link.
 *
 * `emailRedirectTo` is derived from `window.location.origin` at click time so the
 * link returns to the SAME host the operator signed in from (localhost in dev, the
 * deployed origin in prod) — James enabled `/auth/callback` as an allowed redirect.
 *
 * Colours/spacing come from the `globals.css` tokens (`--foreground`/`--background`
 * via `currentColor` + opacity) — NO hardcoded palette. Clean ASCII / UTF-8.
 */

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus({ kind: "sending" });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }
      setStatus({ kind: "sent" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not send the link.",
      });
    }
  }

  const sending = status.kind === "sending";

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

      {status.kind === "sent" ? (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 16, lineHeight: 1.6 }}>
            Check your email. We sent a sign-in link to{" "}
            <strong>{email.trim()}</strong>. Open it on this device to continue.
          </p>
          <button
            type="button"
            onClick={() => setStatus({ kind: "idle" })}
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              textDecoration: "underline",
              opacity: 0.7,
              cursor: "pointer",
            }}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
          <p style={{ fontSize: 15, opacity: 0.8, marginBottom: 16 }}>
            Enter your email and we will send you a one-time sign-in link. No
            password needed.
          </p>
          <label
            htmlFor="email"
            style={{
              display: "block",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              opacity: 0.6,
              marginBottom: 6,
            }}
          >
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
            disabled={sending}
            placeholder="you@example.com"
            style={{
              width: "100%",
              padding: "0.6rem 0.75rem",
              fontSize: 16,
              color: "var(--foreground)",
              background: "var(--background)",
              border: "1px solid currentColor",
              borderRadius: 8,
              outline: "none",
              opacity: sending ? 0.6 : 1,
            }}
          />
          <button
            type="submit"
            disabled={sending}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "0.6rem 0.75rem",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--background)",
              background: "var(--foreground)",
              border: "1px solid currentColor",
              borderRadius: 8,
              cursor: sending ? "default" : "pointer",
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? "Sending..." : "Send magic link"}
          </button>
          {status.kind === "error" ? (
            <p
              role="alert"
              style={{ marginTop: 12, fontSize: 14, opacity: 0.85 }}
            >
              {status.message}
            </p>
          ) : null}
        </form>
      )}
    </main>
  );
}
