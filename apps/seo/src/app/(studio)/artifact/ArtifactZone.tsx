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
 * SCOPE (shell, stubbed seams clearly marked):
 *   - DRAFT mode renders the accumulated markdown as plain monospace text. PR 011
 *     replaces this with the live editor that the tokens stream INTO; PR 012 adds
 *     the edit loop. This shell only DISPLAYS the body, read-only.
 *   - PREVIEW mode is a clearly-marked placeholder; PR 011/013 wire the rendered
 *     reading view + version hub.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import { useState } from "react";
import { ScoreSignalDot } from "@/components/ScoreSignalDot";
import type { GateScorecard } from "@/lib/stream/use-ui-message-stream";
import { BriefCard, type ContentBrief } from "./BriefCard";
import { ModeTabs, type ArtifactMode } from "./ModeTabs";

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
  const hasBody = body.trim().length > 0;

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
          hasBody ? (
            <pre
              data-testid="artifact-body"
              style={{
                margin: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {body}
              {streaming && (
                <span
                  data-testid="stream-caret"
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 15,
                    marginLeft: 1,
                    background: "currentColor",
                    opacity: 0.5,
                    verticalAlign: "text-bottom",
                    animation: "studio-pulse 1.1s ease-in-out infinite",
                  }}
                />
              )}
            </pre>
          ) : (
            <p data-testid="artifact-body-empty" style={{ ...SUBTLE, margin: 0 }}>
              The draft body will appear here as the agent writes it.
            </p>
          )
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
