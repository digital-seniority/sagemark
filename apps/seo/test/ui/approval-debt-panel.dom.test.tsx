// @vitest-environment jsdom

/**
 * A.005.3 (audit-005 M2) — ApprovalDebtPanel smoke (jsdom, DR-029 per-file pattern).
 *
 * The panel (P1.C.2) was fully built but UNMOUNTED until A.005.3 mounted it into
 * InspectorPanel. Non-vacuous smoke: renders the panel directly AND through the
 * InspectorPanel mount, asserts a representative open-thread / debt count + the
 * mean-cycle figure surface, and asserts the graceful empty state when there is no
 * review activity (the live read path is NOT_WIRED per DR-026 — degrade, not throw).
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ApprovalDebtPanel,
  formatCycleMs,
  type ApprovalDebtPanelProps,
} from "@/app/(studio)/inspector/ApprovalDebtPanel";
import { InspectorPanel } from "@/app/(studio)/inspector/InspectorPanel";
import { INITIAL_STREAM_STATE } from "@/lib/stream/use-ui-message-stream";
import type { ApprovalDebt } from "@/lib/metrics/approval-debt";

/** A representative populated projection: one client carrying open debt. */
function populated(): ApprovalDebtPanelProps {
  const debts: ApprovalDebt[] = [
    {
      clientId: "client-1",
      openThreadCount: 2,
      cycles: [],
      closedClientCycles: 3,
      closedCredentialedCycles: 1,
      meanCycleMs: 18 * 3_600_000, // 18h
      openCycleCount: 1,
    },
  ];
  return { debts, clientNames: { "client-1": "Whispering Willows" } };
}

describe("ApprovalDebtPanel — smoke (A.005.3 mount)", () => {
  it("renders a representative open-thread (debt) count + mean-cycle figure", () => {
    render(<ApprovalDebtPanel {...populated()} />);

    const row = screen.getByTestId("approval-debt-row");
    expect(row).toHaveAttribute("data-client-id", "client-1");
    // The display name resolves from clientNames.
    expect(row).toHaveTextContent("Whispering Willows");
    // The open-thread badge is the "debt" figure.
    expect(screen.getByTestId("approval-debt-open-threads")).toHaveTextContent("2 open");
    // The mean-cycle + closed-cycle counts surface real figures.
    expect(screen.getByTestId("approval-debt-mean-cycle")).toHaveTextContent("18.0h");
    expect(screen.getByTestId("approval-debt-closed")).toHaveTextContent("4 closed");
    expect(screen.getByTestId("approval-debt-open-cycles")).toHaveTextContent("1 in flight");
  });

  it("degrades to the empty state when there is no review activity (no throw)", () => {
    expect(() => render(<ApprovalDebtPanel debts={[]} />)).not.toThrow();
    expect(screen.getByTestId("approval-debt-empty")).toHaveTextContent(/no review activity/i);
    expect(screen.queryByTestId("approval-debt-row")).not.toBeInTheDocument();
  });

  it("formatCycleMs renders the em-dash sentinel for a null / open cycle", () => {
    expect(formatCycleMs(null)).toBe("—");
    expect(formatCycleMs(30 * 60_000)).toBe("30m");
  });

  it("is mounted inside InspectorPanel when an approval-debt projection is fed", () => {
    render(
      <InspectorPanel
        state={INITIAL_STREAM_STATE}
        keyword="memory care"
        approvalDebt={populated()}
      />,
    );
    expect(screen.getByTestId("inspector-approval-debt")).toBeInTheDocument();
    expect(screen.getByTestId("approval-debt-panel")).toBeInTheDocument();
    expect(screen.getByTestId("approval-debt-open-threads")).toHaveTextContent("2 open");
  });

  it("omits the approval-debt section in InspectorPanel when NOT_WIRED (no projection)", () => {
    render(<InspectorPanel state={INITIAL_STREAM_STATE} keyword="memory care" />);
    expect(screen.queryByTestId("inspector-approval-debt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-debt-panel")).not.toBeInTheDocument();
  });
});
