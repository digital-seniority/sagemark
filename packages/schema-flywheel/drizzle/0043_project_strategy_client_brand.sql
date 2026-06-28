-- 0043_project_strategy_client_brand.sql — hub skill wiring, Slice 1.
-- Three additive nullable columns across TWO existing tables:
--
--   1. `projects.strategy`            — the proposed/approved ContentStrategy JSON blob.
--   2. `projects.strategy_status`     — lifecycle flag: proposed → approved → archived.
--                                       NULL = no strategy submitted yet.
--   3. `projects.strategy_approved_at`— timestamp the operator approved the strategy.
--   4. `content_clients.brand_spec`   — the client's brand (palette, typography, NAP, logo).
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS` / `DO $$` guards, matching 0042).
-- Touches ONLY the `public` schema. MUST NOT alter or drop any existing column,
-- constraint, index, or policy.
--
-- RLS — inherited from the parent tables (0042 for projects, 0033 for content_clients).
-- No new tables, no new policies. Anon still reaches ZERO rows on both tables.
--
-- MIGRATION-ROLE NOTE: writes ONLY the `public` schema; uses ONLY ALTER TABLE ADD
-- COLUMN + DO $$ block. NO event trigger, NO SET ROLE, NO GRANT, NO ALTER OWNER,
-- NO CREATE EXTENSION, NO superuser-only construct.
--
-- Source-of-truth Drizzle definitions: packages/schema-flywheel/src/content.ts.
-- Companion test: apps/seo/test/tenancy/rls-contract.test.ts.
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS strategy;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS strategy_status;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS strategy_approved_at;
--   ALTER TABLE public.content_clients DROP COLUMN IF EXISTS brand_spec;

-- ── projects — strategy lifecycle columns ────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS strategy              jsonb,
  ADD COLUMN IF NOT EXISTS strategy_status       text,
  ADD COLUMN IF NOT EXISTS strategy_approved_at  timestamptz;

-- CHECK constraint (guarded against duplicate creation on re-run, mirroring 0031).
-- NULL passes the CHECK (NULL IN (...) = NULL, which Postgres treats as not-false),
-- so the column remains nullable while the constraint rejects invalid non-null values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_strategy_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_strategy_status_check
      CHECK (strategy_status IN ('proposed','approved','archived'));
  END IF;
END$$;

-- ── content_clients — brand spec column ──────────────────────────────────────────
ALTER TABLE public.content_clients
  ADD COLUMN IF NOT EXISTS brand_spec jsonb;
