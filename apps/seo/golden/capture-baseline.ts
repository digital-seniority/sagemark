/**
 * capture-baseline — CAPTURE the golden Stage-A/Stage-B baseline from the REAL
 * `@sagemark/core` kernel (PR 008 / P0.W.5, DR-022).
 *
 * NO FABRICATED NUMBERS. For each corpus piece this runs the REAL `runSeoGate`
 * from `@sagemark/core` (the same gate the worker drives) over the extracted
 * reference body and records its verdict + per-dimension scores as the golden
 * baseline (a characterization test — deterministic, captured from the kernel,
 * never hand-written).
 *
 * DETERMINISM SEAM (documented). `runSeoGate` composes the REAL deterministic
 * scorers (readability/keyword/structure/geo/originality/lexicon/broken-chunk)
 * AND two LLM gates (faithfulness + voice) that, by default, make a live AI
 * Gateway call. A live model call is neither available in the worktree/CI nor
 * deterministic, so the capture INJECTS a fixed, documented verdict for ONLY the
 * two LLM gates (faithfulness = FAITHFUL/100% sourced; voice = PASS) — the
 * professionally-sourced reference content's expected clean signal. Every OTHER
 * dimension, and the whole Stage-A veto ladder, is the REAL kernel's output over
 * the REAL body. The injected LLM verdicts are the documented baseline assumption;
 * a real-Gateway re-capture + expert certification is the follow-up NEEDS-INPUT
 * (DR-022), and does NOT block the regression tripwire.
 *
 * Pure / Node-only. Clean ASCII / UTF-8.
 */

import {
  runSeoGate,
  // The REAL deterministic scorers — captured baselines must run these, not stubs.
  scoreContentBreakdown,
  analyzeKeywordDensity,
  lintBrokenChunks,
  lintBannedLexicon,
  scoreGeoCitation,
  type AuditResult,
  type SeoGateDeps,
  type GateBrief,
  type FaithfulnessResult,
  type VoiceGateResult,
} from "@sagemark/core";

import {
  CORPUS,
  readCorpusPiece,
  type CorpusPiece,
  type ClusterRole,
  type FunnelStage,
} from "./extract-fixture";

// ── The documented LLM-gate baseline (the only injected seam) ──────────────────

/**
 * The fixed faithfulness verdict the capture injects: the reference content is
 * professionally sourced (Alzheimer's Association / NIA / .gov medical authority),
 * so the expected clean baseline is FAITHFUL @ 100% sourced, 0 contradicted. This
 * is the documented baseline assumption (DR-022), NOT a kernel output.
 */
export const BASELINE_FAITHFULNESS: FaithfulnessResult = {
  skipped: false,
  verdict: "FAITHFUL",
  sourcedPercent: 100,
  totalClaims: 0,
  claims: [],
};

/** The fixed voice verdict: the reference content matches the brand guide (PASS). */
export const BASELINE_VOICE: VoiceGateResult = {
  skipped: false,
  overallStatus: "PASS",
  sections: [],
};

/**
 * Build the FULL gate deps: the REAL `@sagemark/core` deterministic scorers
 * (readability/keyword/structure/geo/originality/lexicon/broken-chunk) plus the
 * two LLM gates pinned to the documented baseline. `runSeoGate`'s deps param
 * REPLACES the defaults wholesale, so every deterministic scorer must be wired to
 * its real implementation here — only faithfulness + voice are the injected seam.
 * `over` lets the AC5 weakened-variant test degrade a single scorer.
 */
export function baselineGateDeps(over?: Partial<SeoGateDeps>): SeoGateDeps {
  return {
    scoreContentBreakdown,
    analyzeKeywordDensity,
    lintBrokenChunks,
    lintBannedLexicon,
    scoreGeoCitation,
    runFaithfulnessGate: async () => BASELINE_FAITHFULNESS,
    runContentVoiceGate: async () => BASELINE_VOICE,
    ...over,
  };
}

// ── Brief (the grounding the gate reads) ────────────────────────────────────────

/**
 * The medical-authority sources the reference cluster cites (Alzheimer's
 * Association + NIA). Present so the faithfulness path is sources-backed; the
 * fixed baseline verdict stands in for the live model judgment.
 */
export const BASELINE_SOURCES: GateBrief["sources"] = [
  {
    url: "https://www.alz.org/alzheimers-dementia/10_signs",
    title: "10 Early Signs and Symptoms of Alzheimer's and Dementia",
    snippet: "The Alzheimer's Association lists 10 early warning signs of dementia.",
  },
  {
    url: "https://www.nia.nih.gov/health/alzheimers-and-dementia",
    title: "Alzheimer's Disease and Related Dementias — National Institute on Aging",
    snippet: "Information on dementia, memory care, and caregiving from the NIA.",
  },
];

// ── The golden record shape ─────────────────────────────────────────────────────

/** A captured Stage-B dimension (name + 0-100 score + weight). */
export interface GoldenDimension {
  name: string;
  score: number;
  weight: number;
}

/**
 * One golden piece — the labeled corpus record. The `expected*` fields are
 * CAPTURED from the real kernel; the labels are derived from the content/sitemap.
 */
export interface GoldenPiece {
  /** Golden basename (matches the JSON filename stem). */
  name: string;
  htmlFile: string;
  clusterRole: ClusterRole;
  funnelStage: FunnelStage;
  keyword: string;
  isYmyl: boolean;
  slug: string;
  title: string;
  /** The extracted reference body the gate scored. */
  body: string;
  faqData: Array<{ question: string; answer: string }>;
  /** CAPTURED expected Stage-A clean flag (no veto fired). */
  expectedStageAClean: boolean;
  /** CAPTURED expected verdict band. */
  expectedVerdict: AuditResult["verdict"];
  /** CAPTURED expected composite (null when a Stage-A veto fired). */
  expectedScore: number | null;
  /** CAPTURED expected Stage-B dimensions (empty when vetoed). */
  expectedDimensions: GoldenDimension[];
  /** CAPTURED expected failure codes (vetoes and/or dimension misses). */
  expectedFailureCodes: string[];
  /**
   * Provenance: how the baseline was produced (DR-022). The deterministic
   * dimensions are the real kernel; the two LLM gates are the documented fixed
   * baseline; expert certification is the follow-up NEEDS-INPUT.
   */
  provenance: {
    capturedFrom: "@sagemark/core runSeoGate";
    deterministicScorers: "real";
    llmGates: "baseline-injected (faithfulness=FAITHFUL/100, voice=PASS)";
    certification: "NEEDS-INPUT (expert sign-off; does not block the regression tripwire)";
  };
}

/** Derive a slug from the html filename (the gate's geo-citation reads the slug). */
export function slugFor(piece: CorpusPiece): string {
  return piece.htmlFile.replace(/\.html$/, "").toLowerCase();
}

/**
 * Capture the golden record for one corpus piece by running the REAL kernel gate.
 * `repoRoot` is the repo root (so the demo HTML resolves).
 */
export async function captureGolden(
  repoRoot: string,
  piece: CorpusPiece,
  depsOver?: Partial<SeoGateDeps>,
): Promise<GoldenPiece> {
  const { title, body, faqData } = readCorpusPiece(repoRoot, piece);
  const slug = slugFor(piece);

  const result = await runSeoGate(
    { title, body, slug, faqData, author: { name: "Whispering Willows Care Team", credentials: "Licensed senior-care provider, Skagit County WA" } },
    { keyword: piece.keyword, sources: BASELINE_SOURCES, isYmyl: piece.isYmyl },
    {},
    baselineGateDeps(depsOver),
  );

  return {
    name: piece.goldenName,
    htmlFile: piece.htmlFile,
    clusterRole: piece.clusterRole,
    funnelStage: piece.funnelStage,
    keyword: piece.keyword,
    isYmyl: piece.isYmyl,
    slug,
    title,
    body,
    faqData,
    expectedStageAClean: result.stageAClean,
    expectedVerdict: result.verdict,
    expectedScore: result.score,
    expectedDimensions: result.dimensions.map((d) => ({
      name: d.name,
      score: d.score,
      weight: d.weight,
    })),
    expectedFailureCodes: [...result.failureCodes],
    provenance: {
      capturedFrom: "@sagemark/core runSeoGate",
      deterministicScorers: "real",
      llmGates: "baseline-injected (faithfulness=FAITHFUL/100, voice=PASS)",
      certification: "NEEDS-INPUT (expert sign-off; does not block the regression tripwire)",
    },
  };
}

/** Capture the whole corpus. */
export async function captureCorpus(
  repoRoot: string,
  depsOver?: Partial<SeoGateDeps>,
): Promise<GoldenPiece[]> {
  const out: GoldenPiece[] = [];
  for (const piece of CORPUS) {
    out.push(await captureGolden(repoRoot, piece, depsOver));
  }
  return out;
}
