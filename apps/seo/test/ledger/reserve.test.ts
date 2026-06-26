/**
 * Tier-1 ledger tests (PR 020 / P1.C.3) — the conditional-UPDATE concurrency /
 * over-cap-rejection proof (the load-bearing one), the per-run reconciliation,
 * the gate-block-by-sourcing rate, and the share-of-model rollup. Plus a Tier-1
 * structural assertion over the committed 0039 migration SQL.
 *
 * Runner: vitest (node env) — globbed via `test/ledger/**` in vitest.config.ts.
 *
 * The concurrency property is proven DETERMINISTICALLY against
 * `InMemoryReservationStore`, which models the EXACT lock-row
 * conditional-UPDATE semantics (a serialized compare-and-set under a per-run
 * lock — the JS analogue of the DB row lock the `UPDATE ... WHERE reserved +
 * cost <= cap` takes). No live Postgres needed; the live conditional-UPDATE SQL
 * (`RESERVE_CONDITIONAL_SQL`) is asserted to be a true `WHERE ... <= cap`
 * conditional update, NOT a sum-then-check.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  InMemoryReservationStore,
  RESERVE_CONDITIONAL_SQL,
  NOT_WIRED_RESERVATION_STORE,
  ReservationStoreNotWiredError,
  type ReservationScope,
} from "@/lib/ledger/reserve-conditional";
import {
  InMemoryCostLedger,
  reconcileRun,
  RECONCILE_TOLERANCE_USD,
  NOT_WIRED_COST_LEDGER,
  type GatewayUsage,
  type SeoCostLedgerRecord,
} from "@/lib/ledger/seo-cost-ledger";
import {
  computeSourcingBlockRate,
  isBlockedBySourcing,
  rollUpCitationRate,
  InMemoryShareOfModelStore,
  VETO_UNSOURCED_STAT,
  SHARE_OF_MODEL_ENGINES,
  type GateResultForSourcing,
  type ShareOfModelCheck,
} from "@/lib/metrics/share-of-model";

const SCOPE: ReservationScope = {
  workspaceId: "ws-1",
  clientId: "client-1",
  runId: "run-1",
};

// ===========================================================================
// AC1 — conditional-UPDATE concurrency / over-cap rejection (LOAD-BEARING).
// ===========================================================================

describe("AC1 conditional-UPDATE reservation — over-cap rejection under concurrency", () => {
  it("rejects (does not reserve) a single reservation over the cap", async () => {
    const store = new InMemoryReservationStore(2.0);
    await store.reserve({ scope: SCOPE, costUsd: 1.5, stage: "drafter" });
    const over = await store.reserve({ scope: SCOPE, costUsd: 1.0, stage: "judge" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("OVER_CAP");
    // Fail-closed: the over-cap reservation recorded nothing.
    expect(store.reservedFor(SCOPE.runId)).toBeCloseTo(1.5, 10);
  });

  it("two CONCURRENT over-cap reservations: exactly ONE wins, the run never over-spends", async () => {
    // Cap $2; the run has already reserved $1.50, so only $0.50 headroom remains.
    // Two reservations of $0.40 are fired CONCURRENTLY — together they would be
    // $0.80 and push the run to $2.30 (over). A sum-then-check ledger would let
    // BOTH through (both read the same $1.50 pre-sum). The lock-row conditional
    // UPDATE must let exactly ONE win.
    const store = new InMemoryReservationStore(2.0);
    await store.reserve({ scope: SCOPE, costUsd: 1.5, stage: "drafter" });

    const [a, b] = await Promise.all([
      store.reserve({ scope: SCOPE, costUsd: 0.4, stage: "verifier" }),
      store.reserve({ scope: SCOPE, costUsd: 0.4, stage: "judge" }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    // EXACTLY one wins (non-vacuous: not zero, not both).
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].ok).toBe(false);
    if (!losers[0].ok) expect(losers[0].reason).toBe("OVER_CAP");
    // The run is at $1.90 (one $0.40 admitted), NEVER over the $2 cap.
    expect(store.reservedFor(SCOPE.runId)).toBeCloseTo(1.9, 10);
    expect(store.reservedFor(SCOPE.runId)).toBeLessThanOrEqual(2.0);
  });

  it("stress: N concurrent reservations never let cumulative spend exceed the cap", async () => {
    const cap = 1.0;
    const store = new InMemoryReservationStore(cap);
    // 20 concurrent $0.1 reservations against a $1.0 cap — at most 10 can win.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      store.reserve({ scope: SCOPE, costUsd: 0.1, stage: `s${i}` }),
    );
    const results = await Promise.all(attempts);
    const wins = results.filter((r) => r.ok).length;
    expect(wins).toBe(10); // exactly the headroom, no more
    expect(store.reservedFor(SCOPE.runId)).toBeLessThanOrEqual(cap + 1e-9);
    expect(store.reservedFor(SCOPE.runId)).toBeCloseTo(1.0, 9);
  });

  it("a reservation that exactly hits the cap is admitted; the next is rejected", async () => {
    const store = new InMemoryReservationStore(2.0);
    const exact = await store.reserve({ scope: SCOPE, costUsd: 2.0, stage: "all" });
    expect(exact.ok).toBe(true);
    const over = await store.reserve({ scope: SCOPE, costUsd: 0.0001, stage: "extra" });
    expect(over.ok).toBe(false);
  });

  it("rejects an invalid (negative / non-finite) cost distinctly from over-cap", async () => {
    const store = new InMemoryReservationStore(2.0);
    const neg = await store.reserve({ scope: SCOPE, costUsd: -1, stage: "bad" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.reason).toBe("INVALID_COST");
    const nan = await store.reserve({ scope: SCOPE, costUsd: Number.NaN, stage: "bad" });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.reason).toBe("INVALID_COST");
    expect(store.reservedFor(SCOPE.runId)).toBe(0);
  });

  it("reservations are PER-RUN isolated — one run's spend never caps another", async () => {
    const store = new InMemoryReservationStore(2.0);
    await store.reserve({ scope: SCOPE, costUsd: 2.0, stage: "all" });
    // A DIFFERENT run starts fresh with full headroom.
    const other: ReservationScope = { ...SCOPE, runId: "run-2" };
    const r = await store.reserve({ scope: other, costUsd: 2.0, stage: "all" });
    expect(r.ok).toBe(true);
    expect(store.reservedFor("run-2")).toBeCloseTo(2.0, 10);
  });

  it("the live reservation SQL is a lock-row conditional UPDATE, NOT a sum-then-check", () => {
    const sql = RESERVE_CONDITIONAL_SQL.replace(/\s+/g, " ");
    // A true conditional UPDATE with the cap guard in the WHERE clause.
    expect(sql).toMatch(/UPDATE\s+public\.seo_cost_run_budget/i);
    expect(sql).toMatch(/SET\s+reserved_usd\s*=\s*reserved_usd\s*\+\s*\$1/i);
    expect(sql).toMatch(/WHERE[\s\S]*reserved_usd\s*\+\s*\$1\s*<=\s*cap_usd/i);
    expect(sql).toMatch(/RETURNING/i);
    // Tenancy: the UPDATE is scoped by workspace_id + client_id (service role
    // bypasses RLS — the app filter IS the boundary).
    expect(sql).toMatch(/workspace_id\s*=\s*\$3/i);
    expect(sql).toMatch(/client_id\s*=\s*\$4/i);
    // It must NOT be a separate aggregate read (sum-then-check is the race).
    expect(sql).not.toMatch(/SUM\s*\(/i);
    expect(sql).not.toMatch(/SELECT/i);
  });

  it("the live reservation store is fail-closed (NOT_WIRED throws)", () => {
    expect(() =>
      NOT_WIRED_RESERVATION_STORE.reserve({ scope: SCOPE, costUsd: 0.1, stage: "x" }),
    ).toThrow(ReservationStoreNotWiredError);
  });
});

// ===========================================================================
// AC2 — per-stage actual_usd + latency recorded; per-piece cost measured.
// AC4 — per-run reconciliation against Gateway usage.
// ===========================================================================

describe("AC2/AC4 per-stage cost recorded + per-run reconciliation", () => {
  const usages: GatewayUsage[] = [
    { actualUsd: 0.42, model: "anthropic/claude-sonnet-4-6", latencyMs: 1200 },
    { actualUsd: 0.18, model: "anthropic/claude-haiku-4-5", latencyMs: 600 },
    { actualUsd: 0.55, model: "anthropic/claude-opus-4-7", latencyMs: 2100 },
  ];

  it("records per-stage actual_usd + latency_ms; the SUM is the measured per-piece cost", async () => {
    const ledger = new InMemoryCostLedger();
    const stages = ["drafter", "verifier", "judge"];
    for (let i = 0; i < stages.length; i++) {
      await ledger.recordStage({
        scope: SCOPE,
        pieceId: "piece-1",
        stage: stages[i],
        reservedUsd: usages[i].actualUsd + 0.05,
        usage: usages[i],
      });
    }
    const rows = await ledger.recordsForRun(SCOPE);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.actualUsd).not.toBeNull();
      expect(r.latencyMs).not.toBeNull();
      expect(r.model).toBeTruthy();
    }
    const measured = rows.reduce((s, r) => s + (r.actualUsd ?? 0), 0);
    expect(measured).toBeCloseTo(1.15, 10); // 0.42 + 0.18 + 0.55, MEASURED not estimated
  });

  it("reconciles the run's ledger against Gateway usage within tolerance (ok)", async () => {
    const ledger = new InMemoryCostLedger();
    const stages = ["drafter", "verifier", "judge"];
    for (let i = 0; i < stages.length; i++) {
      await ledger.recordStage({
        scope: SCOPE,
        pieceId: "piece-1",
        stage: stages[i],
        reservedUsd: 0.7,
        usage: usages[i],
      });
    }
    const rows = await ledger.recordsForRun(SCOPE);
    const result = reconcileRun(rows, usages);
    expect(result.ok).toBe(true);
    expect(result.gapUsd).toBeLessThanOrEqual(RECONCILE_TOLERANCE_USD);
    expect(result.ledgerActualUsd).toBeCloseTo(1.15, 10);
    expect(result.gatewayReportedUsd).toBeCloseTo(1.15, 10);
    // Measured $1.15 <= $2.00 target.
    expect(result.withinCostTarget).toBe(true);
  });

  it("an UNRECONCILED gap FAILS the check (a missing Gateway charge is a leak)", async () => {
    const rows: SeoCostLedgerRecord[] = [
      {
        scope: SCOPE,
        pieceId: "piece-1",
        stage: "drafter",
        reservedUsd: 0.5,
        actualUsd: 0.42,
        model: "m",
        latencyMs: 100,
      },
    ];
    // Gateway reported MORE than the ledger captured (an unbilled call) → gap.
    const gatewayReported: GatewayUsage[] = [
      { actualUsd: 0.42, model: "m", latencyMs: 100 },
      { actualUsd: 0.30, model: "m2", latencyMs: 200 },
    ];
    const result = reconcileRun(rows, gatewayReported);
    expect(result.ok).toBe(false);
    expect(result.gapUsd).toBeCloseTo(0.3, 10);
  });

  it("a ledger row with a NULL actual (never reconciled) FAILS the check", () => {
    const rows: SeoCostLedgerRecord[] = [
      { scope: SCOPE, pieceId: null, stage: "drafter", reservedUsd: 0.5, actualUsd: null, model: null, latencyMs: null },
    ];
    const result = reconcileRun(rows, [{ actualUsd: 0.5, model: "m", latencyMs: 100 }]);
    expect(result.ok).toBe(false);
    expect(result.gapUsd).toBe(Number.POSITIVE_INFINITY);
  });

  it("a run OVER the $2 target is flagged (withinCostTarget=false)", async () => {
    const ledger = new InMemoryCostLedger();
    const big: GatewayUsage = { actualUsd: 2.5, model: "m", latencyMs: 100 };
    await ledger.recordStage({ scope: SCOPE, pieceId: "p", stage: "drafter", reservedUsd: 2.5, usage: big });
    const rows = await ledger.recordsForRun(SCOPE);
    const result = reconcileRun(rows, [big]);
    expect(result.ok).toBe(true); // reconciles fine
    expect(result.withinCostTarget).toBe(false); // but over the editorial target
  });

  it("recordsForRun is tenancy-isolated (a different workspace/client/run never mixes)", async () => {
    const ledger = new InMemoryCostLedger();
    await ledger.recordStage({ scope: SCOPE, pieceId: "p", stage: "drafter", reservedUsd: 0.5, usage: usages[0] });
    // Same run id, DIFFERENT workspace — must not bleed into SCOPE's run.
    await ledger.recordStage({
      scope: { workspaceId: "ws-OTHER", clientId: "client-1", runId: "run-1" },
      pieceId: "p",
      stage: "drafter",
      reservedUsd: 0.5,
      usage: usages[1],
    });
    const rows = await ledger.recordsForRun(SCOPE);
    expect(rows).toHaveLength(1);
    expect(rows[0].actualUsd).toBeCloseTo(0.42, 10);
  });

  it("the live ledger is fail-closed (NOT_WIRED throws)", () => {
    expect(() => NOT_WIRED_COST_LEDGER.recordsForRun(SCOPE)).toThrow();
  });
});

// ===========================================================================
// AC5 — gate-block-by-sourcing rate (the D3 reversal trigger).
// ===========================================================================

describe("AC5 gate-block-by-sourcing rate (D3 reversal trigger)", () => {
  it("counts an UNSOURCED_STAT veto and a thin-source faithfulness block as sourcing blocks", () => {
    const results: GateResultForSourcing[] = [
      // blocked: hard unsourced-stat veto
      { hasGate: true, vetoes: [VETO_UNSOURCED_STAT], lowFaithfulnessFromThinSources: false },
      // blocked: low-faithfulness from thin sources
      { hasGate: true, vetoes: [], lowFaithfulnessFromThinSources: true },
      // NOT a sourcing block: a different veto
      { hasGate: true, vetoes: ["VETO_KEYWORD_STUFF"], lowFaithfulnessFromThinSources: false },
      // clean pass
      { hasGate: true, vetoes: [], lowFaithfulnessFromThinSources: false },
      // never ran — excluded from the denominator
      { hasGate: false, vetoes: [], lowFaithfulnessFromThinSources: false },
    ];
    const rate = computeSourcingBlockRate(results);
    expect(rate.totalGated).toBe(4); // the non-run gate is excluded
    expect(rate.blockedBySourcing).toBe(2);
    expect(rate.unsourcedStatVetoes).toBe(1);
    expect(rate.thinSourceFaithfulnessBlocks).toBe(1);
    expect(rate.rate).toBeCloseTo(0.5, 10);
  });

  it("a faithfulness fail against ADEQUATE sources is NOT a sourcing block", () => {
    const g: GateResultForSourcing = {
      hasGate: true,
      vetoes: ["VETO_VOICE_FAIL"],
      lowFaithfulnessFromThinSources: false,
    };
    expect(isBlockedBySourcing(g)).toBe(false);
  });

  it("an empty / all-unrun set is rate 0 (no division by zero)", () => {
    expect(computeSourcingBlockRate([]).rate).toBe(0);
    expect(
      computeSourcingBlockRate([{ hasGate: false, vetoes: [], lowFaithfulnessFromThinSources: false }]).rate,
    ).toBe(0);
  });
});

// ===========================================================================
// AC6 — share-of-model citation checks persist per (client, engine, query) and
// roll up to a per-hub citation rate.
// ===========================================================================

describe("AC6 share-of-model rollup", () => {
  it("persists per-(client,engine,query) checks and rolls up to a per-hub citation rate", async () => {
    const store = new InMemoryShareOfModelStore();
    const base = { workspaceId: "ws-1", clientId: "client-1", pieceId: "hub-1" };
    const checks: ShareOfModelCheck[] = [
      { ...base, engine: "ChatGPT", query: "best widgets", cited: true, position: 1 },
      { ...base, engine: "Claude", query: "best widgets", cited: true, position: 2 },
      { ...base, engine: "Gemini", query: "best widgets", cited: false, position: null },
      { ...base, engine: "ChatGPT", query: "widget pricing", cited: false, position: null },
    ];
    for (const c of checks) await store.persistCheck(c);

    const persisted = await store.checksForPiece("ws-1", "client-1", "hub-1");
    expect(persisted).toHaveLength(4);

    const rollup = rollUpCitationRate(persisted, "hub-1");
    expect(rollup.total).toBe(4);
    expect(rollup.cited).toBe(2);
    expect(rollup.citationRate).toBeCloseTo(0.5, 10);
    // Per-engine breakdown.
    expect(rollup.byEngine.ChatGPT).toEqual({ total: 2, cited: 1, rate: 0.5 });
    expect(rollup.byEngine.Claude).toEqual({ total: 1, cited: 1, rate: 1 });
    expect(rollup.byEngine.Gemini).toEqual({ total: 1, cited: 0, rate: 0 });
  });

  it("an empty rollup is rate 0 (never a fabricated 100%)", () => {
    expect(rollUpCitationRate([]).citationRate).toBe(0);
  });

  it("checksForPiece is tenancy-isolated (a different client never leaks in)", async () => {
    const store = new InMemoryShareOfModelStore();
    await store.persistCheck({ workspaceId: "ws-1", clientId: "client-1", pieceId: "hub-1", engine: "ChatGPT", query: "q", cited: true, position: 1 });
    await store.persistCheck({ workspaceId: "ws-1", clientId: "client-OTHER", pieceId: "hub-1", engine: "ChatGPT", query: "q", cited: true, position: 1 });
    const mine = await store.checksForPiece("ws-1", "client-1", "hub-1");
    expect(mine).toHaveLength(1);
    expect(mine[0].clientId).toBe("client-1");
  });

  it("the tracked engines are ChatGPT / Claude / Gemini (DR-038)", () => {
    expect(SHARE_OF_MODEL_ENGINES).toEqual(["ChatGPT", "Claude", "Gemini"]);
  });
});

// ===========================================================================
// Tier-1 structural assertions over the committed 0039 migration SQL.
// ===========================================================================

describe("0039 migration — structural (Tier-1)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SQL = readFileSync(
    join(here, "..", "..", "..", "..", "packages", "schema-flywheel", "drizzle", "0039_seo_cost_ledger.sql"),
    "utf8",
  );
  // Strip `--` comments so prose can't satisfy a structural assertion.
  const code = SQL.replace(/--[^\n]*/g, "");
  const flat = code.replace(/\s+/g, " ");

  it("is valid UTF-8 with no BOM", () => {
    const bytes = readFileSync(
      join(here, "..", "..", "..", "..", "packages", "schema-flywheel", "drizzle", "0039_seo_cost_ledger.sql"),
    );
    expect(bytes.toString("utf8").includes("�")).toBe(false);
    expect(bytes[0]).not.toBe(0xef);
  });

  it("creates seo_cost_ledger + seo_cost_run_budget + share_of_model (idempotent), and NO gate_results", () => {
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS public\.seo_cost_ledger/i);
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS public\.seo_cost_run_budget/i);
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS public\.share_of_model/i);
    // No gate_results table (it does not exist; the inline migration adds none).
    expect(flat).not.toMatch(/CREATE TABLE[^;]*gate_results/i);
    // No comment_threads (re)creation (already migration 0036).
    expect(flat).not.toMatch(/CREATE TABLE[^;]*comment_threads/i);
  });

  it("creates the seo_cost_run_budget lock-row the reservation SQL targets (cap_usd + UNIQUE run_id)", () => {
    // The live RESERVE_CONDITIONAL_SQL UPDATEs public.seo_cost_run_budget — the
    // migration MUST create it (else the AC1 guarantee is only in-memory).
    expect(RESERVE_CONDITIONAL_SQL).toMatch(/UPDATE\s+public\.seo_cost_run_budget/i);
    expect(flat).toMatch(/run_id\s+uuid NOT NULL UNIQUE/i);
    expect(flat).toMatch(/cap_usd\s+numeric\(10,4\) NOT NULL/i);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS seo_cost_run_budget_tenant_idx\s+ON public\.seo_cost_run_budget \(workspace_id, client_id\)/i);
  });

  it("enables RLS fail-closed on ALL THREE tables with NO anon policy", () => {
    expect(flat).toMatch(/ALTER TABLE public\.seo_cost_ledger ENABLE ROW LEVEL SECURITY/i);
    expect(flat).toMatch(/ALTER TABLE public\.seo_cost_run_budget ENABLE ROW LEVEL SECURITY/i);
    expect(flat).toMatch(/ALTER TABLE public\.share_of_model ENABLE ROW LEVEL SECURITY/i);
    // No policy at all on any table (no anon read).
    expect(flat).not.toMatch(/CREATE\s+POLICY/i);
    expect(flat).not.toMatch(/TO\s+anon/i);
  });

  it("inlines the client_id RESTRICT FK on all three tables, piece_id SET NULL on the two with piece_id", () => {
    const restricts = [...flat.matchAll(/client_id\s+uuid NOT NULL REFERENCES public\.content_clients\(id\) ON DELETE RESTRICT/gi)];
    expect(restricts.length).toBe(3); // seo_cost_ledger + seo_cost_run_budget + share_of_model
    const setNulls = [...flat.matchAll(/piece_id\s+uuid REFERENCES public\.content_pieces\(id\) ON DELETE SET NULL/gi)];
    expect(setNulls.length).toBe(2); // only seo_cost_ledger + share_of_model carry piece_id
  });

  it("seo_cost_ledger carries reserved_usd/actual_usd numeric(10,4) + the run/client indexes", () => {
    expect(flat).toMatch(/reserved_usd\s+numeric\(10,4\) NOT NULL DEFAULT 0/i);
    expect(flat).toMatch(/actual_usd\s+numeric\(10,4\)/i);
    expect(flat).toMatch(/run_id\s+uuid NOT NULL/i);
    expect(flat).toMatch(/latency_ms\s+integer/i);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS seo_cost_ledger_run_idx\s+ON public\.seo_cost_ledger \(run_id\)/i);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS seo_cost_ledger_client_idx\s+ON public\.seo_cost_ledger \(client_id, created_at\)/i);
  });

  it("share_of_model carries engine/query/cited + source_channel default 'direct' + client index", () => {
    expect(flat).toMatch(/engine\s+text NOT NULL/i);
    expect(flat).toMatch(/query\s+text NOT NULL/i);
    expect(flat).toMatch(/cited\s+boolean NOT NULL/i);
    expect(flat).toMatch(/source_channel\s+text NOT NULL DEFAULT 'direct'/i);
    expect(flat).toMatch(/parser_conf\s+numeric\(4,3\)/i);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS share_of_model_client_idx\s+ON public\.share_of_model \(client_id, captured_at\)/i);
  });

  it("writes ONLY the public schema + uses NO superuser construct (pooled-role-can-run)", () => {
    // No other schema is written.
    expect(/\bstorage\./i.test(code)).toBe(false);
    for (const banned of [/CREATE\s+EVENT\s+TRIGGER/i, /\bSET\s+ROLE\b/i, /\bALTER\s+.*OWNER\s+TO\b/i, /\bGRANT\b/i, /\bCREATE\s+EXTENSION\b/i, /SECURITY\s+DEFINER/i]) {
      expect(banned.test(code)).toBe(false);
    }
    // Additive-only: no destructive verbs in the live SQL (down is comment-only).
    expect(/\bDROP\b/i.test(code)).toBe(false);
    expect(/\bALTER COLUMN\b|\bDROP COLUMN\b|\bRENAME\b/i.test(code)).toBe(false);
  });
});
