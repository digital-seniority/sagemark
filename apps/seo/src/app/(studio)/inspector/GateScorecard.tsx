"use client";

/**
 * GateScorecard — the assembled gate scorecard for the Inspector zone
 * (PR 011 / P1.U.2).
 *
 * Composes the four scorecard blocks in reading order:
 *   1. PieceStatusRow  — run phase + verdict at-a-glance,
 *   2. VerdictBand     — the AUTHORITATIVE verdict band + composite (from the
 *                        server `gate` SSE event; thresholds from @sagemark/core),
 *   3. StageAVetoes    — the AUTHORITATIVE Stage-A veto codes (from the `gate` event),
 *   4. StageBBars      — the ZERO-CREDIT LIVE-PREVIEW per-dimension deterministic
 *                        bars (from `use-client-scorers` over the editor body).
 *
 * The hard distinction the PR mandates: blocks 2-3 are the authoritative server
 * gate (the `gate` SSE events folded by `use-ui-message-stream`); block 4 is the
 * client-side live preview (zero credit, no model/gate call) and is labeled as
 * such. `InspectorPanel` owns the live-preview computation and the section header
 * that frames the distinction; this component is the pure layout.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import type {
  GateScorecard as GateScorecardState,
  StreamPhase,
} from "@/lib/stream/use-ui-message-stream";
import type { ClientScorers } from "./use-client-scorers";
import { PieceStatusRow } from "./PieceStatusRow";
import { VerdictBand } from "./VerdictBand";
import { StageAVetoes } from "./StageAVetoes";
import { StageBBars } from "./StageBBars";

export interface GateScorecardProps {
  /** The run lifecycle phase from the SSE projection. */
  phase: StreamPhase;
  /** The authoritative gate scorecard projection (from `gate` SSE events), or null. */
  scorecard: GateScorecardState | null;
  /** The zero-credit live-preview deterministic scorers over the editor body. */
  client: ClientScorers;
}

export function GateScorecard({ phase, scorecard, client }: GateScorecardProps) {
  const hasGate = scorecard !== null;
  const vetoes = scorecard?.vetoes ?? [];
  const vetoed = vetoes.length > 0;

  return (
    <div
      data-testid="gate-scorecard"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <PieceStatusRow phase={phase} verdict={scorecard?.verdict ?? null} />

      <VerdictBand
        verdict={scorecard?.verdict ?? null}
        score={scorecard?.score ?? null}
        vetoed={vetoed}
      />

      <StageAVetoes vetoes={vetoes} hasGate={hasGate} />

      <StageBBars content={client.content} hasBody={client.hasBody} />
    </div>
  );
}

export default GateScorecard;
