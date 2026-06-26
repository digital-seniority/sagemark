"use client";

/**
 * InspectorPanel — the RIGHT zone of the three-zone studio canvas (PR 011 / P1.U.2).
 *
 * Fills the P1.U.1 `InspectorStub`. The panel renders the gate scorecard from TWO
 * clearly-separated sources, which is the load-bearing distinction of this PR:
 *
 *   - AUTHORITATIVE (server gate): the verdict band + Stage-A vetoes come from the
 *     `gate` SSE events folded into `state.scorecard` by `use-ui-message-stream`.
 *     This is the real, credited, non-compensatory gate (`@sagemark/core`
 *     `seo-gate.ts`): Stage-A ordered vetoes, then a Stage-B 0-100 composite banded
 *     PUBLISH >= 85 / REVIEW 70-84 / REVISE 50-69 / REJECT < 50.
 *
 *   - LIVE PREVIEW (client, zero-credit): the Stage-B dimension bars come from
 *     `useClientScorers`, which recomputes the deterministic `@sagemark/core`
 *     scorers over the CURRENT editor body in a `useMemo` — no model call, no gate
 *     run, no credit. It moves as the operator's body changes so the sidebar shows
 *     live deterministic signal between gate runs. It is explicitly labeled
 *     "live preview (uncredited)" so it is never mistaken for the server verdict.
 *
 * The panel takes the already-projected stream state + the brief's primary keyword
 * (for keyword-density) and owns the live-preview memo; `GateScorecard` is the pure
 * layout. Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII.
 */

import type { UiMessageStreamState } from "@/lib/stream/use-ui-message-stream";
import { useClientScorers } from "./use-client-scorers";
import { GateScorecard } from "./GateScorecard";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export interface InspectorPanelProps {
  /** The full SSE stream projection (phase + body + authoritative scorecard). */
  state: UiMessageStreamState;
  /** The brief's primary keyword — drives the live-preview keyword density. */
  keyword?: string | null;
}

export function InspectorPanel({ state, keyword }: InspectorPanelProps) {
  // Zero-credit live preview: recomputed in a useMemo over the editor body, NOT a
  // gate/model call. The authoritative verdict still comes from state.scorecard.
  const client = useClientScorers(state.body, keyword);

  return (
    <div
      data-zone-body="inspector"
      data-testid="inspector-panel"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: "1rem", height: "100%" }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>Inspector</p>
        <span style={{ ...SUBTLE, fontSize: 11 }}>gate scorecard</span>
      </header>

      <GateScorecard phase={state.phase} scorecard={state.scorecard} client={client} />

      {/* The standing reminder of the two-source distinction (never hidden). */}
      <p data-testid="inspector-source-note" style={{ ...SUBTLE, fontSize: 11, marginTop: "auto" }}>
        Verdict + Stage-A vetoes are the authoritative server gate. Stage-B
        dimension bars are a zero-credit client preview over the current draft.
      </p>
    </div>
  );
}

export default InspectorPanel;
