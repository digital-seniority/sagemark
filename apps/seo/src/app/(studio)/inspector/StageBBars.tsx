"use client";

/**
 * StageBBars — the Stage-B dimension bars of the Inspector gate scorecard
 * (PR 011 / P1.U.2).
 *
 * The authoritative `gate` SSE event carries only the Stage-B COMPOSITE (score +
 * verdict), not the per-dimension breakdown — so the dimension bars here are the
 * ZERO-CREDIT LIVE PREVIEW: the deterministic per-dimension sub-scores recomputed
 * from `@sagemark/core`'s `scoreContentBreakdown` over the current editor body
 * (`use-client-scorers.ts`). These are the SAME deterministic dimensions the real
 * Stage-B composite weighs (readability / keyword / structure / length / content
 * density), so the bars preview where the composite is trending WITHOUT spending a
 * gate run. They are explicitly labeled "live preview (uncredited)" so they are
 * never read as the authoritative server composite — that lives in the VerdictBand
 * above, sourced from the `gate` event.
 *
 * Bars render from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

// Type-only import from the pure scorer subpath (not the barrel; see
// use-client-scorers.ts for why the barrel is avoided in client code).
import type { ContentScoreBreakdown } from "@sagemark/core/scorers/content-score";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

export interface StageBBarsProps {
  /** The deterministic content-score breakdown from the client scorers. */
  content: ContentScoreBreakdown;
  /** Whether the body has enough text for the preview to be meaningful. */
  hasBody: boolean;
}

export function StageBBars({ content, hasBody }: StageBBarsProps) {
  return (
    <section data-testid="stage-b-bars" aria-label="Stage B dimension preview">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <p style={{ ...SUBTLE, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
          Stage B · dimensions
        </p>
        <span data-testid="stage-b-preview-label" style={{ ...SUBTLE, fontSize: 10, fontStyle: "italic" }}>
          live preview (uncredited)
        </span>
      </div>

      {!hasBody ? (
        <p data-testid="stage-b-empty" style={{ ...SUBTLE, margin: 0 }}>
          Dimension preview appears as the body fills in.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div data-testid="stage-b-composite" style={{ ...SUBTLE, marginBottom: 2 }}>
            Deterministic composite (preview): <strong>{content.totalScore}/100</strong> · grade {content.grade}
          </div>
          {content.dimensions.map((d) => {
            const pct = Math.max(0, Math.min(100, d.percentage));
            return (
              <div key={d.name} data-testid="stage-b-bar" data-dimension={d.name}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <span>{d.name}</span>
                  <span style={{ opacity: 0.7 }} data-testid="stage-b-bar-value">
                    {d.score}/{d.maxScore}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    height: 6,
                    marginTop: 3,
                    borderRadius: 999,
                    background: "color-mix(in srgb, currentColor 12%, transparent)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "currentColor",
                      opacity: 0.55,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default StageBBars;
