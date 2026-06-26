"use client";

/**
 * StageAVetoes — the Stage-A hard-veto row of the Inspector gate scorecard
 * (PR 011 / P1.U.2).
 *
 * Stage A is the non-compensatory veto pass (`@sagemark/core` `seo-gate.ts`): the
 * FIRST veto that fires short-circuits the gate to REJECT/REVISE and suppresses the
 * Stage-B composite. This component renders the authoritative server gate's veto
 * codes (from the `gate` SSE event's `vetoes[]`) as STABLE CODES with a
 * human-readable caption — never raw model prose (the codes are the
 * injection-surface discipline the taxonomy enforces). A clean Stage A renders an
 * explicit "no vetoes" pass marker so the operator can tell "clean" from "not run".
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

/**
 * Human-readable captions for the stable Stage-A veto codes
 * (`@sagemark/core` `failure-codes.ts` VETO_*). The CODE is the source of truth
 * shown to the operator; the caption is a fixed gloss (never model prose). An
 * unknown/forward-compatible code falls back to the raw code.
 */
export const VETO_CAPTIONS: Record<string, string> = {
  VETO_BROKEN_CHUNK: "Heading-less / context-orphaned section",
  VETO_UNSOURCED_STAT: "Statistic or quote not traced to a source",
  VETO_KEYWORD_STUFF: "Keyword stuffing / unnatural repetition",
  VETO_YMYL_MISCLASSIFIED: "Reads YMYL but flagged non-YMYL",
  VETO_YMYL_NO_BYLINE: "YMYL piece missing a credentialed byline",
  VETO_THIN_CONTENT: "Near-duplicate / thin content",
  VETO_BANNED_LEXICON: "Prohibited terms / AI-slop phrasing",
  VETO_VOICE_FAIL: "Brand-voice contradiction (voice gate FAIL)",
  VETO_EVAL_FAILED: "A deterministic scorer failed (fail-closed)",
};

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

export interface StageAVetoesProps {
  /** The Stage-A veto codes that fired (empty = clean). */
  vetoes: string[];
  /** Whether a gate has run at all (false = no scorecard yet). */
  hasGate: boolean;
}

export function StageAVetoes({ vetoes, hasGate }: StageAVetoesProps) {
  return (
    <section data-testid="stage-a-vetoes" aria-label="Stage A vetoes">
      <p style={{ ...SUBTLE, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>
        Stage A · vetoes
      </p>

      {!hasGate ? (
        <p data-testid="stage-a-pending" style={{ ...SUBTLE, margin: 0 }}>
          Not run yet.
        </p>
      ) : vetoes.length === 0 ? (
        <p data-testid="stage-a-clean" style={{ ...SUBTLE, margin: 0 }}>
          Clean — no hard vetoes fired.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {vetoes.map((code) => (
            <li
              key={code}
              data-testid="stage-a-veto"
              data-veto-code={code}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                border: "1px solid currentColor",
                borderRadius: 8,
                padding: "0.5rem 0.625rem",
                background: "color-mix(in srgb, currentColor 8%, transparent)",
              }}
            >
              <code style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.02em" }}>{code}</code>
              <span style={SUBTLE}>{VETO_CAPTIONS[code] ?? "Stage-A veto"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default StageAVetoes;
