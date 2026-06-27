"use client";

/**
 * InspectorRail — the COLLAPSED form of the Inspector zone (agent-ui).
 *
 * When the operator collapses the right-hand Inspector to widen the center
 * artifact reading view, the inspector column shrinks from `minmax(260px,320px)`
 * to a narrow ~48px rail rendered by this component. The rail is a single real
 * `<button>` (the whole rail is the expand affordance) carrying `aria-expanded`
 * + `aria-label`, and it shows, top-to-bottom:
 *
 *   1. an expand chevron (points left, "open the panel"),
 *   2. a COMPACT VERDICT INDICATOR — a small at-a-glance badge derived from the
 *      ALREADY-PROJECTED `state.scorecard.verdict` (NOT recomputed): a check glyph
 *      when the draft is publish-eligible (verdict === "PUBLISH"), otherwise the
 *      faint signal dot for the current band. We reuse `ScoreSignalDot` /
 *      `normalizeVerdict` so the rail reads the SAME verdict vocabulary + brand
 *      token (currentColor + opacity) as the full scorecard — no recompute, no
 *      hardcoded palette,
 *   3. a vertical "Gate" label.
 *
 * IMPORTANT: collapsing is PURELY VISUAL. The publish gate is ALWAYS enforced
 * server-side (`@sagemark/core` `seo-gate.ts` via `/api/publish`); hiding the
 * scorecard never disables or bypasses it — the rail just defers the detail.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette), matching
 * SeoStudioCanvas / ScoreSignalDot. Clean ASCII / UTF-8.
 */

import type { GateScorecard } from "@/lib/stream/use-ui-message-stream";
import { normalizeVerdict } from "@/components/ScoreSignalDot";

const SUBTLE: React.CSSProperties = { opacity: 0.6 };

export interface InspectorRailProps {
  /** The authoritative gate scorecard projection (from `gate` SSE events), or null. */
  scorecard: GateScorecard | null;
  /** Expand the inspector back to the full panel. */
  onExpand: () => void;
}

export function InspectorRail({ scorecard, onExpand }: InspectorRailProps) {
  const band = normalizeVerdict(scorecard?.verdict ?? null);
  const publishEligible = band === "PUBLISH";
  // The compact badge reads the PROJECTED verdict — it never recomputes the gate.
  const badgeTitle = band
    ? `Verdict: ${band}${typeof scorecard?.score === "number" ? ` · ${scorecard.score}/100` : ""}`
    : "No verdict yet";

  return (
    <button
      type="button"
      data-testid="inspector-rail"
      data-verdict={band ?? "PENDING"}
      aria-expanded={false}
      aria-label="Expand inspector (gate scorecard)"
      onClick={onExpand}
      style={{
        // The whole rail is the expand affordance.
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        width: "100%",
        height: "100%",
        padding: "0.75rem 0",
        background: "transparent",
        color: "inherit",
        border: "none",
        cursor: "pointer",
        font: "inherit",
        outline: "none",
      }}
    >
      {/* 1. Expand chevron (points left toward the panel it will reveal). */}
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1, ...SUBTLE }}>
        &#x2039;
      </span>

      {/* 2. Compact verdict indicator — check when publish-eligible, else a faint
          band-keyed dot. Derived from state.scorecard (no recompute). */}
      <span
        data-testid="rail-verdict-badge"
        data-verdict={band ?? "PENDING"}
        title={badgeTitle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          // The same currentColor + opacity signal channel as ScoreSignalDot.
          boxShadow: `0 0 0 1px color-mix(in srgb, currentColor ${publishEligible ? 60 : 30}%, transparent)`,
          opacity: publishEligible ? 1 : band ? 0.7 : 0.35,
          fontSize: 13,
        }}
      >
        {publishEligible ? (
          <span aria-hidden="true">&#x2713;</span>
        ) : (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
        )}
      </span>

      {/* 3. Vertical "Gate" label. */}
      <span
        aria-hidden="true"
        style={{
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          fontSize: 11,
          marginTop: 4,
          ...SUBTLE,
        }}
      >
        Gate
      </span>
    </button>
  );
}

export default InspectorRail;
