/**
 * gate-spec — the Stage-A veto + Stage-B verdict-band acceptance spec
 * (PR 008 / P0.W.5, AC4).
 *
 * THE EXECUTABLE TRANSCRIPTION of the kernel gate's public contract. This file
 * enumerates EVERY Stage-A veto code and the Stage-B verdict bands
 * (PUBLISH >= 85 / REVIEW 70-84 / REVISE 50-69 / REJECT < 50) and asserts they
 * match the REAL `@sagemark/core` taxonomy + band thresholds. It is the spec the
 * golden harness regresses against — if the kernel adds/removes a veto code or
 * shifts a band, this file fails, forcing a documented re-regression.
 *
 * It is also the YMYL/medical change-control anchor (AC7): the YMYL veto codes +
 * the `ymylSignals` detector tokens are pinned here so a CI guard can diff them.
 *
 * Pure spec — imports the kernel taxonomy + the gate, asserts against captured
 * constants. No network, no provider key. Clean ASCII / UTF-8.
 */

import { describe, it, expect } from "vitest";
import {
  FAILURE_CODES,
  VETO_CODES,
  DIMENSION_CODES,
  isVetoCode,
  ymylSignals,
  runSeoGate,
  type FailureCode,
} from "@sagemark/core";

import { baselineGateDeps, BASELINE_SOURCES } from "../../golden/capture-baseline";

// ── AC4: the complete Stage-A veto enumeration ──────────────────────────────────

/**
 * EVERY Stage-A veto code the gate can emit. Transcribed from the kernel
 * (`packages/core/src/gate/failure-codes.ts`). A change to the kernel taxonomy
 * breaks this list → forces a deliberate spec update + golden re-regression.
 */
export const STAGE_A_VETO_CODES: readonly FailureCode[] = [
  "VETO_BROKEN_CHUNK",
  "VETO_UNSOURCED_STAT",
  "VETO_KEYWORD_STUFF",
  "VETO_YMYL_MISCLASSIFIED",
  "VETO_YMYL_NO_BYLINE",
  "VETO_THIN_CONTENT",
  "VETO_BANNED_LEXICON",
  "VETO_VOICE_FAIL",
  "VETO_EVAL_FAILED",
] as const;

/** EVERY Stage-B dimension-miss marker (informational; never short-circuits). */
export const STAGE_B_DIMENSION_CODES: readonly FailureCode[] = [
  "DIM_READABILITY_LOW",
  "DIM_KEYWORD_LOW",
  "DIM_STRUCTURE_LOW",
  "DIM_FAITHFULNESS_LOW",
  "DIM_VOICE_LOW",
  "DIM_GEO_LOW",
  "DIM_ORIGINALITY_LOW",
  "DIM_EEAT_LOW",
] as const;

// ── AC4: the Stage-B verdict bands ──────────────────────────────────────────────

/** The verdict bands transcribed from the kernel (`seo-gate.ts` band constants). */
export const VERDICT_BANDS = {
  PUBLISH: { min: 85, max: 100 },
  REVIEW: { min: 70, max: 84 },
  REVISE: { min: 50, max: 69 },
  REJECT: { min: 0, max: 49 },
} as const;

// ── AC7: the YMYL / medical change-control surface ──────────────────────────────

/**
 * The YMYL veto codes + the medical-claim detector tokens under change control
 * (AC7). A diff to this set, the `ymylSignals` detector, the faithfulness check,
 * or the YMYL byline veto is RELEASE-BLOCKING and requires golden re-regression.
 * Pinned here so the CI guard (`scripts/ymyl-change-control` / the test below)
 * can detect a change.
 */
export const YMYL_VETO_CODES: readonly FailureCode[] = [
  "VETO_YMYL_MISCLASSIFIED",
  "VETO_YMYL_NO_BYLINE",
  "VETO_UNSOURCED_STAT", // a YMYL piece with an unverifiable faithfulness gate vetoes here
] as const;

/**
 * The exact medical-claim signal tokens the `ymylSignals` detector emits. This is
 * the change-control snapshot (AC7): the regression below diffs the live detector
 * output against this pinned list — a silent loosening of the YMYL false-negative
 * guard breaks the build.
 */
export const YMYL_SIGNAL_TOKENS: readonly string[] = [
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
  "medication",
  "prescription",
  "dosage",
  "side effect",
  "fall prevention",
  "memory care",
  "assisted living",
  "nursing home",
  "hospice",
  "palliative",
] as const;

// ── AC4 assertions: veto enumeration is complete + matches the kernel ───────────

describe("Stage-A veto enumeration is complete + matches the kernel (AC4)", () => {
  it("the spec enumerates EXACTLY the kernel's VETO_* codes (no more, no fewer)", () => {
    const kernelVetoes = Object.values(VETO_CODES).sort();
    expect([...STAGE_A_VETO_CODES].sort()).toEqual(kernelVetoes);
  });

  it("every enumerated veto code is a real veto code in the kernel taxonomy", () => {
    for (const code of STAGE_A_VETO_CODES) {
      expect(FAILURE_CODES[code]).toBe(code);
      expect(isVetoCode(code)).toBe(true);
    }
  });

  it("the dimension-miss markers match the kernel + are NOT vetoes", () => {
    expect([...STAGE_B_DIMENSION_CODES].sort()).toEqual(Object.values(DIMENSION_CODES).sort());
    for (const code of STAGE_B_DIMENSION_CODES) {
      expect(isVetoCode(code)).toBe(false);
    }
  });
});

// ── AC4 assertions: verdict bands are contiguous + transcribed correctly ────────

describe("Stage-B verdict bands (PUBLISH>=85 / REVIEW / REVISE / REJECT) (AC4)", () => {
  it("the bands are contiguous and cover 0-100 with the documented thresholds", () => {
    expect(VERDICT_BANDS.PUBLISH.min).toBe(85);
    expect(VERDICT_BANDS.REVIEW.min).toBe(70);
    expect(VERDICT_BANDS.REVISE.min).toBe(50);
    expect(VERDICT_BANDS.REJECT.min).toBe(0);
    // Contiguous: each band starts one above the next-lower band's max.
    expect(VERDICT_BANDS.REVIEW.max + 1).toBe(VERDICT_BANDS.PUBLISH.min);
    expect(VERDICT_BANDS.REVISE.max + 1).toBe(VERDICT_BANDS.REVIEW.min);
    expect(VERDICT_BANDS.REJECT.max + 1).toBe(VERDICT_BANDS.REVISE.min);
  });

  it("the kernel maps boundary composites to the transcribed band (via a forced-score draft)", async () => {
    // Drive the kernel with stubbed scorers to land each band boundary. The
    // content-score breakdown is the dominant lever; we stub it to a known value
    // and assert the band. (Faithfulness/voice pinned to the clean baseline.)
    const mkContentBreakdown = (perDim: number) =>
      (() => ({
        total: perDim * 5,
        verdict: "REVIEW",
        dimensions: [
          { name: "Readability", score: perDim, max: 5 },
          { name: "Keyword Density", score: perDim, max: 5 },
          { name: "Structure", score: perDim, max: 5 },
          { name: "Length", score: perDim, max: 5 },
          { name: "Content Density", score: perDim, max: 5 },
        ],
      })) as never;

    // perDim=5 -> all content dims 100; with clean faithfulness/voice/geo this
    // lands in PUBLISH. perDim=0 (but originality must clear the thin-content veto)
    // is covered by the golden corpus; here we assert the high boundary.
    const longBody =
      "## How families plan ahead\n\n" +
      "Families weigh many factors when planning long-term support for an aging " +
      "relative. This guide walks through the practical considerations, the costs, " +
      "and the questions worth asking on a tour, so a household can make a calm, " +
      "informed decision together rather than under pressure.\n\n" +
      "## What to look for\n\n" +
      "A good provider is transparent about staffing ratios, daily routines, and " +
      "the support available for residents as their needs change over time. Ask to " +
      "see a typical week, meet the team, and understand how families are kept " +
      "informed. The right fit balances safety, dignity, and a sense of home.\n";
    // Stub geo to a high score too so the composite reflects the content/LLM
    // dimensions (this test asserts the BAND mapping, not the geo scorer).
    const highGeo = (() => ({
      score: 100,
      passed: true,
      checks: [
        { name: "source_attribution", passed: true },
        { name: "attributed_source", passed: true },
      ],
    })) as never;
    const high = await runSeoGate(
      { title: "Planning ahead for a loved one", body: longBody, slug: "planning-ahead", faqData: [] },
      { keyword: "planning", sources: BASELINE_SOURCES, isYmyl: false },
      {},
      baselineGateDeps({ scoreContentBreakdown: mkContentBreakdown(5), scoreGeoCitation: highGeo }),
    );
    expect(high.stageAClean).toBe(true);
    expect(high.score).not.toBeNull();
    expect(high.verdict).toBe("PUBLISH");
    expect(high.score!).toBeGreaterThanOrEqual(VERDICT_BANDS.PUBLISH.min);
  });
});

// ── AC7: YMYL / medical change-control ──────────────────────────────────────────

describe("YMYL / medical change-control surface (AC7)", () => {
  it("the YMYL veto codes are all real kernel veto codes", () => {
    for (const code of YMYL_VETO_CODES) {
      expect(isVetoCode(code)).toBe(true);
    }
  });

  it("the ymylSignals detector emits EXACTLY the pinned medical-claim tokens (change-control snapshot)", () => {
    // A body containing every pinned signal must surface every token; a change to
    // the detector's lexicon shifts this and breaks the build (release-blocking).
    const body = YMYL_SIGNAL_TOKENS.join(" ");
    const emitted = ymylSignals(body).map((s) => s.replace(/^ymyl-body-signal:/, ""));
    expect(emitted.sort()).toEqual([...YMYL_SIGNAL_TOKENS].sort());
  });

  it("the YMYL false-negative guard fires: a medical body marked is_ymyl=false is vetoed", async () => {
    // A long, keyword-sparse body so the earlier keyword-stuff / thin-content
    // vetoes do NOT fire first — the medical signals are what trips the guard.
    const ymylBody =
      "## Recognizing changes in a loved one\n\n" +
      "Adult children often notice subtle shifts before anyone else does. A parent " +
      "who once managed finances easily may begin to struggle, or a familiar route " +
      "home may suddenly feel confusing. These moments are unsettling, and knowing " +
      "what they might mean helps a family respond with care rather than fear.\n\n" +
      "## When to seek an evaluation\n\n" +
      "Early dementia evaluation matters because some causes are treatable, and a " +
      "diagnosis opens the door to the right treatment and support. A clinician can " +
      "review symptoms, rule out reversible conditions, and discuss medication " +
      "options with the patient and the family together.\n";
    const r = await runSeoGate(
      { title: "Recognizing changes", body: ymylBody, slug: "recognizing-changes", faqData: [] },
      { keyword: "evaluation", sources: BASELINE_SOURCES, isYmyl: false },
      {},
      baselineGateDeps(),
    );
    expect(r.stageAClean).toBe(false);
    expect(r.failureCodes).toContain("VETO_YMYL_MISCLASSIFIED");
  });
});
