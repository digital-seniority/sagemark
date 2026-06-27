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
import { CostLedgerPanel, type CostLedgerPanelProps } from "./CostLedgerPanel";
import { ApprovalDebtPanel, type ApprovalDebtPanelProps } from "./ApprovalDebtPanel";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export interface InspectorPanelProps {
  /** The full SSE stream projection (phase + body + authoritative scorecard). */
  state: UiMessageStreamState;
  /** The brief's primary keyword — drives the live-preview keyword density. */
  keyword?: string | null;
  /**
   * The SEO cost-ledger + share-of-model projection (P1.C.3). OPTIONAL: the live
   * read path is NOT_WIRED (DR-026), so this is undefined in production today and
   * the section is simply not rendered. When a host DOES feed it, the panel reads
   * already-computed projections and degrades to its own per-section empty states
   * (it never throws on empty records / null reconcile). See CostLedgerPanel.
   */
  ledger?: CostLedgerPanelProps;
  /**
   * The per-client approval-cycle + approval-debt projection (P1.C.2). OPTIONAL,
   * same NOT_WIRED rationale as `ledger`: undefined ⇒ section omitted; an empty
   * `debts` array renders the panel's "No review activity yet" empty state rather
   * than throwing. See ApprovalDebtPanel.
   */
  approvalDebt?: ApprovalDebtPanelProps;
  /**
   * Optional collapse affordance (agent-ui). When provided, the panel header
   * renders a real `<button>` (chevron / "hide") that collapses the Inspector to
   * its narrow rail so the center artifact gets a wider reading view. Omitted ⇒ no
   * collapse control (the panel renders exactly as before). Collapsing is PURELY
   * VISUAL — the publish gate is always enforced server-side regardless.
   */
  onCollapse?: () => void;
}

export function InspectorPanel({ state, keyword, ledger, approvalDebt, onCollapse }: InspectorPanelProps) {
  // Zero-credit live preview: recomputed in a useMemo over the editor body, NOT a
  // gate/model call. The authoritative verdict still comes from state.scorecard.
  const client = useClientScorers(state.body, keyword);

  return (
    <div
      data-zone-body="inspector"
      data-testid="inspector-panel"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: "1rem", height: "100%" }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>Inspector</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...SUBTLE, fontSize: 11 }}>gate scorecard</span>
          {onCollapse ? (
            <button
              type="button"
              data-testid="inspector-collapse"
              aria-expanded={true}
              aria-label="Collapse inspector (gate scorecard)"
              onClick={onCollapse}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "transparent",
                color: "inherit",
                border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
                cursor: "pointer",
                font: "inherit",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              {/* Chevron points right — "hide the panel toward the edge". */}
              <span aria-hidden="true">&#x203A;</span>
            </button>
          ) : null}
        </div>
      </header>

      <GateScorecard phase={state.phase} scorecard={state.scorecard} client={client} />

      {/*
        Cost-ledger + approval-debt projections (P1.C.3 / P1.C.2). Gated on data
        AVAILABILITY: the live read path is NOT_WIRED (DR-026), so absent a host
        projection these sections are simply omitted. When a host DOES feed them
        the panels own their per-section empty states (they degrade, never throw).
      */}
      {ledger ? (
        <section data-testid="inspector-cost-ledger" aria-label="SEO cost ledger">
          <CostLedgerPanel {...ledger} />
        </section>
      ) : null}

      {approvalDebt ? (
        <section data-testid="inspector-approval-debt" aria-label="Approval debt">
          <ApprovalDebtPanel {...approvalDebt} />
        </section>
      ) : null}

      {/* The standing reminder of the two-source distinction (never hidden). */}
      <p data-testid="inspector-source-note" style={{ ...SUBTLE, fontSize: 11, marginTop: "auto" }}>
        Verdict + Stage-A vetoes are the authoritative server gate. Stage-B
        dimension bars are a zero-credit client preview over the current draft.
      </p>
    </div>
  );
}

export default InspectorPanel;
