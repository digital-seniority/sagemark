/**
 * DraftResult — the operator scorecard view (PR 009).
 *
 * Mirrors the apps/agents `DraftResult` operator surface: it renders the PERSISTED
 * gate scorecard (the `gate_results` projection) + the resolved publish-gate
 * status for one piece, so an operator can see WHY a piece can or cannot publish.
 *
 * It is purely presentational and reads ONLY persisted/derived state — it makes no
 * publish decision of its own. The publish decision is the server's
 * (`canPublish()` in `@sagemark/core`); this view reflects it. Critically it shows
 * the fail-closed truth: a `PUBLISH` verdict alone does NOT mean published (no
 * autopilot) — a recorded human RELEASE is also required, and the view surfaces
 * the blocking reason when one is missing.
 *
 * Colors/fonts from the globals.css `--background`/`--foreground` tokens via
 * `currentColor` + opacity (no hardcoded palette).
 */

import type { TransitionRejection } from "@sagemark/core";

/** The persisted scorecard projection (a `gate_results` row). */
export interface DraftScorecard {
  /** Whether the eval actually ran (gate_results.eval_ran). */
  evalRan: boolean;
  /** Stage-A veto codes that fired (empty when clean). */
  stageAVetoes: string[];
  /** Stage-B composite 0-100, or null when a veto suppressed scoring. */
  stageBScore: number | null;
  /** The verdict band, or null when no gate ran. */
  verdict: "PUBLISH" | "REVIEW" | "REVISE" | "REJECT" | null;
}

export interface DraftResultProps {
  pieceId: string;
  slug: string;
  title: string;
  status: string;
  isYmyl: boolean;
  scorecard: DraftScorecard | null;
  /**
   * Whether the server's `canPublish()` currently permits publishing this piece.
   * Resolved server-side and passed in — the view never recomputes the gate.
   */
  canPublish: boolean;
  /**
   * The stable FSM reason publish is blocked (when `canPublish === false`), or null
   * when publishable. Never prose — a machine code surfaced for the operator.
   */
  blockedReason?: TransitionRejection | null;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };
const CARD: React.CSSProperties = {
  border: "1px solid currentColor",
  borderRadius: 10,
  padding: "1rem 1.25rem",
};

/** Map a stable FSM reject code to a short operator-facing explanation. */
const REASON_LABELS: Record<TransitionRejection, string> = {
  ILLEGAL_EDGE: "This piece is not in a publishable state.",
  PUBLISH_DISABLED: "Publishing is globally disabled (fail-safe).",
  VERDICT_NOT_PUBLISH: "The gate verdict is not PUBLISH.",
  NO_HUMAN_RELEASE: "No recorded credentialed release (a client sign-off cannot release).",
  EVAL_DID_NOT_RUN: "The eval did not run — no usable scorecard.",
  YMYL_NO_BYLINE: "YMYL piece needs a named, credentialed byline.",
  YMYL_NO_CITATIONS: "YMYL piece needs authoritative citations.",
  VERDICT_NOT_APPROVABLE: "The verdict is not approvable.",
};

export function DraftResult(props: DraftResultProps) {
  const { pieceId, slug, title, status, isYmyl, scorecard, canPublish, blockedReason } = props;

  return (
    <section
      aria-label="Draft scorecard"
      data-piece-id={pieceId}
      data-can-publish={canPublish ? "true" : "false"}
      style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1.5rem", display: "grid", gap: 16 }}
    >
      <header>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
          {status}
          {isYmyl ? " · YMYL" : ""}
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{title}</h1>
        <p style={SUBTLE}>/{slug}</p>
      </header>

      <div style={CARD}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", ...SUBTLE }}>
          Gate scorecard
        </h2>
        {scorecard ? (
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", marginTop: 10 }}>
            <dt style={SUBTLE}>Eval ran</dt>
            <dd data-testid="eval-ran">{scorecard.evalRan ? "yes" : "no"}</dd>
            <dt style={SUBTLE}>Verdict</dt>
            <dd data-testid="verdict">{scorecard.verdict ?? "—"}</dd>
            <dt style={SUBTLE}>Stage-B score</dt>
            <dd data-testid="stage-b-score">{scorecard.stageBScore ?? "— (vetoed)"}</dd>
            <dt style={SUBTLE}>Stage-A vetoes</dt>
            <dd data-testid="stage-a-vetoes">
              {scorecard.stageAVetoes.length > 0 ? scorecard.stageAVetoes.join(", ") : "none"}
            </dd>
          </dl>
        ) : (
          <p style={{ ...SUBTLE, marginTop: 10 }} data-testid="no-scorecard">
            No gate has run yet — the eval has not produced a scorecard.
          </p>
        )}
      </div>

      <div style={CARD}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", ...SUBTLE }}>
          Publish gate
        </h2>
        {canPublish ? (
          <p data-testid="publishable" style={{ marginTop: 10 }}>
            All preconditions met — this piece can be published.
          </p>
        ) : (
          <p data-testid="blocked" style={{ marginTop: 10 }}>
            Blocked:{" "}
            <strong>{blockedReason ?? "ILLEGAL_EDGE"}</strong>
            {" — "}
            {blockedReason ? REASON_LABELS[blockedReason] : REASON_LABELS.ILLEGAL_EDGE}
          </p>
        )}
        <p style={{ ...SUBTLE, marginTop: 8 }}>
          A PUBLISH verdict alone does not publish — a recorded credentialed release
          is always required (no autopilot).
        </p>
      </div>
    </section>
  );
}

export default DraftResult;
