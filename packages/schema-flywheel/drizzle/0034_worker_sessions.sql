-- 0034_worker_sessions.sql — host-side persistence for the autonomous worker
-- (PR 006 / P0.W.2, lane worker-runtime). The Agent-SDK worker runs in an
-- ephemeral Vercel Sandbox microVM with NO Supabase credentials and a working
-- dir that is wiped on teardown / lease handoff. Run state can therefore live in
-- NEITHER place across runs — it is persisted HERE, written by the HOST (which
-- holds the service role) via the bridge. On reload the host reconstructs the
-- full run from this table (acceptance #1 — "fully reconstructable after
-- teardown"). Source-of-truth Drizzle definition: src/content.ts (workerSessions).
--
-- This table holds STATE ONLY — never a secret. No bridge JWT, no provider key:
-- those are minted per-run and die with the VM.
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS` guards, matching the 0030-0033
-- convention). MUST NOT alter or drop any existing table/column/constraint/policy.
--
-- RLS posture — FAIL-CLOSED, identical to the 0032/0033 pattern. This is an
-- internal operator/host table, not a render surface: RLS is ENABLED and NO anon
-- policy is created, so anon reaches ZERO rows. The only access path is the
-- service role (the host pipeline), which bypasses RLS. There are no
-- authenticated non-service tenant users, so no tenant-read policy is needed.
--
-- ROLLBACK (down) — additive, so the down is:
--   DROP TABLE IF EXISTS public.worker_sessions;

CREATE TABLE IF NOT EXISTS public.worker_sessions (
  -- One row per run. run_id is the natural key the bridge / reload uses.
  run_id           text PRIMARY KEY,
  -- Tenancy binding (acceptance #3) — denormalized so a reload can re-verify the
  -- (workspace, client) scope without a join.
  workspace_id     uuid NOT NULL,
  client_id        uuid NOT NULL,
  -- The Agent-SDK session id (resume key). Null until the loop emits it.
  agent_session_id text,
  -- Lifecycle: running | completed | error (error is terminal, acceptance #4).
  status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','completed','error')),
  -- Opaque loop/agent state blob (cursor, last step, persisted-piece ids).
  state            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The lease this run holds on its (pooled) VM; nulled on release (acceptance #4/#5).
  lease_id         text,
  -- The terminal error event payload, set when status = 'error' (acceptance #4).
  terminal_error   jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_sessions_tenant_idx
  ON public.worker_sessions (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS worker_sessions_status_idx
  ON public.worker_sessions (status);
-- Reclaim-the-lease lookup for the ceiling watchdog (acceptance #4): live runs
-- still holding a lease.
CREATE INDEX IF NOT EXISTS worker_sessions_lease_idx
  ON public.worker_sessions (lease_id)
  WHERE lease_id IS NOT NULL;

ALTER TABLE public.worker_sessions ENABLE ROW LEVEL SECURITY;  -- no anon policy
