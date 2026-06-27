/**
 * POST /api/run — the autonomous-run dispatcher + SSE relay entrypoint
 * (PR 007 / P0.W.4, lane worker-runtime).
 *
 * THE STREAMING-HOP FRONT DOOR. One request opens one run: it authenticates the
 * operator, binds tenancy SERVER-side, pre-flight-reserves the run budget, mints
 * the per-run bridge JWT, dispatches the Agent-SDK worker, and relays the worker's
 * taxonomy-coded events to the browser as Server-Sent Events. The ordered gates:
 *
 *   1. AUTH -> WORKSPACE -> CLIENT (tenancy bind, reusing the PR 005 chokepoint
 *      `bindRequestContext`): the workspace is the SERVER's resolution of "who",
 *      never request input; `clientId` is validated to belong to it (404 on a
 *      forged id; 401 unauthenticated). Tenancy is NEVER widened by argument.
 *
 *   2. COST PRE-FLIGHT (acceptance 3): `CostAccountant.reserve()` runs BEFORE any
 *      worker dispatch. A request over the per-run cap returns a cost error (a
 *      synchronous JSON 402) and dispatches NOTHING — fail-closed, never spend
 *      first and apologize.
 *
 *   3. PER-RUN JWT (acceptance 6): a JWT scoped to EXACTLY (workspace_id,
 *      client_id, run_id) and expiring at the run-budget ceiling (~90s) is minted
 *      HERE. It is the worker's only host credential; every host tool verifies it
 *      (`verifyBridgeToken`). An expired or cross-run token is rejected.
 *
 *   4. DISPATCH + RELAY: the worker is dispatched (injected for tests / Tier-2
 *      live) and its event stream is relayed via `sse-relay`. A `Last-Event-ID`
 *      reconnect re-reads the persisted truth snapshot (acceptance 5).
 *
 * Non-streamed failures (auth, tenancy, cost, bad body) return a normal JSON
 * Response; a successful dispatch returns the `text/event-stream` relay body.
 *
 * ROLLBACK: replace the dispatch+relay tail with a synchronous 501 JSON error and
 * the worker stays behind its flag (see the PR report's rollback plan).
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import { CostAccountant, CostCapExceededError } from "@sagemark/core";
import {
  bindRequestContext,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import {
  relayResponse,
  parseLastEventId,
  RUN_BUDGET_CEILING_MS,
  type TruthSnapshotReader,
  type WorkerEventSource,
} from "@/lib/stream/sse-relay";
import type { SseEvent } from "@/lib/stream/event-taxonomy";
// The per-run bridge JWT primitives now live in a reusable lib (C.009.1 / DR-018)
// so the kernel routes can verify worker calls without importing this Next route
// file. Re-exported below to keep this route's public surface — and PR 007's
// tests, which import mint/verify from here — green.
import {
  mintBridgeToken,
  verifyBridgeToken,
  type BridgeTokenClaims,
  type BridgeTokenRejection,
  type VerifyBridgeTokenResult,
} from "@/lib/auth/bridge-token";

export const runtime = "nodejs";
/** The single-piece generation cap (seconds) — the relay/JWT run-budget ceiling. */
export const maxDuration = 90;

// ── The per-run bridge JWT (acceptance 6) ─────────────────────────────────────
// The mint/verify primitives + their types now live in `@/lib/auth/bridge-token`
// (extracted by C.009.1 / DR-018 so the kernel routes can verify worker calls
// without importing this Next route file). Re-exported here so this route's public
// surface — and PR 007's tests, which import them from here — stay identical.
export {
  mintBridgeToken,
  verifyBridgeToken,
  type BridgeTokenClaims,
  type BridgeTokenRejection,
  type VerifyBridgeTokenResult,
};

// ── Worker dispatch seam (injected; Tier-2 wires the live Sandbox) ────────────

/** What the dispatcher receives: the bound run + its minted credential. */
export interface WorkerDispatch {
  scope: { workspaceId: string; clientId: string; runId: string };
  bridgeJwt: string;
  prompt: string;
}

/**
 * Dispatch a worker and return its event source. The production impl provisions a
 * Sandbox (PR 006 `launchSandbox`) and bridges its stdout/event channel into an
 * async iterable; tests inject a fake source. Kept as a seam so the relay logic is
 * unit-tested with NO live Sandbox (Tier-1) and the live dispatch is a Tier-2 step.
 */
export type WorkerDispatcher = (dispatch: WorkerDispatch) => Promise<WorkerEventSource>;

/**
 * The fail-closed default dispatcher. With no live Sandbox wired in this build it
 * throws loudly rather than silently streaming an empty run (mirrors the
 * NOT_WIRED data-access / session-store discipline). Tier-2 swaps the live impl.
 */
export const NOT_WIRED_DISPATCHER: WorkerDispatcher = () => {
  throw new Error(
    "worker dispatcher is not wired: no live Vercel Sandbox in this build. " +
      "Inject a WorkerDispatcher via RunDeps, or wire launchSandbox() (PR 006) for a live run.",
  );
};

/** The fail-closed default truth reader (acceptance 5 needs a real Supabase read). */
export const NOT_WIRED_TRUTH_READER: TruthSnapshotReader = () => {
  throw new Error(
    "truth-snapshot reader is not wired: reconnect resume needs the persisted " +
      "content_pieces + gate_results rows. Inject a TruthSnapshotReader via RunDeps.",
  );
};

// ── Request body ──────────────────────────────────────────────────────────────

interface RunRequestBody {
  clientId?: unknown;
  prompt?: unknown;
  /** Optional caller estimate of the run's USD cost for the pre-flight reserve. */
  estimatedCostUsd?: unknown;
}

// ── Dependency seam (injection for tests) ─────────────────────────────────────

export interface RunDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  dispatcher: WorkerDispatcher;
  truthReader: TruthSnapshotReader;
  /** A fresh CostAccountant per run (default: the RFC §1 $2.00 cap). */
  makeAccountant: () => CostAccountant;
  /** run-id generator (default randomUUID). */
  newRunId: () => string;
  /** JWT signing secret (default: host env). */
  jwtSecret?: string;
  /** Clock override for deterministic tests. */
  nowMs?: () => number;
}

const DEFAULT_DEPS: RunDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  dispatcher: NOT_WIRED_DISPATCHER,
  truthReader: NOT_WIRED_TRUTH_READER,
  makeAccountant: () => new CostAccountant(),
  newRunId: () => randomUUID(),
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

// ── The handler ───────────────────────────────────────────────────────────────

/**
 * Handle a run request. Exported as `handleRun(request, deps)` so tests drive the
 * full gate sequence (auth -> tenancy -> cost -> mint -> dispatch -> relay) with
 * injected deps and NO live infra.
 */
export async function handleRun(request: Request, deps: RunDeps = DEFAULT_DEPS): Promise<Response> {
  const nowMs = deps.nowMs ?? (() => Date.now());

  // 0. Parse the body.
  let raw: RunRequestBody;
  try {
    raw = (await request.json()) as RunRequestBody;
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const clientId = typeof raw.clientId === "string" ? raw.clientId : "";
  if (!clientId) {
    return json({ error: "clientId is required", code: "bad-request" }, 400);
  }
  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim().length > 0
      ? raw.prompt
      : "Run the seo-blog-writer skill to produce one grounded draft for this run, then persist it via persistPiece. Do not publish.";
  const estimatedCostUsd =
    typeof raw.estimatedCostUsd === "number" && Number.isFinite(raw.estimatedCostUsd)
      ? raw.estimatedCostUsd
      : 0.5; // conservative default reservation for a single-piece run

  // 1. AUTH -> WORKSPACE -> CLIENT (server-side tenancy bind; never request input).
  const bound = await bindRequestContext(clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context; // { workspaceId, clientId } — the SERVER's binding

  // 2. COST PRE-FLIGHT (acceptance 3): reserve BEFORE any dispatch. Over-cap =>
  //    synchronous cost error, NOTHING dispatched (fail-closed).
  const accountant = deps.makeAccountant();
  try {
    accountant.reserve(estimatedCostUsd, "run-preflight");
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      return json(
        {
          error: "run would exceed the per-run cost cap",
          code: "COST_CAP_EXCEEDED",
          capUsd: err.capUsd,
          attemptedUsd: err.attemptedUsd,
        },
        402,
      );
    }
    throw err;
  }

  // 3. PER-RUN JWT (acceptance 6): mint scoped to EXACTLY (workspace, client, run),
  //    expiring at the run-budget ceiling (~90s). The worker's only host credential.
  const runId = deps.newRunId();
  const scope = { workspaceId: ctx.workspaceId, clientId: ctx.clientId, runId };
  let bridgeJwt: string;
  try {
    bridgeJwt = mintBridgeToken(scope, { secret: deps.jwtSecret, nowMs: nowMs() });
  } catch (err) {
    return json(
      { error: "could not mint run credential", code: "RELAY_FAILED", message: (err as Error).message },
      500,
    );
  }

  // 4. DISPATCH + RELAY. A Last-Event-ID reconnect re-reads the persisted truth
  //    snapshot (acceptance 5); a fresh connect streams from the worker.
  const lastEventId = parseLastEventId(request.headers.get("last-event-id"));

  let source: WorkerEventSource;
  try {
    source = await deps.dispatcher({ scope, bridgeJwt, prompt });
  } catch (err) {
    // Dispatch failed before any stream — return a synchronous terminal error so
    // the client never sees a hung stream (acceptance 4).
    return json(
      { error: "worker dispatch failed", code: "WORKER_LOOP_FAILED", message: (err as Error).message },
      503,
    );
  }

  return relayResponse({
    scope,
    source,
    truthReader: deps.truthReader,
    lastEventId,
    stallMs: RUN_BUDGET_CEILING_MS,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRun(request);
}

// Re-export the SseEvent type for dispatcher implementations (live wiring convenience).
export type { SseEvent };
