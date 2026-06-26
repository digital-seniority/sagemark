-- 0039_seo_cost_ledger.sql — the SEPARATE SEO AI-Gateway cost ledger (D4) +
-- the north-star share-of-model KPI table (P1.C.3 / PR 020, lane worker-runtime).
--
-- THREE NEW public-schema tables (RFC engineering-rfc.md §668 inline SQL is the
-- authority for the seo_cost_ledger + share_of_model column sets; the
-- seo_cost_run_budget accumulator is the lock-row the reservation SQL targets):
--
--   1. `seo_cost_ledger`  — the per-(run_id, stage) AI-Gateway cost ledger. A
--      row is RESERVED pre-flight (reserved_usd) via a lock-row CONDITIONAL
--      UPDATE (`reserve-conditional.ts`), then RECONCILED with the Gateway-
--      reported actual_usd + latency_ms once the call returns. The ≤$2 editorial
--      target (RFC §1, CostAccountant.RUN_COST_CAP_USD) is measured per piece
--      from these rows — NOT estimated.
--
--   2. `seo_cost_run_budget` — the per-run ACCUMULATOR + the single lock-row the
--      conditional-UPDATE reservation (`RESERVE_CONDITIONAL_SQL`) targets. ONE
--      row per run_id (UNIQUE); `reserved_usd` is atomically incremented under
--      the DB row lock with the `reserved_usd + cost <= cap_usd` guard, so a
--      concurrent over-cap reservation is REJECTED by the predicate (no
--      sum-then-check race). `cap_usd` is the run's editorial cost cap (≤$2). This
--      table is what makes the AC1 atomicity guarantee runnable on the live
--      schema (not just the in-memory model).
--
--   3. `share_of_model`   — the AI-answer-engine citation-tracking table (the
--      north-star share-of-model KPI). One row per (client_id, engine, query)
--      citation check; `cited`/`position` roll up to a per-hub citation rate.
--      Engines in use: ChatGPT · Claude · Gemini (DR-038); `source_channel`
--      defaults to 'direct' (Gateway direct-query, DR-038).
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS`). Touches ONLY the `public`
-- schema. MUST NOT alter or drop any existing table, column, constraint, index,
-- or policy. Follows the exact style of 0033/0035/0036.
--
-- RLS — FAIL-CLOSED, mirrors the 0032/0033/0035/0036 "ENABLE ROW LEVEL
-- SECURITY; NO anon policy" pattern (DR-023). Anon reaches ZERO rows on BOTH
-- tables: cost + share-of-model are billing/competitive-intelligence data and
-- are NEVER public. They are read/written ONLY through the service-role
-- data-access seam (every query carries an explicit workspace_id + client_id
-- filter — service role bypasses RLS, so the app filter is the tenancy
-- boundary). There are no authenticated non-service tenant users (auth seam is
-- a no-op, DR-003), so no tenant-read policy is needed here.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): this migration
-- writes ONLY the `public` schema and uses ONLY `CREATE TABLE`, `CREATE INDEX`,
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It declares NO event trigger, NO
-- SET ROLE, NO GRANT, NO ALTER OWNER, NO CREATE EXTENSION, and depends on NO
-- superuser-only construct. The pre-existing `rls_auto_enable()` event trigger
-- (DR-015) may additionally ENABLE RLS on these tables — that is idempotent
-- with the explicit `ENABLE ROW LEVEL SECURITY` here. `gen_random_uuid()` is
-- pgcrypto, already present (every prior 003x migration uses it). The live
-- POOLED migration role can execute every statement below.
--
-- gate_results NOTE: the gate-block-by-sourcing-rate (the D3 reversal trigger)
-- is COMPUTED from existing gate-result data via the data-access seam
-- (`PersistedGateResult.sourcingBlocked`, src/lib/content/context.ts) — there is
-- NO `gate_results` table in the schema (it is a seam-level projection, not a
-- persisted table), and the PR-020 inline migration does NOT add one. This
-- migration therefore creates ONLY seo_cost_ledger + share_of_model.
--
-- Source-of-truth Drizzle definitions: src/content.ts (seoCostLedger +
-- shareOfModel). Companion test: apps/seo/test/ledger/reserve.test.ts
-- (Tier-1 conditional-UPDATE concurrency / over-cap rejection, deterministic;
-- Tier-2 live-pg reconciliation when a Postgres is reachable).
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.share_of_model      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.seo_cost_run_budget DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.seo_cost_ledger     DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.share_of_model;
--   DROP TABLE IF EXISTS public.seo_cost_run_budget;
--   DROP TABLE IF EXISTS public.seo_cost_ledger;
-- (Falling back to the in-memory CostAccountant reservation only.)

-- ── seo_cost_ledger — per-(run_id, stage) AI-Gateway cost ledger ─────────────
-- reserved_usd is written PRE-FLIGHT (the cap reservation); actual_usd +
-- latency_ms + model are reconciled from the Gateway-reported usage once the
-- call returns. A run's measured per-piece cost = SUM(actual_usd) over its rows.
-- client_id FK → content_clients ON DELETE RESTRICT (a client with ledger rows
-- cannot be silently deleted); piece_id FK → content_pieces ON DELETE SET NULL
-- (a deleted piece must not orphan-delete its billing record).
CREATE TABLE IF NOT EXISTS public.seo_cost_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  piece_id      uuid REFERENCES public.content_pieces(id) ON DELETE SET NULL,
  run_id        uuid NOT NULL,
  stage         text NOT NULL,
  -- Reserved pre-flight via a lock-row conditional UPDATE (NOT sum-then-check).
  reserved_usd  numeric(10,4) NOT NULL DEFAULT 0,
  -- Gateway-reported actuals (null until the call returns + is reconciled).
  actual_usd    numeric(10,4),
  model         text,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Per-run rollup (the reconciliation reads/sums by run_id).
CREATE INDEX IF NOT EXISTS seo_cost_ledger_run_idx
  ON public.seo_cost_ledger (run_id);
-- Per-client cost over time.
CREATE INDEX IF NOT EXISTS seo_cost_ledger_client_idx
  ON public.seo_cost_ledger (client_id, created_at);
ALTER TABLE public.seo_cost_ledger ENABLE ROW LEVEL SECURITY;  -- no anon policy (cost is never public)

-- ── seo_cost_run_budget — the per-run accumulator / conditional-UPDATE lock-row ─
-- ONE row per run_id (UNIQUE). RESERVE_CONDITIONAL_SQL (reserve-conditional.ts)
-- does `UPDATE ... SET reserved_usd = reserved_usd + $cost WHERE run_id = $run AND
-- workspace_id = $ws AND client_id = $client AND reserved_usd + $cost <= cap_usd
-- RETURNING reserved_usd` — the DB row lock + the predicate are the atomic guard
-- (a concurrent over-cap reservation is rejected, never silently over-spent; no
-- sum-then-check race). cap_usd is the run's ≤$2 editorial cost cap, set when the
-- budget row is created. client_id FK → content_clients ON DELETE RESTRICT.
CREATE TABLE IF NOT EXISTS public.seo_cost_run_budget (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  -- ONE budget row per run (the conditional UPDATE locks this single row).
  run_id        uuid NOT NULL UNIQUE,
  -- Atomically incremented under the row lock; the conditional guard reads it.
  reserved_usd  numeric(10,4) NOT NULL DEFAULT 0,
  -- The run's cost cap (<= $2 editorial target); the conditional guard's ceiling.
  cap_usd       numeric(10,4) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seo_cost_run_budget_tenant_idx
  ON public.seo_cost_run_budget (workspace_id, client_id);
ALTER TABLE public.seo_cost_run_budget ENABLE ROW LEVEL SECURITY;  -- no anon policy (cost is never public)

-- ── share_of_model — AI-answer-engine citation tracking (north-star KPI) ──────
-- One row per (client_id, engine, query) citation check. `cited` + `position`
-- roll up to a per-hub citation rate (the share-of-model north star). `engine`
-- is free text (ChatGPT · Claude · Gemini per DR-038). `source_channel`
-- defaults to 'direct' (Gateway direct-query, DR-038). `parser_conf` records
-- the citation-parser's confidence; `audit_sampled` flags rows pulled for human
-- audit. client_id FK → content_clients ON DELETE RESTRICT; piece_id FK →
-- content_pieces ON DELETE SET NULL (per-hub rollup survives a piece delete as a
-- workspace/client-scoped record).
CREATE TABLE IF NOT EXISTS public.share_of_model (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  client_id      uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  piece_id       uuid REFERENCES public.content_pieces(id) ON DELETE SET NULL,
  engine         text NOT NULL,
  query          text NOT NULL,
  cited          boolean NOT NULL,
  position       integer,
  raw_response   text,
  parser_conf    numeric(4,3),
  audit_sampled  boolean NOT NULL DEFAULT false,
  source_channel text NOT NULL DEFAULT 'direct',
  locale         text,
  device_profile text,
  captured_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_of_model_client_idx
  ON public.share_of_model (client_id, captured_at);
ALTER TABLE public.share_of_model ENABLE ROW LEVEL SECURITY;  -- no anon policy (SoM is never public)
