"use client";

/**
 * PieceStatusRow — the at-a-glance run/piece status strip at the top of the
 * Inspector gate scorecard (PR 011 / P1.U.2).
 *
 * Surfaces the run lifecycle phase (idle | streaming | done | error) from the SSE
 * projection, plus the authoritative gate verdict once one exists, so the operator
 * can see where the piece stands (writing -> gated -> verdict) at a glance. The
 * full content_pieces lifecycle status (draft/review/approved/published) and its
 * FSM transitions are owned elsewhere (the lifecycle FSM + PR 012/013); this row
 * shows the stream-derived run state, which is all the SSE projection exposes at
 * this slice.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import type { StreamPhase } from "@/lib/stream/use-ui-message-stream";

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle: "Idle",
  streaming: "Writing",
  done: "Gated",
  error: "Error",
};

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

export interface PieceStatusRowProps {
  /** The run lifecycle phase from the SSE projection. */
  phase: StreamPhase;
  /** The authoritative gate verdict, or null until a gate frame arrives. */
  verdict: string | null;
}

export function PieceStatusRow({ phase, verdict }: PieceStatusRowProps) {
  return (
    <div
      data-testid="piece-status-row"
      data-phase={phase}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        border: "1px solid currentColor",
        borderRadius: 8,
        padding: "0.5rem 0.75rem",
      }}
    >
      <span style={{ ...SUBTLE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Status</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          data-testid="piece-status-phase"
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid currentColor",
            opacity: phase === "idle" ? 0.4 : 0.85,
          }}
        >
          {PHASE_LABEL[phase]}
        </span>
        {verdict && (
          <span data-testid="piece-status-verdict" style={{ ...SUBTLE, fontWeight: 600 }}>
            {verdict}
          </span>
        )}
      </span>
    </div>
  );
}

export default PieceStatusRow;
