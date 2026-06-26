// @vitest-environment jsdom

/**
 * A.005.3 (audit-005 M2) — CostLedgerPanel smoke (jsdom, DR-029 per-file pattern).
 *
 * The panel (P1.C.3) was fully built but UNMOUNTED until A.005.3 mounted it into
 * InspectorPanel. This is a non-vacuous smoke: it renders the panel both directly
 * AND through the InspectorPanel mount, asserts a representative measured/reserved
 * cost figure surfaces, and asserts the graceful empty state when no ledger data
 * is present (the live read path is NOT_WIRED per DR-026 — the panel must degrade,
 * never throw).
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CostLedgerPanel,
  type CostLedgerPanelProps,
} from "@/app/(studio)/inspector/CostLedgerPanel";
import { InspectorPanel } from "@/app/(studio)/inspector/InspectorPanel";
import { INITIAL_STREAM_STATE } from "@/lib/stream/use-ui-message-stream";
import type { ReservationScope } from "@/lib/ledger/reserve-conditional";

const SCOPE: ReservationScope = {
  workspaceId: "ws-1",
  clientId: "client-1",
  runId: "run-1",
};

/** A representative populated projection (two measured stages + a reconciled run). */
function populated(): CostLedgerPanelProps {
  return {
    records: [
      {
        scope: SCOPE,
        pieceId: "piece-1",
        stage: "drafter",
        reservedUsd: 1.25,
        actualUsd: 1.1,
        model: "claude",
        latencyMs: 4200,
      },
      {
        scope: SCOPE,
        pieceId: "piece-1",
        stage: "judge",
        reservedUsd: 0.5,
        actualUsd: 0.42,
        model: "chatgpt",
        latencyMs: 1800,
      },
    ],
    reconcile: {
      ok: true,
      ledgerActualUsd: 1.52,
      gatewayReportedUsd: 1.52,
      gapUsd: 0,
      withinCostTarget: true,
      costTargetUsd: 2,
    },
    sourcingBlock: {
      totalGated: 10,
      blockedBySourcing: 3,
      rate: 0.3,
      unsourcedStatVetoes: 2,
      thinSourceFaithfulnessBlocks: 1,
    },
    citation: {
      pieceId: "piece-1",
      total: 8,
      cited: 6,
      citationRate: 0.75,
      byEngine: {
        chatgpt: { total: 4, cited: 3, rate: 0.75 },
        claude: { total: 4, cited: 3, rate: 0.75 },
      },
    },
  };
}

describe("CostLedgerPanel — smoke (A.005.3 mount)", () => {
  it("renders representative reserved/actual cost figures from injected props", () => {
    render(<CostLedgerPanel {...populated()} />);

    // The per-stage rows render with their measured actuals.
    const rows = screen.getAllByTestId("cost-ledger-row");
    expect(rows).toHaveLength(2);
    const actuals = screen.getAllByTestId("cost-actual").map((n) => n.textContent);
    expect(actuals).toContain("$1.1000");
    expect(actuals).toContain("$0.4200");

    // The measured per-piece total + within-target state surface a real figure.
    expect(screen.getByTestId("cost-measured")).toHaveTextContent("$1.5200");
    expect(screen.getByTestId("cost-target-state")).toHaveAttribute("data-within", "true");

    // Reconciliation + the D3 sourcing-block rate + share-of-model north star.
    expect(screen.getByTestId("reconcile-state")).toHaveAttribute("data-ok", "true");
    expect(screen.getByTestId("sourcing-block-rate")).toHaveTextContent("30%");
    expect(screen.getByTestId("citation-rate")).toHaveTextContent("75%");
  });

  it("degrades to per-section empty states when no ledger data is present (no throw)", () => {
    const empty: CostLedgerPanelProps = {
      records: [],
      reconcile: null,
      sourcingBlock: null,
      citation: null,
    };
    expect(() => render(<CostLedgerPanel {...empty} />)).not.toThrow();

    expect(screen.getByTestId("cost-ledger-empty")).toHaveTextContent(/no model calls/i);
    // With no rows the measured total is a real $0.0000 (sum of nothing), and the
    // downstream sections fall back to their own "not run / no results" copy.
    expect(screen.getByTestId("cost-measured")).toHaveTextContent("$0.0000");
    expect(screen.getByTestId("cost-reconcile")).toHaveTextContent(/not run yet/i);
    expect(screen.getByTestId("sourcing-block")).toHaveTextContent(/no gated results/i);
    expect(screen.getByTestId("share-of-model")).toHaveTextContent(/no citation checks/i);
    // No reconciliation projection ⇒ no fabricated target verdict.
    expect(screen.queryByTestId("cost-target-state")).not.toBeInTheDocument();
  });

  it("is mounted inside InspectorPanel when a ledger projection is fed", () => {
    render(
      <InspectorPanel state={INITIAL_STREAM_STATE} keyword="memory care" ledger={populated()} />,
    );
    // The mount wrapper + the panel itself both resolve through the Inspector.
    expect(screen.getByTestId("inspector-cost-ledger")).toBeInTheDocument();
    expect(screen.getByTestId("cost-ledger-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cost-measured")).toHaveTextContent("$1.5200");
  });

  it("omits the cost-ledger section in InspectorPanel when NOT_WIRED (no projection)", () => {
    render(<InspectorPanel state={INITIAL_STREAM_STATE} keyword="memory care" />);
    expect(screen.queryByTestId("inspector-cost-ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-ledger-panel")).not.toBeInTheDocument();
  });
});
