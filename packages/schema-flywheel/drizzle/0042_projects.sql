-- 0042_projects.sql — the Projects organizational layer (studio UX overhaul,
-- Slice 5). ONE NEW public-schema table + TWO additive nullable FK columns:
--
--   1. `projects` — an operator-created container that groups many content pieces
--      for ONE content client (the user-facing home of the cluster concept). Bound
--      to a workspace + client (the tenancy keys every operator query carries).
--      `brief` is the operator-editable narrative carried into new articles;
--      `summary` is the auto-assembled facts cache (titles/roles/keywords of prior
--      pieces) refreshed as articles complete. Both feed the cross-article context
--      injected into a new run (build-project-context.ts).
--
--   2. `conversations.project_id` — NULLABLE FK → projects. A chat thread MAY be
--      opened inside a project; the run's turn pre-amble reads it to inject the
--      project context. ON DELETE SET NULL (deleting a project keeps the thread).
--
--   3. `content_pieces.project_id` — NULLABLE FK → projects. The article's project
--      home (inherited from its conversation), so a project can list its pieces and
--      the next article's context can summarize prior ones. ON DELETE SET NULL.
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS` table/index/column guards, matching
-- the 0030-0041 convention). Touches ONLY the `public` schema. MUST NOT alter or
-- drop any existing table, column, constraint, index, or policy.
--
-- RLS — FAIL-CLOSED, mirrors the 0033/0040/0041 "ENABLE ROW LEVEL SECURITY; NO anon
-- policy" pattern (DR-023). Anon reaches ZERO rows: a project is private operator
-- state, NEVER public. It is read/written ONLY through the service-role data-access
-- seam (every query carries an explicit workspace_id + client_id filter — service
-- role bypasses RLS, so the app filter is the tenancy boundary). There are no
-- authenticated non-service tenant users (auth seam is a no-op, DR-003), so no
-- tenant-read policy is needed here. The two added FK columns live on tables whose
-- RLS is already enabled (0030 content_pieces, 0040 conversations) — unchanged.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): writes ONLY the
-- `public` schema; uses ONLY CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN,
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY. NO event trigger, NO SET ROLE, NO
-- GRANT, NO ALTER OWNER, NO CREATE EXTENSION, NO superuser-only construct.
-- `gen_random_uuid()` (pgcrypto) is already present (every prior 003x uses it).
--
-- Source-of-truth Drizzle definitions: src/content.ts (projects + the two added
-- columns). Companion test: apps/seo/test/tenancy/rls-contract.test.ts.
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.content_pieces DROP COLUMN IF EXISTS project_id;
--   ALTER TABLE public.conversations  DROP COLUMN IF EXISTS project_id;
--   ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.projects;

-- ── projects — an article container for one (workspace, client) ──────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  description   text,
  -- The operator-editable narrative carried into new articles (hybrid context).
  brief         text NOT NULL DEFAULT '',
  -- The auto-assembled facts cache (prior-piece titles/roles/keywords), refreshed
  -- as articles complete. JSONB so the shape can grow without a migration.
  summary       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_workspace_client_idx
  ON public.projects (workspace_id, client_id);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;  -- no anon policy (projects are never public)

-- ── conversations.project_id — the thread's project (nullable) ───────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON public.conversations (project_id);

-- ── content_pieces.project_id — the article's project home (nullable) ────────
ALTER TABLE public.content_pieces
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS content_pieces_project_idx
  ON public.content_pieces (project_id);
