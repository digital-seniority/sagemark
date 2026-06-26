/**
 * Host-side worker session persistence (PR 006 / P0.W.2, lane worker-runtime).
 *
 * WHY HOST-SIDE (the load-bearing design choice). The worker runs in an
 * ephemeral Sandbox microVM with NO Supabase credentials (acceptance #2/#6) and
 * the Sandbox filesystem is wiped on teardown / lease handoff (acceptance #1/#5).
 * So run state can live in NEITHER place across runs. It is persisted HERE, on
 * the host, which holds the Supabase service role. The worker emits state via the
 * `host-tool-bridge` and the host writes it; on reload the host reconstructs the
 * full run from Supabase (acceptance #1 — "fully reconstructable after teardown").
 *
 * This module NEVER runs inside the Sandbox. It is imported only by host-side
 * code (the bridge endpoint / orchestrator). It carries `server-only` so a stray
 * import into a worker bundle fails the build (and is aliased away in tests).
 *
 * MOCKABLE DATA ACCESS (mirrors lib/content/context.ts, DR-006). Sagemark has no
 * live service-role wired in a worktree, so the store talks to Supabase ONLY
 * through the `SessionPersistence` seam:
 *   - Tier-1 tests inject an in-memory impl and assert a full round-trip +
 *     teardown-then-reload (acceptance #1) WITHOUT any live infra;
 *   - the production default is `createSupabaseSessionPersistence`, which reads
 *     the service role from the host env (NEVER shipped to the worker) and writes
 *     the `worker_sessions` table (migration 0034);
 *   - a fail-closed `NOT_WIRED` default throws loudly rather than silently
 *     succeeding if no impl is injected and no service role is present.
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";

import type { RunBinding } from "./host-tool-bridge";

// ── The persisted run-session shape ───────────────────────────────────────────

/** Lifecycle states a run session moves through. `error` is terminal (acceptance #4). */
export type SessionStatus = "running" | "completed" | "error";

/**
 * The durable record of one worker run. Everything needed to reconstruct the run
 * after the microVM is gone lives here (acceptance #1): the tenancy binding, the
 * Agent-SDK session id (for resume), the loop cursor / agent state blob, the
 * lease id (acceptance #4), and any terminal error.
 *
 * NB: this holds NO secrets — never the bridge JWT, never a provider key. State
 * only. Secrets are minted per-run and die with the VM.
 */
export interface WorkerSession {
  runId: string;
  workspaceId: string;
  clientId: string;
  /** The Agent-SDK session id (`session_id` from the SDK) — lets a reload resume. */
  agentSessionId: string | null;
  status: SessionStatus;
  /** Opaque loop/agent state (cursor, last step, persisted-piece ids). JSON-able. */
  state: Record<string, unknown>;
  /** The lease this run holds on its (pooled) VM (acceptance #4/#5). */
  leaseId: string | null;
  /** Set when status === 'error' — the terminal error event payload (acceptance #4). */
  terminalError: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** The fields a caller may set when opening a session. */
export interface OpenSessionInput {
  binding: RunBinding;
  agentSessionId?: string | null;
  leaseId?: string | null;
  state?: Record<string, unknown>;
}

/** A partial update to a live session. */
export interface UpdateSessionInput {
  agentSessionId?: string | null;
  status?: SessionStatus;
  state?: Record<string, unknown>;
  leaseId?: string | null;
  terminalError?: { code: string; message: string } | null;
}

// ── The persistence seam ──────────────────────────────────────────────────────

/**
 * The mockable storage interface. The real impl writes the `worker_sessions`
 * table with the service role; tests inject an in-memory impl. Reads are scoped
 * by `runId` (the tenancy is stored on the row and returned, so a reloader can
 * re-verify the binding).
 */
export interface SessionPersistence {
  upsert(session: WorkerSession): Promise<void>;
  load(runId: string): Promise<WorkerSession | null>;
}

// ── Production default: fail-closed "not wired" stub ──────────────────────────

class SessionStoreNotWiredError extends Error {
  readonly code = "SESSION_STORE_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `worker session store is not wired: '${op}' has no live Supabase service-role ` +
        `backend in this build. Inject a SessionPersistence, or set SUPABASE_SERVICE_ROLE_KEY ` +
        `+ NEXT_PUBLIC_SUPABASE_URL on the HOST (never the worker) and use ` +
        `createSupabaseSessionPersistence().`,
    );
    this.name = "SessionStoreNotWiredError";
  }
}

/** Fail-closed default — every method throws loudly. */
export const NOT_WIRED_SESSION_PERSISTENCE: SessionPersistence = {
  upsert: () => {
    throw new SessionStoreNotWiredError("upsert");
  },
  load: () => {
    throw new SessionStoreNotWiredError("load");
  },
};

export { SessionStoreNotWiredError };

// ── The store ─────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Host-side session store. Thin orchestration over a `SessionPersistence`:
 * stamps timestamps, freezes the tenancy binding onto the row, and exposes the
 * open / update / persist-state / fail / reload surface the bridge endpoint and
 * orchestrator call.
 */
export class WorkerSessionStore {
  constructor(
    private readonly persistence: SessionPersistence = NOT_WIRED_SESSION_PERSISTENCE,
  ) {}

  /** Open (or re-open) a run session. Tenancy is taken from the binding only. */
  async open(input: OpenSessionInput): Promise<WorkerSession> {
    const ts = nowIso();
    const session: WorkerSession = {
      runId: input.binding.runId,
      workspaceId: input.binding.workspaceId,
      clientId: input.binding.clientId,
      agentSessionId: input.agentSessionId ?? null,
      status: "running",
      state: input.state ?? {},
      leaseId: input.leaseId ?? null,
      terminalError: null,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.persistence.upsert(session);
    return session;
  }

  /**
   * Apply a partial update to a session, scoped by runId. Loads-merges-writes so
   * the persisted row always carries the full state (acceptance #1 reload).
   * Throws if the run is unknown (no silent create on update).
   */
  async update(runId: string, patch: UpdateSessionInput): Promise<WorkerSession> {
    const existing = await this.persistence.load(runId);
    if (!existing) {
      throw new Error(`cannot update unknown worker session: runId=${runId}`);
    }
    const next: WorkerSession = {
      ...existing,
      agentSessionId:
        patch.agentSessionId !== undefined ? patch.agentSessionId : existing.agentSessionId,
      status: patch.status ?? existing.status,
      state: patch.state !== undefined ? patch.state : existing.state,
      leaseId: patch.leaseId !== undefined ? patch.leaseId : existing.leaseId,
      terminalError:
        patch.terminalError !== undefined ? patch.terminalError : existing.terminalError,
      updatedAt: nowIso(),
    };
    await this.persistence.upsert(next);
    return next;
  }

  /** Persist the loop's working state (the worker's heartbeat). */
  async persistState(runId: string, state: Record<string, unknown>): Promise<WorkerSession> {
    return this.update(runId, { state });
  }

  /**
   * Mark a run terminally failed and RELEASE its lease (acceptance #4). A wedged
   * or timed-out run calls this so no lease/VM is left held. Idempotent: failing
   * an already-failed run just re-stamps.
   */
  async fail(
    runId: string,
    terminalError: { code: string; message: string },
  ): Promise<WorkerSession> {
    return this.update(runId, { status: "error", terminalError, leaseId: null });
  }

  /** Mark a run completed (and drop its lease). */
  async complete(runId: string, state?: Record<string, unknown>): Promise<WorkerSession> {
    return this.update(runId, { status: "completed", state, leaseId: null });
  }

  /**
   * Reconstruct a run from durable storage (acceptance #1 — "reloads a persisted
   * run"). Returns the full session, or null if unknown. This is the proof that
   * the run survives microVM teardown: nothing of it lived on the VM.
   */
  async reload(runId: string): Promise<WorkerSession | null> {
    return this.persistence.load(runId);
  }
}

// ── In-memory persistence (Tier-1 tests; no infra) ────────────────────────────

/**
 * An in-memory `SessionPersistence` for Tier-1 round-trip tests. Stores a deep
 * copy per row so a returned session cannot be mutated through a held reference —
 * the round-trip test asserts the reload equals what was written (acceptance #1)
 * without any live Supabase.
 */
export function createInMemorySessionPersistence(): SessionPersistence & {
  /** Test introspection: number of stored rows. */
  size(): number;
} {
  const rows = new Map<string, WorkerSession>();
  const clone = (s: WorkerSession): WorkerSession => JSON.parse(JSON.stringify(s));
  return {
    async upsert(session: WorkerSession): Promise<void> {
      rows.set(session.runId, clone(session));
    },
    async load(runId: string): Promise<WorkerSession | null> {
      const found = rows.get(runId);
      return found ? clone(found) : null;
    },
    size(): number {
      return rows.size;
    },
  };
}

// ── Supabase persistence (production; host service-role) ───────────────────────

/**
 * The production `SessionPersistence`, backed by the `worker_sessions` table
 * (migration 0034) via a Supabase service-role client. The service role is read
 * from the HOST env — it is NEVER provisioned into the worker's Sandbox env
 * (acceptance #2/#6). `@supabase/supabase-js` is imported dynamically so this
 * module (and anything that defaults to it) imports with no network and no key;
 * a missing dep / missing env throws a precise, fail-closed error.
 *
 * NB: not exercised by Tier-1 tests (no live service role in a worktree) — the
 * live round-trip is a Tier-2 step (see the PR report's NEEDS-INPUT run steps).
 */
export function createSupabaseSessionPersistence(opts?: {
  url?: string;
  serviceRoleKey?: string;
  table?: string;
}): SessionPersistence {
  const url = opts?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = opts?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = opts?.table ?? "worker_sessions";

  if (!url || !serviceRoleKey) {
    throw new SessionStoreNotWiredError(
      "createSupabaseSessionPersistence (missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on host)",
    );
  }

  // Lazily resolved client so import stays network-free + dep-optional.
  let clientPromise: Promise<{
    from: (t: string) => {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
    };
  }> | null = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let createClient: (u: string, k: string, o?: any) => any;
        try {
          ({ createClient } = await import("@supabase/supabase-js"));
        } catch (err) {
          throw new Error(
            "[NEEDS-DEP] @supabase/supabase-js is not installed on the host. " +
              "Install it: `pnpm --filter @sagemark/seo add @supabase/supabase-js`. " +
              `Underlying error: ${(err as Error).message}`,
          );
        }
        return createClient(url!, serviceRoleKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        }) as never;
      })();
    }
    return clientPromise;
  }

  const toRow = (s: WorkerSession): Record<string, unknown> => ({
    run_id: s.runId,
    workspace_id: s.workspaceId,
    client_id: s.clientId,
    agent_session_id: s.agentSessionId,
    status: s.status,
    state: s.state,
    lease_id: s.leaseId,
    terminal_error: s.terminalError,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  });

  const fromRow = (r: Record<string, unknown>): WorkerSession => ({
    runId: r.run_id as string,
    workspaceId: r.workspace_id as string,
    clientId: r.client_id as string,
    agentSessionId: (r.agent_session_id as string | null) ?? null,
    status: r.status as SessionStatus,
    state: (r.state as Record<string, unknown> | null) ?? {},
    leaseId: (r.lease_id as string | null) ?? null,
    terminalError: (r.terminal_error as WorkerSession["terminalError"]) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  });

  return {
    async upsert(session: WorkerSession): Promise<void> {
      const c = await client();
      const { error } = await c.from(table).upsert(toRow(session), { onConflict: "run_id" });
      if (error) {
        throw new Error(`worker_sessions upsert failed: ${JSON.stringify(error)}`);
      }
    },
    async load(runId: string): Promise<WorkerSession | null> {
      const c = await client();
      const { data, error } = await c.from(table).select("*").eq("run_id", runId).maybeSingle();
      if (error) {
        throw new Error(`worker_sessions load failed: ${JSON.stringify(error)}`);
      }
      return data ? fromRow(data) : null;
    },
  };
}
