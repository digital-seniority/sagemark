-- 0036_comment_threads.sql — tokenized client-review surface (PR 018, lane
-- client-review). Two NEW public-schema tables backing `/review/[token]`:
--
--   1. `review_tokens`   — the opaque-token boundary. A token hash resolves to
--      EXACTLY ONE (workspace_id, client_id, piece_id, version) tuple. The token
--      is a FAIL-CLOSED ROW-SCOPED boundary, never a render-time flag: a token
--      for client A can never resolve client B's piece or a different version,
--      because the lookup is scoped by the row's own (client_id, piece_id,
--      version) and there is one row per token. We store ONLY a SHA-256 hash of
--      the token (`token_hash`), never the opaque token itself — a DB leak does
--      not hand an attacker a working review link.
--
--   2. `comment_threads` — the per-(piece, version) reviewer annotation rows:
--      element-anchored PINS (normalized 0..1 coords + elementHint) and the
--      section-level verbs (section-approve / request-changes). The RFC schema
--      (§133) is the authority for the column set; `workspace_id` is ADDED for
--      tenancy (every row is workspace+client scoped). The `version` column
--      records the version a pin/verb was left on (the AC's `version_left_on` —
--      see header note below; we reconcile to the canonical `version` column).
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS`). Touches ONLY the `public`
-- schema. MUST NOT alter or drop any existing table, column, constraint, index,
-- or policy. Follows the exact style of 0033_content_clients_rls /
-- 0035_generated_images.
--
-- RLS — FAIL-CLOSED, mirrors the 0032/0033/0035 "ENABLE ROW LEVEL SECURITY; no
-- anon policy" pattern (DR-023). Anon reaches ZERO rows on BOTH tables: a review
-- token is resolved server-side through the service-role data-access seam
-- (`resolve-token.ts`), NEVER by an anon client reading these tables directly.
-- The /review surface renders the published/draft hub it is scoped to via the
-- existing SSR render route; the comment tables themselves are never anon-read.
-- There are no authenticated non-service tenant users (auth seam is a no-op,
-- DR-003), so no tenant-read policy is needed here.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): this migration
-- writes ONLY the `public` schema and uses ONLY `CREATE TABLE`, `CREATE INDEX`,
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It declares NO event trigger, NO
-- SET ROLE, NO GRANT EXECUTE on system functions, NO ALTER OWNER, and depends on
-- NO superuser-only construct. The pre-existing `rls_auto_enable()` event
-- trigger (DR-015) may additionally ENABLE RLS on these tables — that is
-- idempotent with the explicit `ENABLE ROW LEVEL SECURITY` here. The live POOLED
-- migration role can execute every statement below.
--
-- VERSION_LEFT_ON RECONCILIATION (AC#3): the acceptance criterion requires a pin
-- to record "the version it was left on". The canonical RFC schema names this
-- column `version`. We use the `version` column to record the version a pin/verb
-- was left on (a pin dropped while reviewing v3 has version=3) and do NOT add a
-- separate `version_left_on` column — the two are the same fact, and a second
-- column would invite drift. The Drizzle `commentThreads.version` field carries
-- this meaning; `resolve-token.ts` + the comments route pass the resolved tuple
-- version into it.
--
-- Source-of-truth Drizzle definitions: src/content.ts (reviewTokens +
-- commentThreads). Companion tests: apps/seo/test/review/token-scope.test.ts
-- (Tier-1 structural over THIS SQL; Tier-2 anon->zero-rows / cross-tenant /
-- cross-version denial when a Postgres is reachable).
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.comment_threads DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.review_tokens   DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.comment_threads;
--   DROP TABLE IF EXISTS public.review_tokens;

-- ── review_tokens — the opaque-token → one-tuple boundary ────────────────────
-- One row per issued review link. `token_hash` is the SHA-256 (hex) of the
-- opaque token handed to the client; the opaque token is NEVER stored. The tuple
-- (workspace_id, client_id, piece_id, version) is the EXACT and ONLY scope the
-- token grants read of. `expires_at` is optional (null = no expiry); a token
-- with `revoked_at` set or past `expires_at` resolves to nothing (fail-closed).
CREATE TABLE IF NOT EXISTS public.review_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex of the opaque token (the lookup key). Unique: one tuple per token.
  token_hash    text NOT NULL,
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE CASCADE,
  piece_id      uuid NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  -- The single version this token grants read of (cross-version requests 404).
  version       integer NOT NULL,
  -- Optional expiry; null = never expires.
  expires_at    timestamptz,
  -- Revocation is a new state, never a delete (so an audit trail survives).
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One tuple per token hash — the structural guarantee that a token resolves to
-- exactly one (workspace, client, piece, version).
CREATE UNIQUE INDEX IF NOT EXISTS review_tokens_token_hash_unique
  ON public.review_tokens (token_hash);
CREATE INDEX IF NOT EXISTS review_tokens_tuple_idx
  ON public.review_tokens (workspace_id, client_id, piece_id, version);
ALTER TABLE public.review_tokens ENABLE ROW LEVEL SECURITY;  -- no anon policy (fail-closed; resolved service-role only)

-- ── comment_threads — element-anchored pins + section verbs ──────────────────
-- The RFC §133 column set, plus `workspace_id` for tenancy. `kind` is the
-- pin·section-approve·request-changes discriminator; `status` is open·resolved.
-- `anchor` is the normalized 0..1 pin coords + `elementHint` (jsonb) — null for
-- a section verb that is not element-anchored. `version` records the version the
-- comment was left on (the AC's version_left_on; see header reconciliation).
CREATE TABLE IF NOT EXISTS public.comment_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE CASCADE,
  piece_id      uuid NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  -- The version this comment was left on (version_left_on, reconciled to version).
  version       integer NOT NULL,
  -- pin | section-approve | request-changes (the section-verb discriminator).
  -- Pinned to its vocabulary inline (idempotent with CREATE TABLE IF NOT EXISTS;
  -- a separate ALTER TABLE ADD CONSTRAINT is not idempotent pre-PG16).
  kind          text NOT NULL CHECK (kind IN ('pin', 'section-approve', 'request-changes')),
  -- Normalized pin anchor: { x:0..1, y:0..1, elementHint?:string, ... }. Null for
  -- a non-anchored section verb. Coords are validated finite+[0,1] before insert.
  anchor        jsonb,
  -- The comment body (may be empty for a bare section-approve).
  body          text NOT NULL DEFAULT '',
  -- The reviewer who left it (the client contact; opaque id, no FK to auth yet).
  author        text NOT NULL,
  -- open | resolved.
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- The RFC §133 index: (piece_id, version, status).
CREATE INDEX IF NOT EXISTS comment_threads_piece_version_status_idx
  ON public.comment_threads (piece_id, version, status);
CREATE INDEX IF NOT EXISTS comment_threads_tenant_idx
  ON public.comment_threads (workspace_id, client_id);
ALTER TABLE public.comment_threads ENABLE ROW LEVEL SECURITY;  -- no anon policy (fail-closed)
