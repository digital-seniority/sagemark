"use client";

/**
 * AgentPanel — the LEFT zone of the three-zone studio canvas (PR 010 / P1.U.1).
 *
 * Adapted from videogen's left-rail `AgentPanel` (DR-001): we keep the rail shape
 * (title + a run affordance + a live feed) but DROP every video coupling (scene
 * selection, ChatEdit, version/render activity polling) and re-point the feed at
 * the SEO run's SSE stream. The body is:
 *   - a header (run phase badge),
 *   - the live `AgentMessageStream` (thinking + tool-use rows),
 *   - a terminal-error row when the stream ends in error (acceptance 4 made
 *     visible: a wedged/failed run surfaces an explicit row, never a dead spinner).
 *
 * It is a thin presentational wrapper over the hook's already-projected state — the
 * SSE fold lives in `use-ui-message-stream`. Body `token-delta`s do NOT render here
 * (they land in the artifact zone); the edit loop is PR 012.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import type {
  AgentFeedItem,
  StreamPhase,
} from "@/lib/stream/use-ui-message-stream";
import { AgentMessageStream } from "./AgentMessageStream";

export interface AgentPanelProps {
  /** The run's lifecycle phase (idle | streaming | done | error). */
  phase: StreamPhase;
  /** The ordered agent feed (thinking + tool-use rows) from the hook. */
  feed: AgentFeedItem[];
  /** The terminal error (code + message) when `phase === "error"`, else null. */
  error?: { code: string; message: string } | null;
}

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle: "Idle",
  streaming: "Running",
  done: "Done",
  error: "Error",
};

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export function AgentPanel({ phase, feed, error }: AgentPanelProps) {
  return (
    <div
      data-zone-body="agent"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: "1rem", height: "100%" }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
          Agent
        </p>
        <span
          data-testid="run-phase"
          data-phase={phase}
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid currentColor",
            opacity: phase === "idle" ? 0.4 : 0.8,
          }}
        >
          {PHASE_LABEL[phase]}
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <AgentMessageStream feed={feed} />
      </div>

      {phase === "error" && error && (
        <div
          role="alert"
          data-testid="agent-error"
          style={{
            fontSize: 12,
            padding: "0.625rem 0.75rem",
            border: "1px solid currentColor",
            borderRadius: 8,
            background: "color-mix(in srgb, currentColor 8%, transparent)",
          }}
        >
          <strong>{error.code}</strong>
          <span style={{ ...SUBTLE, display: "block", marginTop: 2 }}>{error.message}</span>
        </div>
      )}
    </div>
  );
}

export default AgentPanel;
