"use client";

/**
 * StrategyCard — the human-approval gate for a proposed ContentStrategy.
 *
 * Shows the strategy roadmap + key dimensions (objective / audience / market) and
 * surfaces the Approve button that unlocks authoring runs. Follows the BriefCard
 * idiom (same border/radius/opacity tokens; no hardcoded palette).
 *
 * The approve action POSTs to `/api/projects/[id]/approve`; on success the card
 * calls `onApproved()` so the parent canvas can update its `strategyStatus` state
 * and unlock the chat composer for authoring runs.
 *
 * Presentational + fetch-injectable (tests). Clean ASCII / UTF-8.
 */

import { useState } from "react";
import type { ContentStrategy, ContentStrategyRoadmapItem } from "@sagemark/schema-flywheel";

export interface StrategyCardProps {
  projectId: string;
  clientId: string;
  strategy: ContentStrategy;
  strategyStatus: "proposed" | "approved" | "archived";
  /** Called after a successful approve POST. */
  onApproved?: () => void;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };
const LABEL: React.CSSProperties = { ...SUBTLE, marginBottom: 2 };

function ClusterBadge({ role }: { role: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 4,
        border: "1px solid currentColor",
        opacity: 0.6,
        marginLeft: 6,
        whiteSpace: "nowrap",
      }}
    >
      {role}
    </span>
  );
}

function RoadmapRow({ item }: { item: ContentStrategyRoadmapItem }) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        padding: "5px 0",
        borderBottom: "1px solid currentColor",
        opacity: 0.9,
      }}
    >
      <span style={{ fontSize: 12, flex: 1 }}>
        <strong>{item.title}</strong>
        <span style={{ opacity: 0.6 }}> — /{item.slug}</span>
        {item.primaryKeyword && (
          <span style={{ ...SUBTLE, marginLeft: 8 }}>{item.primaryKeyword}</span>
        )}
      </span>
      <ClusterBadge role={item.clusterRole} />
    </li>
  );
}

export function StrategyCard({
  projectId,
  clientId,
  strategy,
  strategyStatus,
  onApproved,
  fetchImpl = fetch,
}: StrategyCardProps) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetchImpl(`/api/projects/${projectId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Approval failed. Try again.");
      } else {
        onApproved?.();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setApproving(false);
    }
  }

  const approved = strategyStatus === "approved";

  return (
    <section
      aria-label="Content strategy"
      data-testid="strategy-card"
      style={{
        border: `1px solid currentColor`,
        borderRadius: 10,
        padding: "0.875rem 1rem",
        opacity: approved ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE, margin: 0 }}>
          Content strategy
        </p>
        {approved ? (
          <span
            data-testid="strategy-approved-badge"
            style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-green, #2ca76e)", opacity: 0.9 }}
          >
            Approved
          </span>
        ) : (
          <button
            type="button"
            data-testid="strategy-approve-btn"
            disabled={approving}
            onClick={approve}
            style={{
              appearance: "none",
              cursor: approving ? "default" : "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              color: "#06121f",
              background: "var(--accent-blue)",
              border: "1px solid var(--accent-blue)",
              borderRadius: 7,
              padding: "4px 10px",
              opacity: approving ? 0.6 : 1,
            }}
          >
            {approving ? "Approving…" : "Approve strategy"}
          </button>
        )}
      </div>

      {/* Objective / audience / market */}
      {(strategy.objective || strategy.audience || strategy.market) && (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "3px 12px",
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          {strategy.objective && (
            <>
              <dt style={LABEL}>Objective</dt>
              <dd data-testid="strategy-objective">{strategy.objective}</dd>
            </>
          )}
          {strategy.audience && (
            <>
              <dt style={LABEL}>Audience</dt>
              <dd data-testid="strategy-audience">{strategy.audience}</dd>
            </>
          )}
          {strategy.market && (
            <>
              <dt style={LABEL}>Market</dt>
              <dd data-testid="strategy-market">{strategy.market}</dd>
            </>
          )}
        </dl>
      )}

      {/* Roadmap */}
      {strategy.roadmap && strategy.roadmap.length > 0 && (
        <>
          <p style={{ ...LABEL, marginBottom: 4 }}>
            Roadmap ({strategy.roadmap.length} page{strategy.roadmap.length !== 1 ? "s" : ""})
          </p>
          <ul
            data-testid="strategy-roadmap"
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {strategy.roadmap.map((item) => (
              <RoadmapRow key={item.slug} item={item} />
            ))}
          </ul>
        </>
      )}

      {error && (
        <p
          data-testid="strategy-approve-error"
          style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 8 }}
        >
          {error}
        </p>
      )}

      {!approved && (
        <p style={{ ...SUBTLE, fontSize: 11, marginTop: 8 }}>
          Approve the strategy to unlock authoring runs.
        </p>
      )}
    </section>
  );
}

export default StrategyCard;
