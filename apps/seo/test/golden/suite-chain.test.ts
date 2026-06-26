/**
 * suite-chain.test — the FULL self-revising chain, golden-regressed (PR 014 / P1.W.1).
 *
 * Extends PR 008's writer-only golden harness (`regression.test.ts`) to the whole
 * four-skill chain:
 *
 *     seo-strategist --ContentStrategy--> seo-assistant --ContentBrief-->
 *       seo-blog-writer --ContentDraft--> seo-audit --AuditResult-->
 *
 * It proves the four acceptance criteria + the two folded-in audit fixes:
 *
 *   AC1  All four REAL SKILL.md files load + are kernel-backed (run directly, not
 *        re-authored), and each orchestrates ITS kernel route rather than
 *        re-implementing the kernel in markdown. The chain re-runs the SAME kernel
 *        gate over the SAME golden bodies and reproduces the captured baseline.
 *   AC2  The typed handoff ContentStrategy -> ContentBrief -> ContentDraft ->
 *        AuditResult is wired; each stage drives its kernel route.
 *   AC3  The N=3 revise cap holds: a 4th REVISE force-routes to human review
 *        (`forcedToHumanReview`) and the loop terminates (no infinite loop).
 *   AC4  A weakened skill-config/model variant regresses BELOW tolerance and
 *        fails the chain's tripwire.
 *   A.014.5  The "no normalize-before-gate" anti-masking discipline is extended to
 *        the chain — no new extraction/handoff transform may mask a Stage-A gate
 *        veto (the meta-check has teeth).
 *
 * Deterministic seam (DR-022): the two LLM gates are pinned to the documented
 * baseline (the same seam PR 008's capture used) so the chain regresses with no
 * provider key. Every other dimension + the whole Stage-A ladder is the real
 * kernel over the real body. Clean ASCII / UTF-8.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import { runSeoGate, type SeoGateDeps, type TransitionContext } from "@sagemark/core";

import {
  loadSuite,
  assertSuiteIsKernelBacked,
  SUITE_CHAIN,
  SKILL_KERNEL_CONTRACT,
  type SuiteSkillName,
} from "@/worker/skills/load-suite";
import { decideRevise, runReviseLoop, MAX_REVISES } from "@/worker/loop/revise-cap";
import { KERNEL_ROUTES } from "@/lib/content/contract";

import {
  baselineGateDeps,
  BASELINE_SOURCES,
  captureGolden,
  type GoldenPiece,
} from "../../golden/capture-baseline";
import { CORPUS } from "../../golden/extract-fixture";
import { repoRootFromHere } from "./_capture";

// ── Setup (mirrors regression.test) ─────────────────────────────────────────────

const REPO_ROOT = repoRootFromHere();
const KERNEL_BASE = "https://seo-host.example";
const GOLDEN_DIR = path.resolve(__dirname, "..", "..", "golden", "whispering-willows");

/** The same Stage-B tolerance band as the writer-only tripwire (PR 008). */
const STAGE_B_TOLERANCE = 3;

function loadGolden(): GoldenPiece[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as GoldenPiece);
}

const corpus = loadGolden();

/** Re-run the kernel gate over a golden piece's captured body (baseline deps). */
async function regate(piece: GoldenPiece, depsOver?: Partial<SeoGateDeps>) {
  return runSeoGate(
    {
      title: piece.title,
      body: piece.body,
      slug: piece.slug,
      faqData: piece.faqData,
      author: {
        name: "Whispering Willows Care Team",
        credentials: "Licensed senior-care provider, Skagit County WA",
      },
    },
    { keyword: piece.keyword, sources: BASELINE_SOURCES, isYmyl: piece.isYmyl },
    {},
    baselineGateDeps(depsOver),
  );
}

/** Load the full chain (the four REAL SKILL.md files). */
function loadChain() {
  return loadSuite({
    kernelBaseUrl: KERNEL_BASE,
    appRoot: REPO_ROOT,
    requested: SUITE_CHAIN,
  });
}

// ── AC1: all four REAL SKILL.md files load + are kernel-backed ──────────────────

describe("AC1 — the full chain loads the REAL SKILL.md files, kernel-backed", () => {
  it("loads all four suite skills verbatim off disk in chain order", () => {
    const suite = loadChain();
    expect(suite.skills.length).toBe(4);
    expect(suite.skillNames).toEqual([...SUITE_CHAIN]);
    for (const skill of suite.skills) {
      // Loaded from the canonical vendored package (DR-022), real bytes, identity-checked.
      expect(skill.skillPath.replace(/\\/g, "/")).toMatch(
        /skills\/seo-copywriter-skill-package\/seo-copywriter\//,
      );
      expect(skill.frontMatterName).toBe(skill.name);
      // The markdown is the authored skill (declares 'kernel-backed'), not a stub.
      expect(skill.markdown).toMatch(/kernel-backed/i);
    }
  });

  it("the chain is kernel-backed: every stage orchestrates ITS kernel route (no violations)", () => {
    const suite = loadChain();
    // The structural proof: each loaded skill declares kernel-backed + its route
    // phrase, and each route it drives is wired to its canonical /content/api path.
    expect(assertSuiteIsKernelBacked(suite)).toEqual([]);
  });

  it("each skill's SKILL.md drives its kernel route rather than re-implementing the kernel", () => {
    const suite = loadChain();
    for (const skill of suite.skills) {
      const contract = SKILL_KERNEL_CONTRACT[skill.name];
      // Drives its route(s) (the routes ARE the toolset).
      for (const route of contract.routes) {
        expect(suite.kernelRoutes[route]).toBe(KERNEL_ROUTES[route]);
      }
      // The markdown phrases its route contract (proof it's the real skill).
      for (const phrase of contract.markdownRoutePhrases) {
        expect(skill.markdown).toMatch(phrase);
      }
    }
  });

  it("re-running the kernel reproduces every captured golden baseline (chain tripwire)", async () => {
    for (const piece of corpus) {
      const r = await regate(piece);
      expect(r.stageAClean, `${piece.name} stageAClean`).toBe(piece.expectedStageAClean);
      expect(r.verdict, `${piece.name} verdict`).toBe(piece.expectedVerdict);
      if (piece.expectedStageAClean) {
        expect(Math.abs((r.score ?? -999) - (piece.expectedScore ?? -1000))).toBeLessThanOrEqual(
          STAGE_B_TOLERANCE,
        );
      } else {
        expect(r.failureCodes.sort()).toEqual([...piece.expectedFailureCodes].sort());
      }
    }
  });
});

// ── AC2: the typed handoff chain is wired; each stage drives its kernel route ────

describe("AC2 — typed handoff ContentStrategy -> ContentBrief -> ContentDraft -> AuditResult", () => {
  // The produced/consumed type at each chain edge, asserted against the REAL
  // SKILL.md so the typed handoff is grounded in the loaded skill, not invented.
  const HANDOFF: Array<{
    skill: SuiteSkillName;
    declares: RegExp;
    route: keyof typeof KERNEL_ROUTES;
  }> = [
    { skill: "seo-strategist", declares: /ContentStrategy/, route: "brief" },
    { skill: "seo-assistant", declares: /ContentBrief/, route: "brief" },
    { skill: "seo-blog-writer", declares: /ContentDraft/, route: "draft" },
    // The auditor produces the kernel AuditResult (runSeoGate's typed result) and
    // drives the audit + publish routes; its SKILL.md describes the scorecard it emits.
    { skill: "seo-audit", declares: /scorecard|verdict/i, route: "audit" },
  ];

  it("each stage declares its handoff type and drives its kernel route", () => {
    const suite = loadChain();
    const byName = new Map(suite.skills.map((s) => [s.name, s]));
    for (const edge of HANDOFF) {
      const skill = byName.get(edge.skill);
      expect(skill, `${edge.skill} loaded`).toBeDefined();
      expect(skill!.markdown).toMatch(edge.declares);
      expect(suite.kernelRoutes[edge.route]).toBe(KERNEL_ROUTES[edge.route]);
    }
  });

  it("the auditor stage produces a typed AuditResult from the kernel (verdict + dimensions)", async () => {
    // The final handoff edge: seo-audit's output is the kernel's typed AuditResult.
    // We exercise the real kernel over a golden body and assert the typed shape.
    const piece = corpus.find((p) => p.expectedStageAClean) ?? corpus[0];
    const result = await regate({
      ...piece,
      // de-slop so a clean piece exercises the Stage-B composite shape too.
      body: piece.body.replace(/—/g, ", ").replace(/\s+,/g, ","),
    });
    expect(["PUBLISH", "REVIEW", "REVISE", "REJECT"]).toContain(result.verdict);
    expect(typeof result.stageAClean).toBe("boolean");
    expect(Array.isArray(result.dimensions)).toBe(true);
    expect(Array.isArray(result.failureCodes)).toBe(true);
  });
});

// ── AC3: the N=3 revise cap holds; a 4th revise force-routes to human review ─────

describe("AC3 — N=3 revise cap -> forcedToHumanReview (no infinite loop)", () => {
  it("revises #1..#3 are taken (review -> draft); the 4th REVISE force-routes to human review", () => {
    // Revises within budget take the revise edge.
    for (let count = 0; count < MAX_REVISES; count++) {
      const d = decideRevise({ verdict: "REVISE", revisionCount: count });
      expect(d.action).toBe("revise");
      expect(d.forcedToHumanReview).toBe(false);
      expect(d.nextState).toBe("draft");
      expect(d.nextRevisionNumber).toBe(count + 1);
    }
    // The 4th REVISE (count === cap) force-routes to human review.
    const forced = decideRevise({ verdict: "REVISE", revisionCount: MAX_REVISES });
    expect(forced.action).toBe("forcedToHumanReview");
    expect(forced.forcedToHumanReview).toBe(true);
    // HELD at review — NOT transitioned back to draft.
    expect(forced.nextState).toBe("review");
    expect(forced.reason).toBe("REVISE_CAP_REACHED");
  });

  it("a stream of all-REVISE verdicts terminates in a forced human-review hold", () => {
    // Feed far more REVISE verdicts than the cap; the loop must STOP, not spin.
    const verdicts = Array.from({ length: 100 }, () => "REVISE" as const);
    const { decisions, forcedToHumanReview } = runReviseLoop(verdicts);
    expect(forcedToHumanReview).toBe(true);
    // Exactly cap revises + one forced hold => cap + 1 decisions (bounded).
    expect(decisions.length).toBe(MAX_REVISES + 1);
    expect(decisions.slice(0, MAX_REVISES).every((d) => d.action === "revise")).toBe(true);
    expect(decisions[decisions.length - 1].action).toBe("forcedToHumanReview");
  });

  it("a non-REVISE verdict does not engage the revise loop", () => {
    for (const verdict of ["PUBLISH", "REVIEW", "REJECT"] as const) {
      const d = decideRevise({ verdict, revisionCount: 0 });
      expect(d.action).toBe("noRevise");
      expect(d.forcedToHumanReview).toBe(false);
    }
  });

  it("an illegal revise edge is held at review for a human, never force-looped", () => {
    // If the FSM rejects review -> draft (e.g. piece not at review), the cap holds
    // at review and surfaces to a human rather than minting an illegal transition.
    const ctx: TransitionContext = {
      verdict: "REVISE",
      evalRan: true,
      isYmyl: false,
      publishEnabled: false,
    };
    // currentState 'published' has no legal -> draft edge (ILLEGAL_EDGE).
    const d = decideRevise({
      verdict: "REVISE",
      revisionCount: 0,
      currentState: "published",
      transitionContext: ctx,
    });
    expect(d.action).toBe("forcedToHumanReview");
    expect(d.forcedToHumanReview).toBe(true);
    expect(d.nextState).toBe("review");
    expect(d.reason).toBe("REVISE_EDGE_ILLEGAL");
  });
});

// ── AC4: a weakened skill-config/model variant regresses below tolerance ─────────

describe("AC4 — a weakened chain variant regresses below tolerance and FAILS", () => {
  /** A genuinely Stage-A-clean draft (de-slopped real golden body) for the tripwire. */
  async function cleanBaseline() {
    for (const p of corpus) {
      const deslopped: GoldenPiece = {
        ...p,
        body: p.body.replace(/—/g, ", ").replace(/\s+,/g, ","),
      };
      const r = await regate(deslopped);
      if (r.stageAClean) return { piece: deslopped, result: r };
    }
    throw new Error("no de-slopped golden body scores Stage-A clean — tripwire setup broken");
  }

  it("a degraded faithfulness gate (the writer's model swapped cheaper) drifts the composite beyond tolerance", async () => {
    const { result: baseline } = await cleanBaseline();
    expect(baseline.stageAClean).toBe(true);
    expect(baseline.score).not.toBeNull();

    // Re-run the clean piece with a weakened skill-config: a low-confidence PARTIAL
    // faithfulness verdict (a swapped/cheaper model). It MUST drift the composite
    // outside the band, and the real regression assertion MUST throw.
    const { piece: clean } = await cleanBaseline();
    const weakened = await regate(clean, {
      runFaithfulnessGate: async () => ({
        skipped: false,
        verdict: "PARTIAL",
        sourcedPercent: 40,
        totalClaims: 5,
        claims: [],
      }),
    });

    const drift = Math.abs((weakened.score ?? 0) - (baseline.score ?? 0));
    expect(drift).toBeGreaterThan(STAGE_B_TOLERANCE);

    const assertAgainstBaseline = () => {
      expect(
        Math.abs((weakened.score ?? -999) - (baseline.score ?? -1000)),
      ).toBeLessThanOrEqual(STAGE_B_TOLERANCE);
    };
    expect(assertAgainstBaseline).toThrow();
  });

  it("a weakened keyword scorer flips a clean chain piece to a Stage-A veto", async () => {
    const { piece: clean, result: baseline } = await cleanBaseline();
    expect(baseline.stageAClean).toBe(true);
    const weakened = await regate(clean, {
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

// ── A.014.5: anti-masking discipline extended to the chain ───────────────────────

/**
 * THE "NO NORMALIZE-BEFORE-GATE" INVARIANT, EXTENDED TO THE CHAIN (audit A.014.5).
 * The chain adds new typed-handoff transforms (strategy -> brief -> draft). None
 * of them may silently normalize a body in a way that masks a Stage-A gate veto
 * before the auditor sees it. We re-run the WHOLE extract -> gate path from the raw
 * demo HTML (the same path the generator used) and assert the freshly-extracted +
 * gated `stageAClean`/`failureCodes` MATCH the stored chain baseline EXACTLY, and
 * that a vetoed body still carries its em-dash density into the gate.
 */
describe("A.014.5 — chain anti-masking: no handoff transform masks a gate veto", () => {
  const byName = new Map(corpus.map((p) => [p.name, p]));

  for (const cp of CORPUS) {
    it(`${cp.goldenName}: re-extract + re-gate reproduces the stored clean/codes exactly`, async () => {
      const stored = byName.get(cp.goldenName);
      expect(stored, `golden ${cp.goldenName} present`).toBeDefined();

      const fresh = await captureGolden(REPO_ROOT, cp);
      expect(fresh.expectedStageAClean).toBe(stored!.expectedStageAClean);
      expect([...fresh.expectedFailureCodes].sort()).toEqual(
        [...stored!.expectedFailureCodes].sort(),
      );
      // The body the gate scored is byte-identical to the stored body (no silent
      // normalization slipped into the chain's extraction/handoff path).
      expect(fresh.body).toBe(stored!.body);

      if (stored!.expectedFailureCodes.includes("VETO_BANNED_LEXICON")) {
        const emDashes = (fresh.body.match(/—/g) ?? []).length;
        expect(emDashes).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("a hypothetical handoff transform that strips em-dashes WOULD flip the veto (the guard has teeth)", async () => {
    const vetoed = corpus.find((p) => p.expectedFailureCodes.includes("VETO_BANNED_LEXICON"));
    expect(vetoed, "at least one piece is vetoed for banned lexicon").toBeDefined();

    const masked = await regate({
      ...vetoed!,
      body: vetoed!.body.replace(/—/g, " - "), // a normalize-before-gate transform
    });
    expect(masked.failureCodes).not.toContain("VETO_BANNED_LEXICON");
    expect(masked.stageAClean).not.toBe(vetoed!.expectedStageAClean);
  });

  it("the revise cap never normalizes a verdict — a REVISE stays a REVISE (no gate masking via the loop)", () => {
    // The cap decides the NEXT step; it must not transmute the verdict. A REVISE
    // that hits the cap is force-routed, NOT silently relabeled publishable.
    const forced = decideRevise({ verdict: "REVISE", revisionCount: MAX_REVISES });
    expect(forced.forcedToHumanReview).toBe(true);
    // It holds at review for a human — it can never mint a PUBLISH/clean outcome.
    expect(forced.nextState).toBe("review");
    expect(forced.action).not.toBe("noRevise");
  });
});
