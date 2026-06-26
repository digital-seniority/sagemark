"use client";

/**
 * ArtifactZone — the CENTER zone of the three-zone studio canvas (PR 010 / P1.U.1).
 *
 * Replaces videogen's video Preview zone (the `<video>` / Remotion player) with the
 * markdown content_piece artifact: a brief card, a draft/preview mode switch, the
 * verdict signal dot, and the body. The body text is the hook's accumulated
 * `token-delta` stream (or the reconnect snapshot) — so the operator watches the
 * draft fill in live.
 *
 * SCOPE (PR 011 fills the editor seam):
 *   - DRAFT mode renders the live `MarkdownEditor` that the `token-delta` stream
 *     types INTO (PR 011 / P1.U.2 — replaces the P1.U.1 read-only `<pre>`). The
 *     editor is display-focused at this slice; the edit -> re-gate loop is PR 012.
 *   - PREVIEW mode is a clearly-marked placeholder; the rendered reading view +
 *     version hub land in PR 013.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import { useState } from "react";
import { ScoreSignalDot } from "@/components/ScoreSignalDot";
import type { GateScorecard } from "@/lib/stream/use-ui-message-stream";
import { BriefCard, type ContentBrief } from "./BriefCard";
import { ModeTabs, type ArtifactMode } from "./ModeTabs";
import { MarkdownEditor } from "./MarkdownEditor";

export interface ArtifactZoneProps {
  /** The resolved content brief, or null before a run produces one. */
  brief: ContentBrief | null;
  /** The accumulated markdown body from the SSE `token-delta` stream / snapshot. */
  body: string;
  /** Whether the body is still actively streaming (drives the live caret hint). */
  streaming?: boolean;
  /** The latest gate scorecard projection (drives the verdict signal dot). */
  scorecard?: GateScorecard | null;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export function ArtifactZone({ brief, body, streaming = false, scorecard }: ArtifactZoneProps) {
  const [mode, setMode] = useState<ArtifactMode>("draft");

  return (
    <div
      data-zone-body="artifact"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "1rem 1.25rem",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <ModeTabs active={mode} onChange={setMode} />
        <ScoreSignalDot verdict={scorecard?.verdict ?? null} score={scorecard?.score ?? null} />
      </header>

      <BriefCard brief={brief} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {mode === "draft" ? (
          // PR 011: the live editor the token-delta stream types into (was a
          // read-only <pre> in P1.U.1). MarkdownEditor owns the empty state + caret.
          <MarkdownEditor body={body} streaming={streaming} />
        ) : (
          // PREVIEW mode — placeholder for the rendered reading view (PR 011/013).
          <div
            data-testid="artifact-preview-stub"
            style={{
              border: "1px dashed currentColor",
              borderRadius: 10,
              padding: "1.25rem",
              ...SUBTLE,
            }}
          >
            Rendered preview is wired in a later PR (PR 011/013). Switch to{" "}
            <strong>Draft</strong> to see the live body.
          </div>
        )}
      </div>
    </div>
  );
}

export default ArtifactZone;
