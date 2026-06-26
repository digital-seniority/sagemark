/**
 * ScoreSignalDot — a single verdict-keyed signal dot + short band label.
 *
 * EXTRACTED from the 4x-duplicated dot in videogen's `adgen/new/ResultPanel.tsx`
 * (the RFC notes the duplication): each copy rendered the same `<span dot/><span
 * label/>` keyed on a verdict band, diverging only in the threshold->colour map.
 * This is the one shared, SEO-gate-aware version: it keys on the deterministic
 * gate's verdict band (PUBLISH / REVIEW / REVISE / REJECT) and surfaces the
 * Stage-B composite as a tooltip, so the canvas (left agent rows, the inspector
 * scorecard, the artifact header) all read ONE signal vocabulary.
 *
 * BRAND TOKENS, NO HARDCODED PALETTE. apps/seo defines only `--background` /
 * `--foreground` in `globals.css` and the existing studio components colour
 * everything from `currentColor` + opacity (see VoiceSpecEditor / DraftResult).
 * To keep a single source of truth we follow that convention: the dot's intensity
 * (opacity) + an accessible verdict word + a `data-verdict` attribute carry the
 * signal — never a hardcoded `bg-emerald-500` / hex. A later theming PR can map
 * `data-verdict` to brand accent tokens in CSS without touching this component.
 *
 * Pure + presentational. Clean ASCII / UTF-8.
 */

/** The deterministic-gate verdict bands (mirrors `gate_results.verdict`). */
export type GateVerdict = "PUBLISH" | "REVIEW" | "REVISE" | "REJECT";

export interface ScoreSignalDotProps {
  /** The verdict band, or null when no gate has produced a verdict yet. */
  verdict: GateVerdict | string | null;
  /** The Stage-B composite 0-100, surfaced in the tooltip when present. */
  score?: number | null;
  /** Render the short band word next to the dot (default true). */
  showLabel?: boolean;
  /** Optional override aria/title text (defaults to a verdict + score summary). */
  title?: string;
}

/**
 * The dot's fill opacity per band — a confident PUBLISH reads solid, a REJECT
 * reads faint, all from `currentColor` so it inherits the brand foreground token.
 * (Opacity is the brand-safe signal channel here; a future themed build can swap
 * `data-verdict` -> accent colours in CSS.)
 */
const VERDICT_OPACITY: Record<GateVerdict, number> = {
  PUBLISH: 1,
  REVIEW: 0.7,
  REVISE: 0.45,
  REJECT: 0.25,
};

/** Normalize an arbitrary verdict string to a known band, or null. */
export function normalizeVerdict(verdict: string | null | undefined): GateVerdict | null {
  if (typeof verdict !== "string") return null;
  const v = verdict.trim().toUpperCase();
  return v === "PUBLISH" || v === "REVIEW" || v === "REVISE" || v === "REJECT"
    ? (v as GateVerdict)
    : null;
}

export function ScoreSignalDot(props: ScoreSignalDotProps) {
  const { verdict, score, showLabel = true, title } = props;
  const band = normalizeVerdict(typeof verdict === "string" ? verdict : null);

  // Fall back to a faint, low-confidence dot for an unknown / not-yet-run verdict.
  const opacity = band ? VERDICT_OPACITY[band] : 0.2;
  const labelText = band ?? "PENDING";
  const tooltip =
    title ??
    (band
      ? `${band}${typeof score === "number" ? ` · ${score}/100` : ""}`
      : "No verdict yet");

  return (
    <span
      className="score-signal-dot"
      data-verdict={band ?? "PENDING"}
      title={tooltip}
      aria-label={tooltip}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "currentColor",
          opacity,
          // A hairline ring keeps a faint REJECT/PENDING dot visible on any bg.
          boxShadow: "0 0 0 1px color-mix(in srgb, currentColor 30%, transparent)",
        }}
      />
      {showLabel && (
        <span style={{ fontWeight: 600, letterSpacing: "0.04em", opacity: 0.8 }}>
          {labelText}
        </span>
      )}
    </span>
  );
}

export default ScoreSignalDot;
