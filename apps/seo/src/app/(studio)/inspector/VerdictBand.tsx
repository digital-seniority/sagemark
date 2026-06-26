"use client";

/**
 * VerdictBand — the headline verdict block of the Inspector gate scorecard
 * (PR 011 / P1.U.2).
 *
 * Renders the authoritative server gate's verdict band + composite score with the
 * shared `ScoreSignalDot` vocabulary. The bands are the deterministic gate's own
 * thresholds (`@sagemark/core` `seo-gate.ts`): PUBLISH >= 85 · REVIEW 70-84 ·
 * REVISE 50-69 · REJECT < 50. A Stage-A veto resolves to REJECT/REVISE with a null
 * score (no composite is ever computed for a vetoed draft) — surfaced here as
 * "vetoed" rather than a fabricated number.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import { ScoreSignalDot } from "@/components/ScoreSignalDot";

/**
 * The deterministic gate's verdict-band thresholds, mirrored from
 * `@sagemark/core` `seo-gate.ts` (BAND_PUBLISH/BAND_REVIEW/BAND_REVISE) for the
 * inline band legend. The authoritative band still comes from the server gate;
 * this is the human-readable threshold caption only.
 */
export const VERDICT_BANDS: ReadonlyArray<{ band: string; caption: string }> = [
  { band: "PUBLISH", caption: ">= 85" },
  { band: "REVIEW", caption: "70-84" },
  { band: "REVISE", caption: "50-69" },
  { band: "REJECT", caption: "< 50" },
];

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

export interface VerdictBandProps {
  /** The verdict band string, or null until a gate frame arrives. */
  verdict: string | null;
  /** The Stage-B composite 0-100, or null when a veto suppressed scoring. */
  score: number | null;
  /** true when a Stage-A veto fired (score is null because it was suppressed). */
  vetoed: boolean;
}

export function VerdictBand({ verdict, score, vetoed }: VerdictBandProps) {
  return (
    <div
      data-testid="verdict-band"
      data-verdict={verdict ?? "PENDING"}
      style={{ border: "1px solid currentColor", borderRadius: 10, padding: "0.875rem 1rem" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ ...SUBTLE, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Verdict
        </span>
        <ScoreSignalDot verdict={verdict} score={score} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span data-testid="verdict-score" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
          {vetoed ? "—" : score ?? "—"}
        </span>
        <span style={SUBTLE}>{vetoed ? "vetoed (no composite)" : "/ 100"}</span>
      </div>

      {/* The deterministic band legend (thresholds from @sagemark/core seo-gate). */}
      <dl
        data-testid="verdict-band-legend"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "2px 10px",
          marginTop: 10,
          ...SUBTLE,
        }}
      >
        {VERDICT_BANDS.map(({ band, caption }) => (
          <div key={band} style={{ display: "contents" }}>
            <dt style={{ fontWeight: 600, opacity: verdict === band ? 1 : 0.7 }}>{band}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{caption}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default VerdictBand;
