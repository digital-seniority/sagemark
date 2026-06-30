"use client";

/**
 * DraftPaper — the rendered-prose reading view of the live draft (Slice 1, the
 * dark-canvas overhaul).
 *
 * The mock's centerpiece is the article materializing in a serif voice as the
 * agent writes it — not a monospace markdown source dump. This renders the
 * accumulated `token-delta` body (from `use-ui-message-stream`: `token-delta` ->
 * `state.body`) to HTML via the SAME escape-first `renderMarkdownToSafeHtml` the
 * public SSR page uses, so the operator watches the real reading view fill in
 * live, with a blinking caret at the tail while the stream is open.
 *
 * EDIT IS A LATER SLICE. This is display-only (matching the prior MarkdownEditor
 * scope). Slice 3 adds the view <-> edit toggle (this rendered view + the
 * MarkdownEditor source editor) and the edit -> snapshot -> re-gate loop.
 *
 * SAFE HTML. `renderMarkdownToSafeHtml` HTML-escapes the body FIRST and only then
 * upgrades a conservative markdown subset to tags — so `dangerouslySetInnerHTML`
 * here can never execute body-authored script (the same property the public page
 * relies on). Partial mid-stream markdown degrades gracefully (an unclosed `**`
 * stays literal). Colours from the dark tokens. Clean ASCII / UTF-8.
 */

import { renderMarkdownToSafeHtml } from "@/lib/render/client-blog";

export interface DraftPaperProps {
  /** The accumulated markdown body from the SSE `token-delta` stream / snapshot. */
  body: string;
  /** Whether the body is still actively streaming (drives the live caret). */
  streaming?: boolean;
}

export function DraftPaper({ body, streaming = false }: DraftPaperProps) {
  const hasBody = body.trim().length > 0;

  // Body only arrives via snapshot (reconcile after persistPiece). During
  // streaming the draft area shows a contextual placeholder rather than the
  // model's narration text (which lives in the agent feed, not here).
  if (!hasBody) {
    return (
      <p
        data-testid="artifact-body-empty"
        style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}
      >
        {streaming
          ? "The agent is working — the article will appear here once it’s saved."
          : "The draft body will appear here as the agent writes it."}
      </p>
    );
  }

  const html = renderMarkdownToSafeHtml(body);

  return (
    <div
      data-testid="draft-paper"
      data-streaming={streaming ? "true" : "false"}
    >
      <div
        data-testid="artifact-body"
        className="draft-paper"
        // Safe: renderMarkdownToSafeHtml is escape-first (the load-bearing XSS
        // guard the public SSR render also relies on).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default DraftPaper;
