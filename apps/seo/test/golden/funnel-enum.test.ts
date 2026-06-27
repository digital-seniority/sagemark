/**
 * funnel-enum.test — every golden funnelStage satisfies the DB CHECK (audit A.014.1).
 *
 * THE BUG THIS GUARDS AGAINST. The golden corpus once labeled `funnelStage` with
 * marketing-funnel acronyms (TOFU/MOFU/BOFU), but the DB CHECK on
 * `content_pieces.funnel_stage`
 * (`packages/schema-flywheel/drizzle/0031_cluster_funnel_columns.sql`) only allows
 * `awareness|consideration|decision|retention` (and PRD §3.5 uses the same set).
 * A corpus labeled with the acronyms could never round-trip through the schema —
 * the strategist's `ContentStrategy` cluster map (PR 014 / PR 017) writes these
 * exact column values, so a divergent golden label would surface as a CHECK
 * violation at write time, not in CI. This test fails fast in CI instead.
 *
 * IT READS THE CHECK STRAIGHT FROM THE MIGRATION (not a re-typed literal). The
 * allowed set is PARSED out of the 0031 SQL `CHECK (funnel_stage IN (...))`
 * clause, so if the migration's enum ever changes, this test follows it — there
 * is ONE source of truth, the migration. We then assert (a) the
 * `extract-fixture` `FUNNEL_STAGES` constant equals that parsed set, and (b)
 * EVERY emitted golden JSON `funnelStage` is a member of it. A stray acronym (or
 * any out-of-enum value) re-introduced anywhere fails here.
 *
 * Pure / Node-only. Clean ASCII / UTF-8.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { FUNNEL_STAGES } from "../../golden/extract-fixture";
import type { GoldenPiece } from "../../golden/capture-baseline";

// ── Locate the migration + the golden corpus ────────────────────────────────────

/** apps/seo/test/golden -> up 4 = repo root. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "schema-flywheel",
  "drizzle",
  "0031_cluster_funnel_columns.sql",
);
const GOLDEN_DIR = path.resolve(__dirname, "..", "..", "golden", "whispering-willows");

/**
 * Parse the funnel_stage CHECK allow-list out of the 0031 migration. Returns the
 * `'a','b',...` members as a string set. Throws if the constraint cannot be found
 * (a missing/renamed constraint is a test failure, never a silent empty set).
 */
function parseFunnelCheckSet(): Set<string> {
  const sql = readFileSync(MIGRATION, "utf8");
  // Match: CHECK (funnel_stage IN ('awareness','consideration','decision','retention'))
  const m = sql.match(/funnel_stage\s+IN\s*\(([^)]*)\)/i);
  if (!m || !m[1]) {
    throw new Error(
      `could not find a 'funnel_stage IN (...)' CHECK clause in ${MIGRATION} — ` +
        "the funnel-enum guard cannot resolve the authoritative allow-list",
    );
  }
  const values = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, "").trim())
    .filter((s) => s.length > 0);
  return new Set(values);
}

function loadGolden(): GoldenPiece[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as GoldenPiece);
}

// ── The guard ───────────────────────────────────────────────────────────────────

describe("funnel-stage enum alignment (audit A.014.1)", () => {
  const checkSet = parseFunnelCheckSet();
  const corpus = loadGolden();

  it("the 0031 migration allows exactly the four schema funnel stages", () => {
    expect([...checkSet].sort()).toEqual(
      ["awareness", "consideration", "decision", "retention"].sort(),
    );
  });

  it("the extract-fixture FUNNEL_STAGES constant equals the migration CHECK set", () => {
    expect([...FUNNEL_STAGES].sort()).toEqual([...checkSet].sort());
  });

  it("every golden funnelStage satisfies the 0031 funnel_stage CHECK set", () => {
    expect(corpus.length).toBe(10);
    for (const p of corpus) {
      expect(
        checkSet.has(p.funnelStage),
        `golden '${p.name}' funnelStage='${p.funnelStage}' is not in the DB CHECK set ` +
          `{${[...checkSet].join(", ")}} — it would violate content_pieces_funnel_stage_check`,
      ).toBe(true);
    }
  });

  it("no golden piece carries a legacy TOFU/MOFU/BOFU acronym", () => {
    for (const p of corpus) {
      expect(["TOFU", "MOFU", "BOFU"]).not.toContain(p.funnelStage);
    }
  });
});
