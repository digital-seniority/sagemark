/**
 * regression.test — the golden-set regression tripwire (PR 008 / P0.W.5).
 *
 * THE METHODOLOGY-DRIFT TRIPWIRE. The Whispering Willows golden corpus
 * (`apps/seo/golden/whispering-willows/*.json`) is a labeled baseline CAPTURED
 * from the REAL `@sagemark/core` kernel (DR-022). This suite re-runs the SAME
 * kernel gate over the SAME captured bodies and asserts the Stage-A verdict +
 * Stage-B dimensions reproduce within a documented tolerance band. Any change to
 * the model / tool-order / skill-config / scorer that shifts a golden piece
 * outside tolerance FAILS here — the regression catches drift before it ships.
 *
 * The corpus is checked in BEFORE the suite skill is exercised against it (AC1):
 * these JSON files are the ground truth; `load-suite` + the worker drive the same
 * kernel route the gate composes.
 *
 * Deterministic seam (DR-022): the two LLM gates (faithfulness/voice) are pinned
 * to the documented baseline (the same seam the capture used) so the regression
 * is reproducible with no provider key; every other dimension + the whole Stage-A
 * ladder is the real kernel over the real body.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import { runSeoGate, type SeoGateDeps } from "@sagemark/core";

import { baselineGateDeps, BASELINE_SOURCES, captureGolden, type GoldenPiece } from "../../golden/capture-baseline";
import { CORPUS } from "../../golden/extract-fixture";
import { repoRootFromHere } from "./_capture";

// ── Tolerance band (documented) ─────────────────────────────────────────────────

/**
 * Stage-B tolerance: a captured dimension/composite may drift by at most this
 * many points before the tripwire fires. The deterministic scorers are exact, so
 * a tight band catches any methodology change; the band exists only to absorb
 * future non-semantic rounding, never a real verdict shift.
 */
export const STAGE_B_TOLERANCE = 3;

// ── Load the checked-in corpus ──────────────────────────────────────────────────

const GOLDEN_DIR = path.resolve(__dirname, "..", "..", "golden", "whispering-willows");

function loadGolden(): GoldenPiece[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as GoldenPiece);
}

/** Re-run the kernel gate over a golden piece's captured body (baseline deps). */
async function regate(piece: GoldenPiece, depsOver?: Partial<SeoGateDeps>) {
  return runSeoGate(
    {
      title: piece.title,
      body: piece.body,
      slug: piece.slug,
      faqData: piece.faqData,
      author: { name: "Whispering Willows Care Team", credentials: "Licensed senior-care provider, Skagit County WA" },
    },
    { keyword: piece.keyword, sources: BASELINE_SOURCES, isYmyl: piece.isYmyl },
    {},
    baselineGateDeps(depsOver),
  );
}

const corpus = loadGolden();

// ── A genuinely Stage-A-clean draft for the tripwire tests ──────────────────────

/**
 * The honest Whispering Willows demo content is INTENTIONALLY vetoed by the real
 * kernel for em-dash spam (>=3 literal em-dashes is a Stage-A `VETO_BANNED_LEXICON`),
 * so the captured corpus has no Stage-A-clean piece (that veto is the correct,
 * honest baseline — judge fix #1, DR-022). The AC5/AC6 tripwire proofs need a draft
 * the kernel scores CLEAN. We synthesize one HERE, at test time only, by removing
 * the em-dash slop from a real golden body — i.e. the de-slopped draft a copywriter
 * would emit. This transform lives in the TEST, never in the extraction/capture path,
 * so it cannot mask a captured baseline (the meta-check below enforces that).
 */
async function cleanDraftBaseline(): Promise<{ piece: GoldenPiece; result: Awaited<ReturnType<typeof regate>> }> {
  // Start from any captured piece, de-slop its body (drop em-dashes), and re-gate
  // until the kernel reports Stage-A clean.
  for (const p of corpus) {
    const deslopped: GoldenPiece = {
      ...p,
      body: p.body.replace(/—/g, ", ").replace(/\s+,/g, ","),
    };
    const r = await regate(deslopped);
    if (r.stageAClean) return { piece: deslopped, result: r };
  }
  throw new Error("no de-slopped golden body scores Stage-A clean — tripwire setup is broken");
}

// ── AC1: the corpus is checked in (10 labeled pieces, pillar+spokes+faq+checklist) ─

describe("golden corpus presence (AC1)", () => {
  it("has all 10 labeled pieces with the full label + expectation schema", () => {
    expect(corpus.length).toBe(10);
    const names = corpus.map((p) => p.name).sort();
    expect(names).toContain("pillar");
    expect(names).toContain("faq");
    expect(names).toContain("checklist");
    expect(names.filter((n) => n.startsWith("spoke-")).length).toBe(7);

    const roles = new Set(corpus.map((p) => p.clusterRole));
    expect(roles).toEqual(new Set(["pillar", "spoke", "faq", "checklist"]));

    for (const p of corpus) {
      // Labels derived (AC1).
      expect(["pillar", "spoke", "faq", "checklist"]).toContain(p.clusterRole);
      expect(["TOFU", "MOFU", "BOFU"]).toContain(p.funnelStage);
      expect(p.keyword.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(500);
      // Captured baseline present (not fabricated — provenance recorded).
      expect(p.provenance.capturedFrom).toBe("@sagemark/core runSeoGate");
      expect(typeof p.expectedStageAClean).toBe("boolean");
      expect(["PUBLISH", "REVIEW", "REVISE", "REJECT"]).toContain(p.expectedVerdict);
    }
  });
});

// ── AC3: re-running the real kernel reproduces each captured baseline ────────────

describe("golden regression — kernel reproduces the captured baseline (AC3)", () => {
  for (const piece of corpus) {
    it(`${piece.name}: Stage-A verdict + Stage-B dimensions reproduce within tolerance`, async () => {
      const r = await regate(piece);

      // Stage-A clean flag + verdict band reproduce EXACTLY (no tolerance on the band).
      expect(r.stageAClean).toBe(piece.expectedStageAClean);
      expect(r.verdict).toBe(piece.expectedVerdict);

      if (piece.expectedStageAClean) {
        // Composite within the tolerance band.
        expect(r.score).not.toBeNull();
        expect(Math.abs((r.score ?? -999) - (piece.expectedScore ?? -1000))).toBeLessThanOrEqual(
          STAGE_B_TOLERANCE,
        );
        // Every captured dimension reproduces within tolerance.
        for (const expDim of piece.expectedDimensions) {
          const got = r.dimensions.find((d) => d.name === expDim.name);
          expect(got, `dimension ${expDim.name} missing`).toBeDefined();
          expect(Math.abs((got!.score ?? -999) - expDim.score)).toBeLessThanOrEqual(
            STAGE_B_TOLERANCE,
          );
          expect(got!.weight).toBe(expDim.weight);
        }
      } else {
        // A vetoed piece reproduces its veto codes exactly (no composite).
        expect(r.score).toBeNull();
        expect(r.failureCodes.sort()).toEqual([...piece.expectedFailureCodes].sort());
      }
    });
  }
});

// ── Meta-check: the extraction transform scores EXACTLY what the kernel sees ─────

/**
 * THE ANTI-MASKING INVARIANT (judge fix #1). The bug this guards against: an
 * extraction-time transform (e.g. the removed em-dash -> " - " slop normalization)
 * silently changing a Stage-A veto outcome, so the captured baseline describes a
 * SANITIZED variant the kernel never sees. We re-run the WHOLE extract->gate path
 * from the raw demo HTML on disk (`captureGolden`, the same path the generator used)
 * and assert the freshly-extracted+gated `stageAClean`/`failureCodes` MATCH the
 * stored baseline EXACTLY. If any future extraction transform alters a veto outcome,
 * the freshly-captured result diverges from the checked-in JSON and this fails —
 * the masking class cannot silently return.
 */
describe("anti-masking meta-check — extraction does not alter a captured veto outcome", () => {
  const repoRoot = repoRootFromHere();
  const byName = new Map(corpus.map((p) => [p.name, p]));

  for (const cp of CORPUS) {
    it(`${cp.goldenName}: re-extract + re-gate reproduces the stored clean/codes exactly`, async () => {
      const stored = byName.get(cp.goldenName);
      expect(stored, `golden ${cp.goldenName} present`).toBeDefined();

      // Re-run the full extract->gate path from the raw demo HTML (no shortcuts).
      const fresh = await captureGolden(repoRoot, cp);

      // The extraction must not change the Stage-A veto outcome the kernel sees.
      expect(fresh.expectedStageAClean).toBe(stored!.expectedStageAClean);
      expect([...fresh.expectedFailureCodes].sort()).toEqual(
        [...stored!.expectedFailureCodes].sort(),
      );

      // And the extracted body the gate scored is byte-identical to the stored body
      // (so the captured baseline IS what the kernel sees — em-dashes included).
      expect(fresh.body).toBe(stored!.body);

      // Concretely prove the body still carries the em-dash density the linter reads
      // for any piece the kernel vetoed on banned lexicon (no silent normalization).
      if (stored!.expectedFailureCodes.includes("VETO_BANNED_LEXICON")) {
        const emDashes = (fresh.body.match(/—/g) ?? []).length;
        expect(emDashes).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("a hypothetical extraction transform that strips em-dashes WOULD flip the veto (proving the meta-check has teeth)", async () => {
    // Sanity: if extraction DID strip em-dashes (the old slop mask), a vetoed piece
    // would re-gate as clean — i.e. the outcome WOULD change. The meta-check above
    // would then fail. We demonstrate the divergence here so the guard is not vacuous.
    const vetoed = corpus.find((p) => p.expectedFailureCodes.includes("VETO_BANNED_LEXICON"));
    expect(vetoed, "at least one piece is vetoed for banned lexicon").toBeDefined();

    const masked = await regate({
      ...vetoed!,
      body: vetoed!.body.replace(/—/g, " - "), // the REMOVED slop transform
    });
    // The masked variant no longer trips the banned-lexicon veto -> outcome changed.
    expect(masked.failureCodes).not.toContain("VETO_BANNED_LEXICON");
    expect(masked.stageAClean).not.toBe(vetoed!.expectedStageAClean);
  });
});

// ── AC5: a deliberately weakened skill-config/model variant FAILS the tripwire ──

describe("methodology-drift tripwire — a weakened variant regresses below tolerance (AC5)", () => {
  it("a degraded faithfulness gate (PARTIAL/40% sourced) drops a clean piece below tolerance", async () => {
    // Use a genuinely Stage-A-clean draft (a de-slopped real golden body — see
    // cleanDraftBaseline). A degraded faithfulness verdict tanks the faithfulness
    // dimension (weight 0.2 — the largest), which MUST move the composite outside
    // the documented band. This is the proof the tripwire bites.
    const { piece: clean, result: baseline } = await cleanDraftBaseline();
    expect(baseline.stageAClean).toBe(true);
    expect(baseline.score).not.toBeNull();

    const weakened = await regate(clean, {
      // The weakened "skill config": the verifier is degraded to a low-confidence
      // PARTIAL with 40% sourced (simulating a swapped/cheaper model or a relaxed
      // faithfulness threshold) — a methodology change the harness must catch.
      runFaithfulnessGate: async () => ({
        skipped: false,
        verdict: "PARTIAL",
        sourcedPercent: 40,
        totalClaims: 5,
        claims: [],
      }),
    });

    // The weakened run drifts the composite well beyond the tolerance band.
    const drift = Math.abs((weakened.score ?? 0) - (baseline.score ?? 0));
    expect(drift).toBeGreaterThan(STAGE_B_TOLERANCE);

    // And concretely: asserting the weakened run against the clean baseline (the
    // real regression assertion) FAILS — proving the tripwire catches drift.
    const assertAgainstBaseline = () => {
      expect(Math.abs((weakened.score ?? -999) - (baseline.score ?? -1000))).toBeLessThanOrEqual(
        STAGE_B_TOLERANCE,
      );
    };
    expect(assertAgainstBaseline).toThrow();
  });

  it("a weakened keyword scorer (forces 'stuffed') flips a clean piece to a Stage-A veto (AC5)", async () => {
    const { piece: clean, result: baseline } = await cleanDraftBaseline();
    expect(baseline.stageAClean).toBe(true);
    const weakened = await regate(clean, {
      // A degraded keyword-density implementation that mis-reports stuffing — the
      // captured baseline is Stage-A clean, so this MUST flip the verdict.
      analyzeKeywordDensity: (() => ({
        status: "stuffed",
        density: 9.9,
        count: 99,
        totalWords: 1000,
      })) as unknown as SeoGateDeps["analyzeKeywordDensity"],
    });
    expect(weakened.stageAClean).toBe(false);
    expect(weakened.verdict).not.toBe(baseline.verdict);
    expect(weakened.failureCodes).toContain("VETO_KEYWORD_STUFF");
  });
});

// ── AC6: gate-adjudication / dispute protocol (no override-and-publish) ──────────

/**
 * A disputed gate result is recorded as `{veto_code, claimed_outcome, resolution}`
 * and adjudicated. The invariant: a dispute can NEVER flip a vetoed result to a
 * publishable one — there is no override-and-publish path. `resolution` may only
 * uphold the veto or escalate for regeneration; it cannot mint a PUBLISH.
 */
export interface GateDispute {
  veto_code: string;
  claimed_outcome: "PUBLISH" | "REVIEW" | "REVISE" | "REJECT";
  resolution: "upheld" | "escalate-regenerate";
}

/** Adjudicate a dispute against a real gate result. NEVER returns a publishable
 *  verdict for a vetoed draft — the dispute is recorded, the veto stands. */
export function adjudicateDispute(
  result: { stageAClean: boolean; verdict: string; failureCodes: string[] },
  dispute: GateDispute,
): { recorded: GateDispute; finalVerdict: string; publishable: boolean } {
  // Recording a dispute does not re-run or relax the gate. A vetoed (non-clean)
  // result is never publishable regardless of the claimed outcome.
  const publishable = result.stageAClean && result.verdict === "PUBLISH";
  return {
    recorded: dispute,
    // The dispute can escalate for regeneration but cannot mint a PUBLISH.
    finalVerdict: result.verdict,
    publishable,
  };
}

describe("gate-adjudication protocol — a dispute does NOT flip to publishable (AC6)", () => {
  it("a dispute on a vetoed result is recorded but never becomes publishable", async () => {
    // A captured golden piece is already Stage-A vetoed (VETO_BANNED_LEXICON) — the
    // honest baseline. A dispute on it must never become publishable.
    const vetoed = await regate(corpus[0]);
    expect(vetoed.stageAClean).toBe(false);

    const dispute: GateDispute = {
      veto_code: "VETO_BANNED_LEXICON",
      claimed_outcome: "PUBLISH", // the disputer CLAIMS it should publish
      resolution: "escalate-regenerate",
    };
    const adj = adjudicateDispute(vetoed, dispute);

    // The dispute is recorded with the full {veto_code, claimed_outcome, resolution}.
    expect(adj.recorded.veto_code).toBe("VETO_BANNED_LEXICON");
    expect(adj.recorded.claimed_outcome).toBe("PUBLISH");
    expect(adj.recorded.resolution).toBe("escalate-regenerate");
    // INVARIANT: a disputed veto is NEVER publishable (no override-and-publish).
    expect(adj.publishable).toBe(false);
    expect(adj.finalVerdict).not.toBe("PUBLISH");
  });

  it("even a dispute resolved 'upheld' on a non-PUBLISH piece cannot mint a PUBLISH", async () => {
    // A genuinely Stage-A-clean draft that lands in a REVIEW band (dimension miss,
    // not a veto). An 'upheld' dispute claiming PUBLISH still cannot mint a PUBLISH.
    const { piece: clean, result: r } = await cleanDraftBaseline();
    expect(r.stageAClean).toBe(true);
    expect(r.verdict).not.toBe("PUBLISH");
    void clean;
    const adj = adjudicateDispute(r, {
      veto_code: "DIM_KEYWORD_LOW",
      claimed_outcome: "PUBLISH",
      resolution: "upheld",
    });
    expect(adj.publishable).toBe(false);
  });
});
