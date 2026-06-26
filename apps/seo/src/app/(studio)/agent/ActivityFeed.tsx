"use client";

/**
 * ActivityFeed — the bounded-edit history in the agent zone (PR 012 / P1.U.3).
 *
 * The Slice-1 edit floor made visible. After the operator asks for a bounded
 * conversational edit (`/api/edit`), each accepted edit lands here as one row:
 * the model's one-line `summary` of WHAT changed + the verdict band the FULL gate
 * re-computed on the EDITED piece + the new version number. So the operator can
 * SEE that every edit was re-gated — including an edit that REGRESSED the gate
 * (a REVISE/REJECT band on the row is the faithfulness-break being caught, made
 * visible). It NEVER shows a publish affordance: an edit writes a gated DRAFT
 * version; publishing stays the separate fail-closed path (PR 009).
 *
 * It mirrors the agent-zone conventions (the `AgentMessageStream` ordered-list
 * shape, `currentColor` + opacity palette, stable test ids). Presentational only
 * — it reads an already-projected `EditActivityItem[]`. Clean ASCII / UTF-8.
 */

/** A verdict band the gate can emit (mirrors `@sagemark/core` `Verdict`). */
export type EditVerdict = "PUBLISH" | "REVIEW" | "REVISE" | "REJECT";

/** One accepted bounded edit, after its full gate re-run. */
export interface EditActivityItem {
  /** Stable key — the new version number is unique per piece. */
  version: number;
  /** The model's one-line summary of the bounded change (never raw body prose). */
  summary: string;
  /** The verdict the FULL gate re-computed on the EDITED body. */
  verdict: EditVerdict | null;
  /** The Stage-B composite (0-100), or null when a Stage-A veto suppressed scoring. */
  score: number | null;
  /** True when no Stage-A veto fired (Stage B ran). False = a veto caught the edit. */
  stageAClean: boolean;
}

export interface ActivityFeedProps {
  /** The ordered edit history (most recent last), already projected. */
  edits: EditActivityItem[];
}

/** Verdict band -> opacity weight (publish-grade reads strongest). No hardcoded hue. */
const VERDICT_OPACITY: Record<EditVerdict, number> = {
  PUBLISH: 0.9,
  REVIEW: 0.75,
  REVISE: 0.6,
  REJECT: 0.45,
};

function VerdictPill({ verdict, stageAClean }: { verdict: EditVerdict | null; stageAClean: boolean }) {
  const label = verdict ?? "PENDING";
  const opacity = verdict ? VERDICT_OPACITY[verdict] : 0.4;
  return (
    <span
      data-testid="edit-verdict"
      data-verdict={label}
      data-stage-a-clean={stageAClean ? "true" : "false"}
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid currentColor",
        opacity,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function ActivityFeed({ edits }: ActivityFeedProps) {
  if (edits.length === 0) {
    return (
      <p
        data-testid="edit-feed-empty"
        style={{ fontSize: 13, opacity: 0.45, margin: 0 }}
      >
        No edits yet. Ask for a scoped change to fine-tune this piece.
      </p>
    );
  }

  return (
    <ol
      data-testid="edit-feed"
      aria-label="Edit activity"
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}
    >
      {edits.map((item) => (
        <li
          key={`edit:v${item.version}`}
          data-testid="edit-row"
          data-version={item.version}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 13,
            padding: "0.5rem 0.625rem",
            border: "1px solid currentColor",
            borderRadius: 8,
            background: "color-mix(in srgb, currentColor 5%, transparent)",
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.5, marginRight: 6 }}>v{item.version}</span>
            <span data-testid="edit-summary">{item.summary}</span>
            {item.score != null && (
              <span style={{ opacity: 0.55, marginLeft: 6 }}>· {item.score}/100</span>
            )}
          </span>
          <VerdictPill verdict={item.verdict} stageAClean={item.stageAClean} />
        </li>
      ))}
    </ol>
  );
}

export default ActivityFeed;
