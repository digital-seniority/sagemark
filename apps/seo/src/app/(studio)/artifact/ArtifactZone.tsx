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
import { DraftPaper } from "./DraftPaper";
import { PreviewFrame } from "./PreviewFrame";
import { ExportMenu } from "./ExportMenu";

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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ExportMenu brief={brief} body={body} />
          <ScoreSignalDot verdict={scorecard?.verdict ?? null} score={scorecard?.score ?? null} />
        </div>
      </header>

      <BriefCard brief={brief} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {mode === "draft" ? (
          // The live reading view the token-delta stream materializes into — the
          // article renders in serif as the agent writes it (DraftPaper). The
          // edit <-> view toggle + the edit -> re-gate loop land in Slice 3.
          <DraftPaper body={body} streaming={streaming} />
        ) : (
          // PREVIEW mode — the rendered reading view: a SERP snippet + the article
          // in a sandboxed iframe, built from the live body (PreviewFrame).
          <PreviewFrame brief={brief} body={body} />
        )}
      </div>

      {/* The live-stream footer from the mock — the gate re-runs once the draft settles. */}
      {streaming && mode === "draft" && (
        <div
          data-testid="artifact-streaming-footer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--accent-blue)",
            borderTop: "1px solid var(--line)",
            paddingTop: 10,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-blue)",
              animation: "studio-pulse 1.2s ease-in-out infinite",
            }}
          />
          streaming — the gate re-runs when the draft settles
        </div>
      )}
    </div>
  );
}

export default ArtifactZone;
