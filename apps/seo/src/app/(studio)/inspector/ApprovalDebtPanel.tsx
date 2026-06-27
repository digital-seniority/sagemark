"use client";

/**
 * ApprovalDebtPanel — the operator-facing approval-cycle + approval-debt KPI strip
 * (PR 019 / P1.C.2, lane client-review).
 *
 * Surfaces, PER CLIENT, the two metrics `computeApprovalDebt` produces:
 *   - APPROVAL-CYCLE TIME: mean closed-cycle duration (link_sent→client_signoff and
 *     draft→review→credentialed_release), plus the count of closed/open cycles, so
 *     the operator sees how long sign-offs are taking.
 *   - APPROVAL DEBT: the count of OPEN `request-changes` threads — unresolved
 *     review work the client still owes a response on.
 *
 * PURE PRESENTATION: it renders an already-computed `ApprovalDebt[]` (the metric is
 * computed host-side from the seam-read events/threads, never in the component).
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import type { ApprovalDebt } from "@/lib/metrics/approval-debt";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };
const LABEL: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 11,
  opacity: 0.6,
};

/** Format a millisecond duration as a compact human string (or em-dash for null). */
export function formatCycleMs(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  const hours = durationMs / 3_600_000;
  if (hours < 1) {
    const mins = Math.round(durationMs / 60_000);
    return `${mins}m`;
  }
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export interface ApprovalDebtPanelProps {
  /** The per-client approval-debt rollups (one per client the operator manages). */
  debts: ApprovalDebt[];
  /** Optional client display names, keyed by clientId (falls back to the id). */
  clientNames?: Record<string, string>;
}

export function ApprovalDebtPanel({ debts, clientNames }: ApprovalDebtPanelProps) {
  return (
    <div
      data-zone-body="approval-debt"
      data-testid="approval-debt-panel"
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: "1rem", height: "100%" }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p style={LABEL}>Approval debt</p>
        <span style={{ ...SUBTLE, fontSize: 11 }}>cycle time + open threads</span>
      </header>

      {debts.length === 0 ? (
        <p data-testid="approval-debt-empty" style={SUBTLE}>
          No review activity yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {debts.map((d) => {
            const name = clientNames?.[d.clientId] ?? d.clientId;
            const hasDebt = d.openThreadCount > 0;
            return (
              <li
                key={d.clientId}
                data-testid="approval-debt-row"
                data-client-id={d.clientId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  border: "1px solid currentColor",
                  borderRadius: 8,
                  padding: "0.5rem 0.75rem",
                  opacity: hasDebt ? 1 : 0.85,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
                  <span
                    data-testid="approval-debt-open-threads"
                    title="Open request-changes threads (approval debt)"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "1px solid currentColor",
                      opacity: hasDebt ? 0.95 : 0.4,
                    }}
                  >
                    {d.openThreadCount} open
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, ...SUBTLE }}>
                  <span data-testid="approval-debt-mean-cycle">
                    mean cycle {formatCycleMs(d.meanCycleMs)}
                  </span>
                  <span data-testid="approval-debt-closed">
                    {d.closedClientCycles + d.closedCredentialedCycles} closed
                  </span>
                  <span data-testid="approval-debt-open-cycles">{d.openCycleCount} in flight</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ApprovalDebtPanel;
