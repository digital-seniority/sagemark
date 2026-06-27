-- 0040_conversations.sql — the chat-first front-door run-session model (Slice 5,
-- lane schema-tenancy). TWO NEW public-schema tables modelling a per-turn chat
-- conversation against a content client, and the agent runs each turn spawns:
--
--   1. `conversations`      — one row per chat thread a operator opens against a
--      content client. Bound to a workspace + client (the tenancy keys every
--      operator query carries). `piece_id` is NULLABLE — a conversation exists
--      BEFORE any draft, and is linked to its content_piece only once the first
--      draft lands (ON DELETE SET NULL: deleting the piece must not delete the
--      conversation history). `status` is active | archived.
--
--   2. `conversation_turns` — the ordered per-turn log within a conversation
--      (`seq` 1..N, UNIQUE per conversation). Each turn is a user or agent
--      message. An agent turn that spawned a worker run carries `run_id`
--      (FK → worker_sessions.run_id, the natural text key; ON DELETE SET NULL so
--      a pruned worker-session row does not delete the turn) plus the resulting
--      `piece_version` + `verdict` snapshot. `workspace_id`/`client_id` are
--      denormalized (same pattern as content_piece_versions / review_comments) so
--      a future tenant-read policy needs no join.
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS` table/index guards, matching the
-- 0030-0039 convention). Touches ONLY the `public` schema. MUST NOT alter or drop
-- any existing table, column, constraint, index, or policy.
--
-- RLS — FAIL-CLOSED, mirrors the 0032/0033/0034/0035/0036/0039 "ENABLE ROW LEVEL
-- SECURITY; NO anon policy" pattern (DR-023). Anon reaches ZERO rows on BOTH
-- tables: a conversation + its turns are private operator/run state, NEVER public.
-- They are read/written ONLY through the service-role data-access seam (every
-- query carries an explicit workspace_id + client_id filter — service role
-- bypasses RLS, so the app filter is the tenancy boundary). There are no
-- authenticated non-service tenant users (auth seam is a no-op, DR-003), so no
-- tenant-read policy is needed here.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): this migration writes
-- ONLY the `public` schema and uses ONLY `CREATE TABLE`, `CREATE INDEX`,
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It declares NO event trigger, NO
-- SET ROLE, NO GRANT, NO ALTER OWNER, NO CREATE EXTENSION, and depends on NO
-- superuser-only construct. `gen_random_uuid()` is pgcrypto, already present
-- (every prior 003x migration uses it). The `content_verdict` enum the
-- conversation_turns.verdict column uses already exists (created upstream of
-- 0030). The live POOLED migration role can execute every statement below.
--
-- Source-of-truth Drizzle definitions: src/content.ts (conversations +
-- conversationTurns). Companion test: apps/seo/test/tenancy/rls-contract.test.ts
-- (Tier-1 static RLS shape + Tier-2 anon-zero-rows behavioral assertions).
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.conversation_turns DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.conversations      DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.conversation_turns;
--   DROP TABLE IF EXISTS public.conversations;

-- ── conversations — one chat thread per (workspace, client) ──────────────────
-- client_id FK → content_clients ON DELETE RESTRICT (a client with conversations
-- cannot be silently deleted). piece_id FK → content_pieces ON DELETE SET NULL
-- (nullable: null until the first draft; deleting the piece keeps the thread).
CREATE TABLE IF NOT EXISTS public.conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  -- Nullable: a conversation predates its first draft; linked once a piece exists.
  piece_id      uuid REFERENCES public.content_pieces(id) ON DELETE SET NULL,
  title         text,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_workspace_client_idx
  ON public.conversations (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS conversations_client_piece_idx
  ON public.conversations (client_id, piece_id);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;  -- no anon policy (conversations are never public)

-- ── conversation_turns — the ordered per-turn log within a conversation ──────
-- conversation_id FK → conversations ON DELETE CASCADE (turns die with the
-- thread). run_id FK → worker_sessions.run_id (text natural key) ON DELETE SET
-- NULL (nullable: a user turn spawns no run; a pruned worker-session row must not
-- delete the turn). verdict uses the existing content_verdict enum (nullable).
-- workspace_id/client_id denormalized so a future tenant policy needs no join.
CREATE TABLE IF NOT EXISTS public.conversation_turns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL,
  client_id       uuid NOT NULL,
  seq             integer NOT NULL,
  role            text NOT NULL CHECK (role IN ('user','agent')),
  content         text NOT NULL DEFAULT '',
  -- Nullable: only an agent turn that spawned a worker run carries a run_id.
  run_id          text REFERENCES public.worker_sessions(run_id) ON DELETE SET NULL,
  -- Nullable: the content_piece version this turn produced, if any.
  piece_version   integer,
  -- Nullable: the eval verdict snapshot for this turn (existing content_verdict enum).
  verdict         content_verdict,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_turns_conversation_seq_unique UNIQUE (conversation_id, seq)
);
CREATE INDEX IF NOT EXISTS conversation_turns_conversation_seq_idx
  ON public.conversation_turns (conversation_id, seq);
CREATE INDEX IF NOT EXISTS conversation_turns_tenant_idx
  ON public.conversation_turns (workspace_id, client_id);
ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;  -- no anon policy (turns are never public)
