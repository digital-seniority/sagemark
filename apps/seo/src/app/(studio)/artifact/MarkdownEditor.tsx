"use client";

/**
 * MarkdownEditor — the live-streaming center editor (PR 011 / P1.U.2).
 *
 * Fills the P1.U.1 stub that rendered the body as a read-only `<pre>`. The editor
 * DISPLAYS the artifact body that the reducer accumulates from `token-delta`
 * events (`use-ui-message-stream.ts`: `token-delta` -> `state.body`), so the
 * operator watches the draft type in live, token by token. While the stream is
 * live a pulsing caret hint sits at the end of the body.
 *
 * SCOPE (this slice is display-focused). The editor is a `<textarea>` so the body
 * is selectable / copyable and lightly locally-editable, but the EDIT -> re-gate
 * loop is OUT of scope here (PR 012): local keystrokes update only this
 * component's draft state and never re-dispatch a gate. Crucially, while the
 * stream is still pushing tokens the textarea is CONTROLLED by the incoming body
 * (so the live stream always wins); once the stream settles (done/idle) the
 * operator may scratch-edit locally. `onLocalEdit` is exposed for PR 012 to hang
 * the bounded-edit / re-gate wiring off without re-touching this file.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette, matching
 * VoiceSpecEditor / DraftResult / the other studio components). Clean ASCII / UTF-8.
 */

import { useEffect, useRef, useState } from "react";

export interface MarkdownEditorProps {
  /** The accumulated markdown body from the SSE `token-delta` stream / snapshot. */
  body: string;
  /** Whether the body is still actively streaming (drives the live caret + lock). */
  streaming?: boolean;
  /**
   * PR 012 seam: notified when the operator scratch-edits the settled body. No-op
   * at this slice (the edit -> re-gate loop is PR 012); kept so the wiring can hang
   * here without re-touching the editor.
   */
  onLocalEdit?: (next: string) => void;
}

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, monospace";

export function MarkdownEditor({ body, streaming = false, onLocalEdit }: MarkdownEditorProps) {
  // Local scratch buffer. While the stream is live the incoming `body` always
  // wins (the stream is the source of truth); once settled, local keystrokes are
  // allowed and held here. We re-sync to `body` whenever the streamed body grows.
  const [draft, setDraft] = useState(body);
  const lastBody = useRef(body);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // The live stream is the source of truth: whenever the streamed body changes,
  // adopt it (token deltas append, snapshots replace) so the operator sees the
  // live draft, never a stale local buffer.
  useEffect(() => {
    if (body !== lastBody.current) {
      lastBody.current = body;
      setDraft(body);
    }
  }, [body]);

  // Keep the caret view pinned to the tail while tokens stream in.
  useEffect(() => {
    if (streaming && taRef.current) {
      taRef.current.scrollTop = taRef.current.scrollHeight;
    }
  }, [draft, streaming]);

  const hasBody = draft.trim().length > 0;

  if (!hasBody && !streaming) {
    return (
      <p data-testid="artifact-body-empty" style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>
        The draft body will appear here as the agent writes it.
      </p>
    );
  }

  return (
    <div
      data-testid="markdown-editor"
      data-streaming={streaming ? "true" : "false"}
      style={{ position: "relative", height: "100%", minHeight: 0, display: "flex" }}
    >
      <textarea
        ref={taRef}
        data-testid="artifact-body"
        aria-label="Draft markdown body"
        // While streaming the editor is read-only (the stream owns the body);
        // once settled the operator may scratch-edit (PR 012 wires re-gate).
        readOnly={streaming}
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          if (streaming) return; // the live stream wins; ignore stray input
          setDraft(e.target.value);
          onLocalEdit?.(e.target.value);
        }}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          minHeight: 0,
          resize: "none",
          appearance: "none",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "inherit",
          fontFamily: MONO,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          padding: 0,
        }}
      />
      {streaming && (
        <span
          data-testid="stream-caret"
          aria-hidden="true"
          style={{
            position: "absolute",
            // The caret sits at the start (overlay hint) — the textarea scrolls
            // its content; the pulsing dot communicates "still writing".
            left: 0,
            bottom: 0,
            display: "inline-block",
            width: 7,
            height: 15,
            background: "currentColor",
            opacity: 0.5,
            animation: "studio-pulse 1.1s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

export default MarkdownEditor;
