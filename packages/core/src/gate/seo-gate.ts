/**
 * seo-gate — the non-compensatory gate composer.
 *
 * Ported from flywheel-main `origin/preview`
 * (`apps/agents/src/lib/content/seo-gate.ts`, PR 003 port) into host-side
 * `@sagemark/core`. THE GATE IS THE PRODUCT. It runs in two strictly ordered
 * stages (PRD §4.4):
 *
 *   Stage A — ordered hard vetoes. The FIRST veto that fires short-circuits the
 *             gate to REJECT/REVISE, emits its failure code(s), sets
 *             score = null and stageAClean = false. The Stage-B composite is
 *             NEVER computed when any veto fired (the judge treats a non-null
 *             score on a vetoed draft as a bug).
 *
 *   Stage B — only if Stage A is clean. An 8-dimension weighted 0–100 composite
 *             (readability, keyword, structure/length, faithfulness, voice,
 *             GEO-citation, originality, E-E-A-T) →
 *             PUBLISH ≥ 85 · REVIEW 70–84 · REVISE 50–69 · REJECT < 50.
 *
 * Fail-closed: any deterministic scorer that throws or times out yields a
 * blocking VETO_EVAL_FAILED and a non-publishable verdict (fixes the NextSchool
 * non-fatal-publish bug). An LLM gate (faithfulness/voice) that returns
 * skipped:true is a hard block on a YMYL piece and a soft signal otherwise — but
 * a skipped eval can never advance toward PUBLISH.
 *
 * SINGLE FAIL-CLOSED COMPOSER (DR-005). PR 002 shipped a provisional
 * `scorers/compose.ts` (`runScorersFailClosed` → `VETO_SCORER_THREW`) as a
 * placeholder for "the gate composer." This module IS that composer: the Stage-A
 * deterministic scorers run THROUGH `runScorersFailClosed`, so there is exactly
 * ONE fail-closed composition path in the package. A thrown deterministic scorer
 * surfaces here as the gate's blocking VETO_EVAL_FAILED.
 *
 * ANCHOR DELTAS vs. the source port (engineering-rfc.md §PR 003):
 *   - The Stage-A set has NO `VETO_YMYL_NO_REVIEW`. Requiring a recorded review
 *     to enter `review` is circular; the credentialed-reviewer release is
 *     enforced in `canPublish()` (lifecycle-fsm.ts) on `review→approved`, not as
 *     a Stage-A veto. (Source's Stage-A step 5 + `humanReview` input dropped.)
 *   - A `VETO_YMYL_MISCLASSIFIED` veto is ADDED — the YMYL false-negative guard:
 *     body-level medical-claim signals in a `is_ymyl=false` piece bounce it back
 *     before it can reach Stage B or dodge the YMYL byline veto.
 *
 * PURE COMPOSER: this module makes NO LLM call and reserves NO credits. The two
 * LLM gates (faithfulness/voice) are called by the scorers it composes; the gate
 * logic itself is deterministic orchestration. Clean ASCII / UTF-8.
 *
 * The reused scorer functions are injected (with real defaults) so unit tests
 * can stub each scorer's verdict, exercise every band boundary, and force a
 * throw to assert the fail-closed path — without any network call.
 */

import { FAILURE_CODES, type FailureCode } from "./failure-codes";
import { STAGE_B_WEIGHTS } from "./stage-b-weights";
import { runScorersFailClosed, VETO_SCORER_THREW } from "../scorers/compose";

import {
  scoreContentBreakdown,
  type ContentScoreBreakdown,
} from "../scorers/content-score";
import {
  analyzeKeywordDensity,
  type KeywordDensityResult,
} from "../scorers/keyword-density";
import {
  lintBrokenChunks,
  type BrokenChunkResult,
} from "../scorers/broken-chunk-linter";
import {
  lintBannedLexicon,
  type BannedLexiconResult,
} from "../scorers/banned-lexicon-linter";
import {
  scoreGeoCitation,
  type GeoCitationResult,
  type GeoFaqItem,
} from "../scorers/geo-citation";
import {
  runFaithfulnessGate,
  type FaithfulnessResult,
} from "../gates/faithfulness-gate";
import {
  runContentVoiceGate,
  type VoiceGateResult,
} from "../gates/voice-gate";

// ── Gate result types ─────────────────────────────────────────────────────────
// Ported from the source's `@/app/content/types` (Verdict / GateDimension /
// AuditResult). The shared content-types module is not part of `@sagemark/core`
// yet, so the gate-facing subset lives here (its single authoring site).

/**
 * The four verdict bands the gate can emit.
 *   PUBLISH ≥ 85 · REVIEW 70–84 · REVISE 50–69 · REJECT < 50.
 * A Stage-A veto always resolves to REJECT or REVISE (no composite).
 */
export type Verdict = "PUBLISH" | "REVIEW" | "REVISE" | "REJECT";

/**
 * One of the 8 Stage-B composite dimensions. `score` is normalized 0–100 so the
 * weighted average is a clean 0–100 composite. `weight` is the dimension's fixed
 * contribution (the 8 weights sum to 1.0; see STAGE_B_WEIGHTS).
 */
export interface GateDimension {
  /** Stable dimension key. */
  name:
    | "readability"
    | "keyword"
    | "structure"
    | "faithfulness"
    | "voice"
    | "geo"
    | "originality"
    | "eeat";
  /** Normalized 0–100 sub-score for this dimension. */
  score: number;
  /** Fixed weight (0–1). The 8 weights sum to exactly 1.0. */
  weight: number;
  /** Optional human-readable note on what drove the sub-score (never model prose). */
  detail?: string;
}

/**
 * The typed result of one gate run. Returned by `runSeoGate`.
 *
 * INVARIANT: when `stageAClean === false`, `score === null` and `dimensions`
 * is empty — the Stage-B composite is NEVER computed for a vetoed draft.
 */
export interface AuditResult {
  /** Band verdict (PUBLISH/REVIEW/REVISE/REJECT). */
  verdict: Verdict;
  /** 0–100 weighted composite, or null when a Stage-A veto fired. */
  score: number | null;
  /** The 8 Stage-B dimensions (empty when a Stage-A veto short-circuited). */
  dimensions: GateDimension[];
  /** Stable failure codes (vetoes and/or dimension misses) — never raw prose. */
  failureCodes: FailureCode[];
  /** true when no Stage-A veto fired (Stage B ran). */
  stageAClean: boolean;
}

// ── Stage-B weights (re-exported for convenience) ─────────────────────────────

export { STAGE_B_WEIGHTS } from "./stage-b-weights";

// ── Verdict bands ─────────────────────────────────────────────────────────────

const BAND_PUBLISH = 85;
const BAND_REVIEW = 70;
const BAND_REVISE = 50;

function bandFor(score: number): Verdict {
  if (score >= BAND_PUBLISH) return "PUBLISH";
  if (score >= BAND_REVIEW) return "REVIEW";
  if (score >= BAND_REVISE) return "REVISE";
  return "REJECT";
}

// ── Gate inputs ───────────────────────────────────────────────────────────────

/**
 * The draft under audit. The extended fields (faqData, author) are populated by
 * the brief/draft skills in later PRs; here they are optional so the pure
 * composer never throws on a minimal draft.
 */
export interface GateDraft {
  title: string;
  body: string;
  slug: string;
  /** FAQ entries for the GEO self-containment check. */
  faqData?: GeoFaqItem[] | null;
  /**
   * Resolved E-E-A-T byline author. A truthy author with credentials satisfies
   * the YMYL byline veto. Read from the persisted content_pieces row in PR009.
   */
  author?: { id?: string; name?: string; credentials?: string } | null;
}

/**
 * The brief that grounds the draft.
 *
 * NOTE (anchor delta): the source `GateBrief` carried a `humanReview` field for
 * the now-removed Stage-A `VETO_YMYL_NO_REVIEW`. The gate no longer reads a
 * recorded review — that precondition moved to `canPublish()` (lifecycle-fsm) —
 * so `humanReview` is intentionally absent here.
 */
export interface GateBrief {
  keyword: string;
  sources: Array<{ url: string; title: string; snippet: string }>;
  /**
   * YMYL classification. When true, the YMYL byline veto applies and a skipped
   * LLM gate becomes a hard block. Read from the persisted is_ymyl column
   * (PR009) — never re-derived in the gate. When false, the body-level
   * `ymylSignals` misclassification guard runs (VETO_YMYL_MISCLASSIFIED).
   */
  isYmyl?: boolean;
}

/**
 * The per-client voice spec the gate reads.
 */
export interface GateVoiceSpec {
  /** Client-supplied banned terms (EXTENDS the built-in slop floor). */
  bannedTerms?: string[];
  /** Brand style guide Markdown for the LLM voice gate (gate skips if absent). */
  brandMd?: string;
}

// ── Injectable scorer dependencies (real defaults; stubbed in tests) ──────────

export interface SeoGateDeps {
  scoreContentBreakdown: (body: string, keyword: string) => ContentScoreBreakdown;
  analyzeKeywordDensity: (draft: string, keyword: string) => KeywordDensityResult;
  lintBrokenChunks: (body: string) => BrokenChunkResult;
  lintBannedLexicon: (body: string, bannedTerms?: string[]) => BannedLexiconResult;
  scoreGeoCitation: (
    body: string,
    slug: string,
    faqData?: GeoFaqItem[] | null,
  ) => GeoCitationResult;
  runFaithfulnessGate: (
    draft: { body: string },
    brief: { sources: GateBrief["sources"] },
  ) => Promise<FaithfulnessResult>;
  runContentVoiceGate: (
    draft: { title: string; body: string },
    brandMd: string | undefined,
  ) => Promise<VoiceGateResult>;
}

const DEFAULT_DEPS: SeoGateDeps = {
  scoreContentBreakdown,
  analyzeKeywordDensity,
  lintBrokenChunks,
  lintBannedLexicon,
  scoreGeoCitation,
  runFaithfulnessGate,
  runContentVoiceGate,
};

// ── YMYL body-signal detector (false-negative guard) ──────────────────────────

/**
 * Conservative, high-precision medical-claim / YMYL lexicon used to detect a
 * MISCLASSIFIED piece (a body that reads YMYL while `is_ymyl=false`). Mirrors
 * the topic-level `ymyl-classifier` category keywords (health / medication /
 * safety / senior-care / end-of-life), restricted to the high-confidence
 * medical-claim signals so a generic marketing body does not trip the guard.
 *
 * Lowercase only (the body is lowercased before matching).
 */
const YMYL_BODY_SIGNALS: readonly string[] = [
  // health / clinical
  "disease",
  "dementia",
  "alzheimer",
  "symptom",
  "diagnosis",
  "diagnose",
  "treatment",
  "therapy",
  "clinical",
  "patient",
  // medication
  "medication",
  "prescription",
  "dosage",
  "side effect",
  // safety
  "fall prevention",
  // senior-care
  "memory care",
  "assisted living",
  "nursing home",
  // end-of-life
  "hospice",
  "palliative",
] as const;

/**
 * Detect body-level YMYL signals. Returns the stable `topic-category`-style
 * tokens of every signal that fired (never prose). Empty when the body carries
 * no medical-claim signal. Pure + deterministic.
 */
export function ymylSignals(body: string): string[] {
  const lc = (body ?? "").toLowerCase();
  const hits: string[] = [];
  for (const signal of YMYL_BODY_SIGNALS) {
    if (lc.includes(signal)) {
      hits.push(`ymyl-body-signal:${signal}`);
    }
  }
  return hits;
}

// ── Fail-closed deterministic composition (the single composer, DR-005) ───────

/**
 * Marker thrown internally to short-circuit the gate to a fail-closed
 * VETO_EVAL_FAILED when any LLM gate throws.
 */
class EvalFailedError extends Error {
  constructor(readonly scorer: string) {
    super(`scorer "${scorer}" failed to run`);
    this.name = "EvalFailedError";
  }
}

/** Run an async LLM gate; any throw/reject becomes a fail-closed EvalFailedError. */
async function runGate<T>(scorer: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new EvalFailedError(scorer);
  }
}

/** The bundle of deterministic scorer outputs, computed fail-closed in one pass. */
interface DeterministicScores {
  broken: BrokenChunkResult;
  keyword: KeywordDensityResult;
  breakdown: ContentScoreBreakdown;
  lexicon: BannedLexiconResult;
  geo: GeoCitationResult;
}

// ── Result factories ──────────────────────────────────────────────────────────

/** A Stage-A veto result: REJECT/REVISE, no composite, dimensions empty. */
function vetoResult(verdict: "REJECT" | "REVISE", codes: FailureCode[]): AuditResult {
  return {
    verdict,
    score: null,
    dimensions: [],
    failureCodes: codes,
    stageAClean: false,
  };
}

// ── Adapter helpers (native scorer verdict → gate dimension sub-score) ─────────

/** A 0–5 sub-score (from content-score.ts DimensionScore) → 0–100. */
function fiveToHundred(score: number): number {
  return Math.round((score / 5) * 100);
}

/** Pull a named 0–5 dimension out of the content-score breakdown. */
function dimScore(breakdown: ContentScoreBreakdown, name: string): number {
  const d = breakdown.dimensions.find((x) => x.name === name);
  return d ? fiveToHundred(d.score) : 0;
}

/**
 * Faithfulness 0–100 sub-score. FAITHFUL/PARTIAL map off sourcedPercent; a
 * skipped non-YMYL gate is a soft-but-capped signal (can never reach PUBLISH on
 * its own merit — capped below the PUBLISH band).
 */
function faithfulnessScore(f: FaithfulnessResult): number {
  if (f.skipped) {
    // Soft signal on non-YMYL (YMYL skips are vetoed in Stage A before we get here).
    return Math.min(BAND_REVIEW, 60);
  }
  return Math.max(0, Math.min(100, f.sourcedPercent));
}

/** Voice 0–100 sub-score from the LLM voice gate (PASS/WARN/SKIP — FAIL is a Stage-A veto). */
function voiceScore(v: VoiceGateResult): number {
  if (v.skipped) return 60; // soft signal; never a PUBLISH driver on its own
  if (v.overallStatus === "PASS") return 100;
  if (v.overallStatus === "WARN") return 70;
  return 0; // FAIL never reaches Stage B (vetoed)
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the non-compensatory SEO gate over a draft.
 *
 * @param draft     - the draft under audit (body/slug/title + optional YMYL fields)
 * @param brief     - the grounding brief (sources, keyword, isYmyl)
 * @param voiceSpec - the per-client voice spec (bannedTerms, brandMd)
 * @param deps      - injectable scorer fns (real defaults; stubbed in tests)
 * @returns AuditResult — never throws; a scorer throw becomes VETO_EVAL_FAILED.
 */
export async function runSeoGate(
  draft: GateDraft,
  brief: GateBrief,
  voiceSpec: GateVoiceSpec = {},
  deps: SeoGateDeps = DEFAULT_DEPS,
): Promise<AuditResult> {
  const isYmyl = brief.isYmyl === true;

  try {
    // ── Run deterministic scorers THROUGH the single fail-closed composer ─────
    // (DR-005: exactly one fail-closed composition path. A throw here resolves
    // to VETO_SCORER_THREW, which the gate maps to its blocking VETO_EVAL_FAILED.)
    const composition = runScorersFailClosed<unknown>([
      { name: "broken-chunk-linter", run: () => deps.lintBrokenChunks(draft.body) },
      { name: "keyword-density", run: () => deps.analyzeKeywordDensity(draft.body, brief.keyword) },
      { name: "content-score", run: () => deps.scoreContentBreakdown(draft.body, brief.keyword) },
      { name: "banned-lexicon-linter", run: () => deps.lintBannedLexicon(draft.body, voiceSpec.bannedTerms) },
      { name: "geo-citation", run: () => deps.scoreGeoCitation(draft.body, draft.slug, draft.faqData) },
    ]);

    if (!composition.passed) {
      // A deterministic scorer threw — fail closed (VETO_SCORER_THREW is the
      // composer's code; the gate surfaces its own blocking VETO_EVAL_FAILED).
      if (composition.failureCode === VETO_SCORER_THREW) {
        return vetoResult("REJECT", [FAILURE_CODES.VETO_EVAL_FAILED]);
      }
      return vetoResult("REJECT", [FAILURE_CODES.VETO_EVAL_FAILED]);
    }

    // Index access is provably in-bounds: `runScorersFailClosed` pushes exactly
    // one result per input scorer in order and only returns `passed: true` after
    // the full loop, so when we reach here `composition.results` has the same 5
    // elements (indices 0–4) as the scorer array above. The non-null assertions
    // are compile-time only — they change no runtime behavior.
    const det: DeterministicScores = {
      broken: composition.results[0]!.result as BrokenChunkResult,
      keyword: composition.results[1]!.result as KeywordDensityResult,
      breakdown: composition.results[2]!.result as ContentScoreBreakdown,
      lexicon: composition.results[3]!.result as BannedLexiconResult,
      geo: composition.results[4]!.result as GeoCitationResult,
    };

    // LLM gates (also fail-closed on throw/reject).
    const faithfulness = await runGate("faithfulness-gate", () =>
      deps.runFaithfulnessGate({ body: draft.body }, { sources: brief.sources }),
    );
    const voice = await runGate("voice-gate", () =>
      deps.runContentVoiceGate({ title: draft.title, body: draft.body }, voiceSpec.brandMd),
    );

    // ── STAGE A — ordered hard vetoes (first match short-circuits) ────────────

    // 1. Broken chunk / information-island.
    if (!det.broken.passed) {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_BROKEN_CHUNK]);
    }

    // 2. Fabricated / unsourced stat. UNFAITHFUL verdict OR any CONTRADICTED/
    //    UNSOURCED claim trips the veto. A skipped LLM gate is a hard block on
    //    YMYL (cannot publish a claim you could not verify).
    const hasUnsourced =
      faithfulness.verdict === "UNFAITHFUL" ||
      faithfulness.claims.some(
        (c) => c.verdict === "UNSOURCED" || c.verdict === "CONTRADICTED",
      );
    if (hasUnsourced) {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_UNSOURCED_STAT]);
    }
    if (isYmyl && faithfulness.skipped) {
      // YMYL piece whose faithfulness could not be verified — fail closed.
      return vetoResult("REVISE", [FAILURE_CODES.VETO_UNSOURCED_STAT]);
    }

    // 3. Keyword stuffing — single source of truth: keyword-density status.
    if (det.keyword.status === "stuffed") {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_KEYWORD_STUFF]);
    }

    // 4. YMYL false-negative guard — body reads YMYL while is_ymyl=false.
    //    A misclassified piece is bounced before it can reach Stage B or dodge
    //    the YMYL byline veto. (Anchor-mandated; engineering-rfc.md §PR 003.)
    if (!isYmyl) {
      const signals = ymylSignals(draft.body);
      if (signals.length > 0) {
        return vetoResult("REVISE", [FAILURE_CODES.VETO_YMYL_MISCLASSIFIED]);
      }
    }

    // 5. YMYL — no byline (named author + credentials required).
    if (isYmyl) {
      const hasByline =
        !!draft.author &&
        !!draft.author.name &&
        draft.author.name.trim().length > 0 &&
        !!draft.author.credentials &&
        draft.author.credentials.trim().length > 0;
      if (!hasByline) {
        return vetoResult("REVISE", [FAILURE_CODES.VETO_YMYL_NO_BYLINE]);
      }
    }

    // NOTE: the source's Stage-A step 5 (VETO_YMYL_NO_REVIEW) is intentionally
    // NOT ported. Requiring a recorded review to enter `review` is circular; the
    // credentialed-reviewer release is enforced in canPublish() (lifecycle-fsm)
    // on review→approved, not as a Stage-A veto. (engineering-rfc.md §PR 003.)

    // 6. Near-duplicate / thin content (content-score originality at the floor).
    //    "Content Density" is the originality dimension's display name.
    const originality100 = dimScore(det.breakdown, "Content Density");
    if (originality100 <= 20) {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_THIN_CONTENT]);
    }

    // 7. Banned lexicon / AI-slop.
    if (!det.lexicon.passed) {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_BANNED_LEXICON]);
    }

    // 8. Voice gate FAIL (brand-voice contradiction).
    if (!voice.skipped && voice.overallStatus === "FAIL") {
      return vetoResult("REVISE", [FAILURE_CODES.VETO_VOICE_FAIL]);
    }

    // ── STAGE B — 8-dimension weighted 0–100 composite (Stage A clean) ────────

    const w = STAGE_B_WEIGHTS;
    const dimensions: GateDimension[] = [
      {
        name: "readability",
        score: dimScore(det.breakdown, "Readability"),
        weight: w.readability,
      },
      {
        name: "keyword",
        score: dimScore(det.breakdown, "Keyword Density"),
        weight: w.keyword,
      },
      {
        name: "structure",
        // Structure/length: average the two content-score sub-scores.
        score: Math.round(
          (dimScore(det.breakdown, "Structure") + dimScore(det.breakdown, "Length")) / 2,
        ),
        weight: w.structure,
      },
      {
        name: "faithfulness",
        score: faithfulnessScore(faithfulness),
        weight: w.faithfulness,
      },
      { name: "voice", score: voiceScore(voice), weight: w.voice },
      { name: "geo", score: Math.max(0, Math.min(100, det.geo.score)), weight: w.geo },
      {
        name: "originality",
        score: originality100,
        weight: w.originality,
      },
      {
        name: "eeat",
        // E-E-A-T / chunk integrity: broken-chunk passed (we're past the veto) +
        // GEO attribution signal. Use the GEO source-attribution checks as the
        // deterministic proxy until a richer author/credentials scorer lands.
        score: eeatScore(det.geo, isYmyl, draft.author),
        weight: w.eeat,
      },
    ];

    const composite = Math.round(
      dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
    );
    const verdict = bandFor(composite);

    // Dimension-miss markers (informational; never short-circuit).
    const dimCodes = dimensionMisses(dimensions);

    return {
      verdict,
      score: composite,
      dimensions,
      failureCodes: dimCodes,
      stageAClean: true,
    };
  } catch (err) {
    // Fail-closed: any scorer throw/timeout → blocking VETO_EVAL_FAILED.
    if (err instanceof EvalFailedError) {
      return vetoResult("REJECT", [FAILURE_CODES.VETO_EVAL_FAILED]);
    }
    // Any other unexpected error is also non-publishable (fail closed).
    return vetoResult("REJECT", [FAILURE_CODES.VETO_EVAL_FAILED]);
  }
}

// ── E-E-A-T proxy ─────────────────────────────────────────────────────────────

/**
 * Deterministic E-E-A-T sub-score proxy: GEO attribution signals plus, on a YMYL
 * piece, a credited author. (Stage A already guarantees the byline on YMYL, so
 * here it only nudges the score.)
 */
function eeatScore(
  geo: GeoCitationResult,
  isYmyl: boolean,
  author: GateDraft["author"],
): number {
  const attribution = geo.checks.find((c) => c.name === "source_attribution");
  const attributed = geo.checks.find((c) => c.name === "attributed_source");
  let base = 50;
  if (attribution?.passed) base += 20;
  if (attributed?.passed) base += 20;
  if (isYmyl && author?.credentials) base += 10;
  return Math.max(0, Math.min(100, base));
}

// ── Dimension-miss markers ────────────────────────────────────────────────────

const DIM_MISS_THRESHOLD = 50;

function dimensionMisses(dimensions: GateDimension[]): FailureCode[] {
  const map: Record<GateDimension["name"], FailureCode> = {
    readability: FAILURE_CODES.DIM_READABILITY_LOW,
    keyword: FAILURE_CODES.DIM_KEYWORD_LOW,
    structure: FAILURE_CODES.DIM_STRUCTURE_LOW,
    faithfulness: FAILURE_CODES.DIM_FAITHFULNESS_LOW,
    voice: FAILURE_CODES.DIM_VOICE_LOW,
    geo: FAILURE_CODES.DIM_GEO_LOW,
    originality: FAILURE_CODES.DIM_ORIGINALITY_LOW,
    eeat: FAILURE_CODES.DIM_EEAT_LOW,
  };
  return dimensions
    .filter((d) => d.score < DIM_MISS_THRESHOLD)
    .map((d) => map[d.name]);
}
