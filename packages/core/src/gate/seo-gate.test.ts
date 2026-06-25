/**
 * seo-gate tests — ported from flywheel-main `origin/preview`
 * (`apps/agents/src/lib/content/seo-gate.test.ts`) into `@sagemark/core`, with
 * the PR 003 anchor deltas (engineering-rfc.md §PR 003):
 *   - the `VETO_YMYL_NO_REVIEW` Stage-A test is removed (that veto is gone — the
 *     credentialed-reviewer release is enforced in canPublish(), not Stage-A);
 *   - net-new coverage for `VETO_YMYL_MISCLASSIFIED` (the YMYL false-negative
 *     guard, criterion 2);
 *   - the live-scorer Tier-2 fixtures carry `isYmyl: true` (a memory-care body
 *     IS YMYL), so they exercise the live deterministic scorers without tripping
 *     the new misclassification guard.
 */

import { describe, it, expect } from "vitest";
import {
  runSeoGate,
  ymylSignals,
  STAGE_B_WEIGHTS,
  type SeoGateDeps,
  type GateDraft,
  type GateBrief,
  type GateVoiceSpec,
} from "./seo-gate";
import { FAILURE_CODES, VETO_CODES, isVetoCode } from "./failure-codes";
import {
  scoreContentBreakdown as realScoreContentBreakdown,
  type ContentScoreBreakdown,
} from "../scorers/content-score";
import {
  analyzeKeywordDensity as realAnalyzeKeywordDensity,
  type KeywordDensityResult,
} from "../scorers/keyword-density";
import {
  lintBrokenChunks as realLintBrokenChunks,
  type BrokenChunkResult,
} from "../scorers/broken-chunk-linter";
import {
  lintBannedLexicon as realLintBannedLexicon,
  type BannedLexiconResult,
} from "../scorers/banned-lexicon-linter";
import {
  scoreGeoCitation as realScoreGeoCitation,
  type GeoCitationResult,
} from "../scorers/geo-citation";
import type { FaithfulnessResult } from "../gates/faithfulness-gate";
import type { VoiceGateResult } from "../gates/voice-gate";

// ── Stub builders ─────────────────────────────────────────────────────────────

/** A content-score breakdown whose 5 sub-scores are all the given 0–5 value. */
function breakdown(score = 5): ContentScoreBreakdown {
  const dim = (name: string) => ({
    name,
    score,
    maxScore: 5,
    percentage: (score / 5) * 100,
    rationale: "",
    tip: "",
  });
  return {
    totalScore: (score / 5) * 100,
    grade: "A",
    dimensions: [
      dim("Readability"),
      dim("Keyword Density"),
      dim("Structure"),
      dim("Length"),
      dim("Content Density"),
    ],
  };
}

function keyword(status: KeywordDensityResult["status"] = "optimal"): KeywordDensityResult {
  return {
    keyword: "garden tools",
    occurrences: 10,
    wordCount: 1000,
    densityPercent: status === "stuffed" ? 5 : status === "under" ? 0.2 : 1.5,
    status,
    recommendation: "",
  };
}

function broken(passed = true): BrokenChunkResult {
  return passed
    ? { passed: true, brokenSections: [] }
    : { passed: false, brokenSections: ["Orphan block"], failureCode: "VETO_BROKEN_CHUNK" };
}

function lexicon(passed = true): BannedLexiconResult {
  return passed
    ? { passed: true, hits: [] }
    : {
        passed: false,
        hits: [{ term: "synergy", count: 2, source: "client" }],
        failureCode: "VETO_BANNED_LEXICON",
      };
}

function geo(score = 90): GeoCitationResult {
  return {
    score,
    checks: [
      { name: "source_attribution", passed: true, penalty: 0, detail: "" },
      { name: "attributed_source", passed: true, penalty: 0, detail: "" },
    ],
    failures: [],
  };
}

function faithful(over: Partial<FaithfulnessResult> = {}): FaithfulnessResult {
  return {
    sourcedPercent: 100,
    totalClaims: 3,
    sourcedCount: 3,
    unsourcedCount: 0,
    contradictedCount: 0,
    claims: [{ claim: "x", verdict: "SOURCED" }],
    verdict: "FAITHFUL",
    skipped: false,
    ...over,
  };
}

function voice(over: Partial<VoiceGateResult> = {}): VoiceGateResult {
  return {
    overallStatus: "PASS",
    passed: true,
    sections: [],
    skipped: false,
    ...over,
  };
}

/** Build a full dep set; override any scorer per-test. */
function makeDeps(over: Partial<SeoGateDeps> = {}): SeoGateDeps {
  return {
    scoreContentBreakdown: () => breakdown(5),
    analyzeKeywordDensity: () => keyword("optimal"),
    lintBrokenChunks: () => broken(true),
    lintBannedLexicon: () => lexicon(true),
    scoreGeoCitation: () => geo(90),
    runFaithfulnessGate: async () => faithful(),
    runContentVoiceGate: async () => voice(),
    ...over,
  };
}

// A neutral, non-YMYL body — carries NO medical-claim signal so the
// misclassification guard never fires on the baseline draft.
const DRAFT: GateDraft = {
  title: "Choosing Garden Tools",
  slug: "choosing-garden-tools",
  body: "## Section\n\nA self-contained body with enough prose to score for the shed.",
  faqData: [],
};

const BRIEF: GateBrief = {
  keyword: "garden tools",
  sources: [{ url: "https://example.com", title: "Tools", snippet: "facts" }],
};

const VOICE_SPEC: GateVoiceSpec = { bannedTerms: [], brandMd: undefined };

// ── Shape / acceptance criteria ───────────────────────────────────────────────

describe("runSeoGate — result shape", () => {
  it("returns AuditResult with verdict, score, dimensions[], failureCodes[], stageAClean", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps());
    expect(r).toHaveProperty("verdict");
    expect(r).toHaveProperty("score");
    expect(Array.isArray(r.dimensions)).toBe(true);
    expect(Array.isArray(r.failureCodes)).toBe(true);
    expect(typeof r.stageAClean).toBe("boolean");
  });

  it("clean draft → Stage B runs, 8 dimensions, 0–100 composite", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps());
    expect(r.stageAClean).toBe(true);
    expect(r.dimensions).toHaveLength(8);
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(0);
    expect(r.score!).toBeLessThanOrEqual(100);
  });
});

// ── Stage-A vetoes: each short-circuits with score === null ───────────────────

describe("Stage A — each hard veto short-circuits with score === null", () => {
  it("broken chunk → VETO_BROKEN_CHUNK, no composite", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ lintBrokenChunks: () => broken(false) }));
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_BROKEN_CHUNK);
    expect(r.score).toBeNull();
    expect(r.stageAClean).toBe(false);
    expect(r.dimensions).toHaveLength(0);
    expect(["REJECT", "REVISE"]).toContain(r.verdict);
  });

  it("unsourced stat (UNFAITHFUL) → VETO_UNSOURCED_STAT, no composite", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        runFaithfulnessGate: async () =>
          faithful({ verdict: "UNFAITHFUL", sourcedPercent: 40, claims: [{ claim: "y", verdict: "UNSOURCED" }] }),
      }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_UNSOURCED_STAT);
    expect(r.score).toBeNull();
    expect(r.stageAClean).toBe(false);
  });

  it("contradicted claim alone → VETO_UNSOURCED_STAT", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        runFaithfulnessGate: async () =>
          faithful({ claims: [{ claim: "z", verdict: "CONTRADICTED", notes: "conflicts" }] }),
      }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_UNSOURCED_STAT);
    expect(r.score).toBeNull();
  });

  it("keyword stuffing → VETO_KEYWORD_STUFF, no composite", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ analyzeKeywordDensity: () => keyword("stuffed") }));
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_KEYWORD_STUFF);
    expect(r.score).toBeNull();
  });

  it("YMYL with no byline → VETO_YMYL_NO_BYLINE", async () => {
    const r = await runSeoGate(DRAFT, { ...BRIEF, isYmyl: true }, VOICE_SPEC, makeDeps());
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_YMYL_NO_BYLINE);
    expect(r.score).toBeNull();
  });

  it("YMYL fully credentialed → passes Stage A (no recorded-review veto in Stage A)", async () => {
    // ANCHOR: the Stage-A set has NO VETO_YMYL_NO_REVIEW. A credentialed byline
    // is enough to clear Stage A; the credentialed-reviewer release is enforced
    // separately in canPublish() (lifecycle-fsm), not here.
    const draft: GateDraft = { ...DRAFT, author: { name: "Dr. Smith", credentials: "RN" } };
    const r = await runSeoGate(draft, { ...BRIEF, isYmyl: true }, VOICE_SPEC, makeDeps());
    expect(r.stageAClean).toBe(true);
    expect(r.score).not.toBeNull();
    expect(r.failureCodes).not.toContain(FAILURE_CODES.VETO_YMYL_NO_BYLINE);
  });

  it("thin content (originality at floor) → VETO_THIN_CONTENT", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ scoreContentBreakdown: () => breakdown(1) }));
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_THIN_CONTENT);
    expect(r.score).toBeNull();
  });

  it("banned lexicon → VETO_BANNED_LEXICON", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ lintBannedLexicon: () => lexicon(false) }));
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_BANNED_LEXICON);
    expect(r.score).toBeNull();
  });

  it("voice FAIL → VETO_VOICE_FAIL", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({ runContentVoiceGate: async () => voice({ overallStatus: "FAIL", passed: false }) }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_VOICE_FAIL);
    expect(r.score).toBeNull();
  });

  it("YMYL faithfulness skipped → hard block VETO_UNSOURCED_STAT", async () => {
    const draft: GateDraft = { ...DRAFT, author: { name: "Dr. Smith", credentials: "RN" } };
    const brief: GateBrief = { ...BRIEF, isYmyl: true };
    const r = await runSeoGate(
      draft,
      brief,
      VOICE_SPEC,
      makeDeps({ runFaithfulnessGate: async () => faithful({ skipped: true, skipReason: "no-sources", verdict: "PARTIAL", claims: [] }) }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_UNSOURCED_STAT);
    expect(r.score).toBeNull();
  });
});

// ── Criterion 2 — YMYL false-negative guard (VETO_YMYL_MISCLASSIFIED) ─────────

describe("Stage A — YMYL misclassification guard (criterion 2)", () => {
  it("medical-claim body with is_ymyl=false → VETO_YMYL_MISCLASSIFIED, no composite", async () => {
    const medicalDraft: GateDraft = {
      title: "Spotting Early Dementia",
      slug: "spotting-early-dementia",
      body:
        "## Early Signs\n\nA dementia diagnosis often starts with subtle symptoms. " +
        "Memory care and medication can help manage Alzheimer's disease over time.",
      faqData: [],
    };
    // is_ymyl deliberately omitted (false) — the body, however, reads YMYL.
    const r = await runSeoGate(medicalDraft, { ...BRIEF, isYmyl: false }, VOICE_SPEC, makeDeps());
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_YMYL_MISCLASSIFIED);
    expect(r.score).toBeNull();
    expect(r.stageAClean).toBe(false);
    expect(["REJECT", "REVISE"]).toContain(r.verdict);
  });

  it("the same medical-claim body with is_ymyl=true does NOT trip the guard", async () => {
    const medicalDraft: GateDraft = {
      title: "Spotting Early Dementia",
      slug: "spotting-early-dementia",
      body:
        "## Early Signs\n\nA dementia diagnosis often starts with subtle symptoms. " +
        "Memory care and medication can help manage Alzheimer's disease over time.",
      faqData: [],
      author: { name: "Dr. Smith", credentials: "RN" },
    };
    const r = await runSeoGate(medicalDraft, { ...BRIEF, isYmyl: true }, VOICE_SPEC, makeDeps());
    expect(r.failureCodes).not.toContain(FAILURE_CODES.VETO_YMYL_MISCLASSIFIED);
  });

  it("a non-medical body with is_ymyl=false passes the guard", async () => {
    const r = await runSeoGate(DRAFT, { ...BRIEF, isYmyl: false }, VOICE_SPEC, makeDeps());
    expect(r.failureCodes).not.toContain(FAILURE_CODES.VETO_YMYL_MISCLASSIFIED);
    expect(r.stageAClean).toBe(true);
  });

  it("ymylSignals detector emits stable tokens for medical-claim text and nothing for neutral text", () => {
    const sig = ymylSignals("A dementia diagnosis and ongoing memory care plan.");
    expect(sig.length).toBeGreaterThan(0);
    for (const s of sig) expect(s.startsWith("ymyl-body-signal:")).toBe(true);
    expect(ymylSignals("Tips for choosing a sturdy garden trowel.")).toHaveLength(0);
  });
});

// ── Stage ordering: broken chunk fires before any later veto ──────────────────

describe("Stage A ordering — first veto wins, composite never computed", () => {
  it("broken chunk short-circuits even when later vetoes would also fire", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        lintBrokenChunks: () => broken(false),
        analyzeKeywordDensity: () => keyword("stuffed"),
        lintBannedLexicon: () => lexicon(false),
      }),
    );
    expect(r.failureCodes).toEqual([FAILURE_CODES.VETO_BROKEN_CHUNK]);
    expect(r.score).toBeNull();
  });
});

// ── Band boundaries (85 / 70 / 50) ────────────────────────────────────────────

function bandDeps(contentFive: number, geoFaithVoice: number): Partial<SeoGateDeps> {
  return {
    scoreContentBreakdown: () => breakdown(contentFive),
    scoreGeoCitation: () => geo(geoFaithVoice),
    runFaithfulnessGate: async () => faithful({ sourcedPercent: geoFaithVoice }),
    runContentVoiceGate: async () =>
      voice({ overallStatus: geoFaithVoice >= 100 ? "PASS" : "WARN" }),
  };
}

describe("Stage B — verdict band boundaries", () => {
  it("all-max dimensions → PUBLISH (>=85)", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ ...bandDeps(5, 100) }));
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(85);
    expect(r.verdict).toBe("PUBLISH");
  });

  it("composite in 70–84 → REVIEW", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ ...bandDeps(4, 75) }));
    expect(r.score!).toBeGreaterThanOrEqual(70);
    expect(r.score!).toBeLessThan(85);
    expect(r.verdict).toBe("REVIEW");
  });

  it("composite in 50–69 → REVISE", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ ...bandDeps(3, 55) }));
    expect(r.score!).toBeGreaterThanOrEqual(50);
    expect(r.score!).toBeLessThan(70);
    expect(r.verdict).toBe("REVISE");
  });

  it("composite < 50 → REJECT (Stage B, not a veto)", async () => {
    const r = await runSeoGate(DRAFT, BRIEF, VOICE_SPEC, makeDeps({ ...bandDeps(2, 30) }));
    expect(r.stageAClean).toBe(true);
    expect(r.score!).toBeLessThan(50);
    expect(r.verdict).toBe("REJECT");
  });

  it("exact boundary: composite of exactly 85 → PUBLISH", async () => {
    const allEighty5: ContentScoreBreakdown = {
      totalScore: 85,
      grade: "A",
      dimensions: ["Readability", "Keyword Density", "Structure", "Length", "Content Density"].map(
        (name) => ({ name, score: 85 / 20, maxScore: 5, percentage: 85, rationale: "", tip: "" }),
      ),
    };
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        scoreContentBreakdown: () => allEighty5,
        scoreGeoCitation: () => geo(85),
        runFaithfulnessGate: async () => faithful({ sourcedPercent: 85 }),
        runContentVoiceGate: async () => voice({ overallStatus: "PASS" }),
      }),
    );
    expect(r.score!).toBeGreaterThanOrEqual(85);
    expect(r.verdict).toBe("PUBLISH");
  });
});

// ── Fail-closed: injected throw → VETO_EVAL_FAILED ────────────────────────────

describe("fail-closed — a throwing scorer yields VETO_EVAL_FAILED, non-publishable", () => {
  it("deterministic scorer throw → VETO_EVAL_FAILED, REJECT, score null", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        scoreGeoCitation: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_EVAL_FAILED);
    expect(r.verdict).toBe("REJECT");
    expect(r.score).toBeNull();
    expect(r.stageAClean).toBe(false);
  });

  it("LLM gate rejection → VETO_EVAL_FAILED (fail closed, never silent pass)", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({
        runFaithfulnessGate: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_EVAL_FAILED);
    expect(r.verdict).not.toBe("PUBLISH");
    expect(r.score).toBeNull();
  });
});

// ── Weight invariant (criterion 3): sum === 1.0, faithfulness strictly max ────

describe("Stage-B weight invariant (asserts the invariant, not magic numbers)", () => {
  const entries = Object.entries(STAGE_B_WEIGHTS) as [string, number][];

  it("the 8 weights sum to exactly 1.0", () => {
    const sum = entries.reduce((s, [, w]) => s + w, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it("there are exactly 8 dimensions", () => {
    expect(entries).toHaveLength(8);
  });

  it("faithfulness carries the STRICTLY greatest weight — no ties (== 0.20)", () => {
    const faith = STAGE_B_WEIGHTS.faithfulness;
    expect(faith).toBe(0.2);
    for (const [name, w] of entries) {
      if (name === "faithfulness") continue;
      expect(faith).toBeGreaterThan(w);
    }
  });

  it("no single dimension can drag a vetoed draft over the line (veto → score null)", async () => {
    const r = await runSeoGate(
      DRAFT,
      BRIEF,
      VOICE_SPEC,
      makeDeps({ scoreContentBreakdown: () => breakdown(5), lintBrokenChunks: () => broken(false) }),
    );
    expect(r.score).toBeNull();
    expect(r.verdict).not.toBe("PUBLISH");
  });
});

// ── Tier 2: end-to-end over a real draft with LIVE deterministic scorers ──────
// Only the two haiku LLM gates are stubbed (no network); broken-chunk,
// keyword-density, content-score, banned-lexicon, and geo-citation run for real.
// The fixtures are memory-care pieces, so they carry isYmyl:true (and a byline)
// to satisfy the YMYL byline veto and clear the misclassification guard.

const REAL_DRAFT_BODY = `## What Is Memory Care?

Memory care is a specialized form of long-term care for people living with
Alzheimer's disease and other forms of dementia. Roughly 6 million Americans
live with Alzheimer's, and that number is projected to reach 13 million by 2050
according to the Alzheimer's Association annual report.

## How Memory Care Differs From Assisted Living

Assisted living supports daily tasks like bathing and medication. Memory care
adds secured environments, structured routines, and staff trained in dementia
behaviors. A typical memory care community maintains a higher staff-to-resident
ratio than standard assisted living, often around one caregiver for every five
residents during daytime hours.

## Choosing The Right Community

Families should tour at least three communities before deciding. Ask about staff
training hours, the resident-to-caregiver ratio, and how the team handles
sundowning. Research from the National Institute on Aging shows that consistent
routines reduce agitation in residents with moderate dementia.`;

function buildLiveDeps(): SeoGateDeps {
  return {
    scoreContentBreakdown: realScoreContentBreakdown,
    analyzeKeywordDensity: realAnalyzeKeywordDensity,
    lintBrokenChunks: realLintBrokenChunks,
    lintBannedLexicon: realLintBannedLexicon,
    scoreGeoCitation: realScoreGeoCitation,
    runFaithfulnessGate: async () => faithful({ sourcedPercent: 90 }),
    runContentVoiceGate: async () => voice({ overallStatus: "PASS" }),
  };
}

describe("Tier 2 — live deterministic scorers over a real draft fixture", () => {
  it("a well-formed, grounded YMYL draft passes Stage A and produces a composite", async () => {
    const draft: GateDraft = {
      title: "Memory Care: A Family Guide",
      slug: "memory-care-family-guide",
      body: REAL_DRAFT_BODY,
      faqData: [],
      author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
    };
    const brief: GateBrief = {
      keyword: "memory care",
      isYmyl: true,
      sources: [
        { url: "https://www.alz.org", title: "Alzheimer's Association", snippet: "6 million Americans" },
        { url: "https://www.nia.nih.gov", title: "NIA", snippet: "routines reduce agitation" },
      ],
    };
    const live = await runSeoGate(draft, brief, { bannedTerms: [] }, buildLiveDeps());
    expect(live.stageAClean).toBe(true);
    expect(live.score).not.toBeNull();
    expect(live.dimensions).toHaveLength(8);
  });

  it("a real draft with an AI-slop phrase is vetoed by the live banned-lexicon scorer", async () => {
    const slopBody = REAL_DRAFT_BODY + "\n\n## Conclusion\n\nIn conclusion, memory care matters.";
    const draft: GateDraft = {
      title: "Memory Care Guide",
      slug: "memory-care-guide",
      body: slopBody,
      faqData: [],
      author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
    };
    const brief: GateBrief = { keyword: "memory care", isYmyl: true, sources: [] };
    const r = await runSeoGate(draft, brief, { bannedTerms: [] }, buildLiveDeps());
    expect(r.failureCodes).toContain(FAILURE_CODES.VETO_BANNED_LEXICON);
    expect(r.score).toBeNull();
  });
});

// ── Failure-code taxonomy ─────────────────────────────────────────────────────

describe("failure-codes taxonomy", () => {
  it("every VETO_* code is recognized as a veto", () => {
    for (const code of Object.values(VETO_CODES)) {
      expect(isVetoCode(code)).toBe(true);
    }
  });

  it("a DIM_* code is not a veto", () => {
    expect(isVetoCode(FAILURE_CODES.DIM_GEO_LOW)).toBe(false);
  });

  it("VETO_YMYL_NO_REVIEW is NOT part of the Stage-A taxonomy (anchor)", () => {
    expect((VETO_CODES as Record<string, string>).VETO_YMYL_NO_REVIEW).toBeUndefined();
  });

  it("VETO_YMYL_MISCLASSIFIED IS a recognized veto", () => {
    expect(isVetoCode(FAILURE_CODES.VETO_YMYL_MISCLASSIFIED)).toBe(true);
  });
});
