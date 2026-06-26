"use client";

/**
 * SectionApprovalBeat — the section-level Approve / Request-changes verbs on the
 * tokenized client-review surface (PR 018 / P1.C.1, lane client-review).
 *
 * PORTED from flywheel-main `apps/site/src/components/demos/research/ApprovalBeat.tsx`
 * (DR-001) — that source is a marketing DEMO (motion/react animation + slot
 * state, no persistence). This adapts its approve/request-changes VOCABULARY to a
 * functional review control: the two verbs POST to `/api/review/comments` with
 * the opaque review token + the verb's `kind`. The animation dependency
 * (`motion/react`) and the demo slot-state are dropped (apps/seo carries neither);
 * colors are token-driven (`--foreground`/`--background`), no hardcoded hue.
 *
 * RELEASE SEMANTICS (AC#4): a section Approve persists a `comment_threads` row
 * with `kind: "section-approve"`; Request-changes persists `kind:
 * "request-changes"`. The approval is RECORDED but does NOT itself release a YMYL
 * piece — release stays the separate fail-closed `canPublish` path (PR 009).
 * This component only records the verb; it triggers no transition.
 *
 * Tenancy: the component sends ONLY the opaque token (+ the verb + an author
 * label + optional note). It NEVER sends workspace_id/client_id/version — the
 * route resolves those from the token server-side.
 */

import React, { useCallback, useState } from "react";

export interface SectionApprovalBeatProps {
  /** The opaque review token (from the route param). Sent as-is to the API. */
  token: string;
  /** A label for the section being reviewed (display only). */
  sectionLabel?: string;
  /** The reviewing client contact id/name (persisted as the comment author). */
  author: string;
  /**
   * Optional anchor for the section being acted on (which region of the
   * preview). Forwarded so the recorded verb is element-anchored when known.
   */
  anchor?: { x: number; y: number; elementHint?: string } | null;
  /**
   * Injected POST fn (tests pass a spy; production posts to /api/review/comments).
   * Returns the created comment id on success.
   */
  submit?: (input: SectionVerbRequest) => Promise<{ id: string } | null>;
}

/** The wire request a section verb sends. NO tenancy fields (token-scoped). */
export interface SectionVerbRequest {
  token: string;
  kind: "section-approve" | "request-changes";
  anchor?: { x: number; y: number; elementHint?: string } | null;
  body?: string;
  author: string;
}

/** Default submit: POST to the comments route. */
async function defaultSubmit(
  input: SectionVerbRequest,
): Promise<{ id: string } | null> {
  const res = await fetch("/api/review/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string };
}

export function SectionApprovalBeat({
  token,
  sectionLabel,
  author,
  anchor = null,
  submit = defaultSubmit,
}: SectionApprovalBeatProps) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "done"; kind: "section-approve" | "request-changes" }
    | { status: "error" }
  >({ status: "idle" });

  const act = useCallback(
    async (kind: "section-approve" | "request-changes") => {
      setState({ status: "submitting" });
      try {
        const result = await submit({
          token,
          kind,
          anchor,
          body: note,
          author,
        });
        setState(result ? { status: "done", kind } : { status: "error" });
      } catch {
        setState({ status: "error" });
      }
    },
    [submit, token, anchor, note, author],
  );

  const busy = state.status === "submitting";

  return (
    <section
      data-testid="section-approval-beat"
      aria-label="Section approval"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderRadius: 6,
        border: "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
        background: "color-mix(in srgb, var(--foreground) 4%, transparent)",
        padding: 16,
      }}
    >
      {sectionLabel ? (
        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
          {sectionLabel}
        </span>
      ) : null}

      <textarea
        data-testid="section-note"
        aria-label="Comment (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        disabled={busy || state.status === "done"}
        rows={2}
        style={{
          resize: "vertical",
          borderRadius: 4,
          border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
          background: "var(--background)",
          color: "var(--foreground)",
          padding: "6px 8px",
          fontSize: 14,
        }}
      />

      {state.status === "done" ? (
        <p data-testid="section-verb-done" role="status" style={{ fontSize: 13 }}>
          {state.kind === "section-approve"
            ? "Section approved — recorded."
            : "Changes requested — recorded."}
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexDirection: "row",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            data-testid="request-changes-btn"
            data-kind="request-changes"
            disabled={busy}
            onClick={() => act("request-changes")}
            style={{
              borderRadius: 4,
              border: "1px solid color-mix(in srgb, var(--foreground) 25%, transparent)",
              background: "transparent",
              color: "var(--foreground)",
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Request changes
          </button>
          <button
            type="button"
            data-testid="section-approve-btn"
            data-kind="section-approve"
            disabled={busy}
            onClick={() => act("section-approve")}
            style={{
              borderRadius: 4,
              border: "1px solid var(--foreground)",
              background: "var(--foreground)",
              color: "var(--background)",
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Approve section
          </button>
        </div>
      )}

      {state.status === "error" ? (
        <p data-testid="section-verb-error" role="alert" style={{ fontSize: 13 }}>
          Could not record — try again.
        </p>
      ) : null}
    </section>
  );
}
