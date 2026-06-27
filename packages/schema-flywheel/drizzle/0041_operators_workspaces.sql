-- 0041_operators_workspaces.sql — operator identity + workspace membership
-- (Slice 5, lane schema-tenancy). THREE NEW public-schema tables giving the
-- chat-first front door a real operator/workspace model that the existing
-- `workspace_id` tenancy column (carried by content_clients, conversations, the
-- cost ledger, etc.) finally resolves against:
--
--   1. `operators`         — operator identity. `id` IS the Supabase
--      `auth.users` subject id, held as a SOFT reference — NOT a hard
--      cross-schema FK to `auth.users`. The migration role cannot write the
--      `auth` schema and we do not couple the public schema to Supabase-internal
--      DDL; the application is responsible for keeping `operators.id` in step
--      with the auth subject. `email` is a denormalized convenience copy.
--
--   2. `workspaces`        — a workspace owned by a user or a team. `owner_type`
--      is user | team; `owner_id` is the owning operator/team id (soft, no FK —
--      a team is not yet a table). This is the entity the `workspace_id` columns
--      across the schema point at.
--
--   3. `workspace_members` — the operator↔workspace membership join. Composite
--      PRIMARY KEY (workspace_id, operator_id) — one membership row per pair.
--      workspace_id FK → workspaces ON DELETE CASCADE; operator_id FK → operators
--      ON DELETE CASCADE (removing either end removes the membership). `role` is
--      free text, default 'member'.
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS` table/index guards, matching the
-- 0030-0040 convention). Touches ONLY the `public` schema. MUST NOT alter or drop
-- any existing table, column, constraint, index, or policy. In particular it does
-- NOT add an FK from any existing `workspace_id` column to `workspaces` (that
-- would be a change to an existing table — out of scope; the bridge stays soft).
--
-- RLS — FAIL-CLOSED, mirrors the 0032/0033/0034/0035/0036/0039/0040 "ENABLE ROW
-- LEVEL SECURITY; NO anon policy" pattern (DR-023). Anon reaches ZERO rows on ALL
-- THREE tables: operator identity, workspace ownership, and membership are the
-- tenancy ROOT — exactly the data anon must never see (the same posture as
-- content_clients, the workspace↔client map, in 0033). They are read/written ONLY
-- through the service-role data-access seam; service role bypasses RLS, so the
-- app filter is the tenancy boundary. There are no authenticated non-service
-- tenant users (auth seam is a no-op, DR-003), so no tenant-read policy is needed.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): this migration writes
-- ONLY the `public` schema and uses ONLY `CREATE TABLE`, `CREATE INDEX`,
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It declares NO event trigger, NO
-- SET ROLE, NO GRANT, NO ALTER OWNER, NO CREATE EXTENSION, NO cross-schema
-- (`auth.*`) reference, and depends on NO superuser-only construct.
-- `gen_random_uuid()` is pgcrypto, already present. The live POOLED migration
-- role can execute every statement below.
--
-- Source-of-truth Drizzle definitions: src/content.ts (operators + workspaces +
-- workspaceMembers). Companion test: apps/seo/test/tenancy/rls-contract.test.ts
-- (Tier-1 static RLS shape + Tier-2 anon-zero-rows behavioral assertions).
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.workspace_members DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.workspaces        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.operators         DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.workspace_members;
--   DROP TABLE IF EXISTS public.workspaces;
--   DROP TABLE IF EXISTS public.operators;

-- ── operators — operator identity (SOFT ref to auth.users subject id) ─────────
-- id IS the Supabase auth.users subject id, but held as a SOFT reference — NO
-- hard cross-schema FK to auth.users (the migration role cannot write auth.*; the
-- app keeps this in step). Created FIRST so workspace_members.operator_id has a
-- target.
CREATE TABLE IF NOT EXISTS public.operators (
  -- The Supabase auth.users subject id (soft reference, NOT a cross-schema FK).
  id          uuid PRIMARY KEY,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;  -- no anon policy (operator identity is never public)

-- ── workspaces — a workspace owned by a user or a team ───────────────────────
-- The entity every `workspace_id` column across the schema points at. owner_type
-- is user | team; owner_id is the owning operator/team id (soft, no FK).
CREATE TABLE IF NOT EXISTS public.workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  text NOT NULL CHECK (owner_type IN ('user','team')),
  -- The owning operator/team id (soft reference: a team is not yet a table).
  owner_id    uuid,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;  -- no anon policy (workspaces are the tenancy root, never public)

-- ── workspace_members — the operator↔workspace membership join ───────────────
-- Composite PK (workspace_id, operator_id): one membership per pair. Both FKs ON
-- DELETE CASCADE — dropping either the workspace or the operator drops the
-- membership.
CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operator_id   uuid NOT NULL REFERENCES public.operators(id)  ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member',
  PRIMARY KEY (workspace_id, operator_id)
);
-- Reverse lookup: every workspace an operator belongs to.
CREATE INDEX IF NOT EXISTS workspace_members_operator_idx
  ON public.workspace_members (operator_id);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;  -- no anon policy (membership is the tenancy root, never public)
