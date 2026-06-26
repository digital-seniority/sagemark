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
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

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

export const runtime = "nodejs";
/** The single-piece generation cap (seconds) — the relay/JWT run-budget ceiling. */
export const maxDuration = 90;

// ── The per-run bridge JWT (acceptance 6) ─────────────────────────────────────

/**
 * The claims the bridge JWT carries. Scoped to EXACTLY one (workspace, client,
 * run) — the worker cannot widen tenancy because the host re-derives it from
 * these claims, never from a request argument.
 */
export interface BridgeTokenClaims {
  /** workspace_id (tenancy). */
  ws: string;
  /** client_id (tenancy). */
  cl: string;
  /** run_id (the run this token may act for). */
  run: string;
  /** issued-at (epoch seconds). */
  iat: number;
  /** expiry (epoch seconds) — the run-budget ceiling. */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Resolve the HMAC signing secret for the bridge JWT. Reads the host env (NEVER
 * shipped to the worker). Fail-closed: a missing secret throws so we never mint
 * an unsigned/forgeable token.
 */
function bridgeSigningSecret(): string {
  const secret = process.env.SEO_BRIDGE_JWT_SECRET ?? process.env.SEO_RUN_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SEO_BRIDGE_JWT_SECRET is not set on the host — cannot mint the per-run bridge JWT (fail-closed).",
    );
  }
  return secret;
}

/**
 * Mint a compact JWS (HS256) per-run bridge token. Standard `header.payload.sig`
 * serialization signed with HMAC-SHA256 — no external dep needed (acceptance 6).
 * `exp` is set to `now + ceilingMs` (~90s, the single-piece cap).
 */
export function mintBridgeToken(
  scope: { workspaceId: string; clientId: string; runId: string },
  opts: { secret?: string; nowMs?: number; ceilingMs?: number } = {},
): string {
  const secret = opts.secret ?? bridgeSigningSecret();
  const nowMs = opts.nowMs ?? Date.now();
  const ceilingMs = opts.ceilingMs ?? RUN_BUDGET_CEILING_MS;
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ceilingMs) / 1000);

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: BridgeTokenClaims = {
    ws: scope.workspaceId,
    cl: scope.clientId,
    run: scope.runId,
    iat,
    exp,
  };
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

/** The reason a bridge token failed verification (stable, for host-tool 401/403). */
export type BridgeTokenRejection =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-run"
  | "wrong-tenant";

export type VerifyBridgeTokenResult =
  | { ok: true; claims: BridgeTokenClaims }
  | { ok: false; reason: BridgeTokenRejection };

/**
 * Verify a per-run bridge token against an EXPECTED (workspace, client, run)
 * scope. This is what every host tool calls (acceptance 6): a token minted for
 * run A is rejected (`wrong-run`) for run B; a token for tenant A is rejected
 * (`wrong-tenant`) for tenant B; an expired token is rejected (`expired`). The
 * signature is checked in constant time before any claim is trusted.
 */
export function verifyBridgeToken(
  token: string,
  expected: { workspaceId: string; clientId: string; runId: string },
  opts: { secret?: string; nowMs?: number } = {},
): VerifyBridgeTokenResult {
  const secret = opts.secret ?? bridgeSigningSecret();
  const nowMs = opts.nowMs ?? Date.now();

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const header = parts[0]!;
  const payload = parts[1]!;
  const sig = parts[2]!;

  // 1. Verify the signature in constant time BEFORE trusting any claim.
  const expectedSig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  // 2. Decode claims.
  let claims: BridgeTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BridgeTokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };

  // 3. Expiry (acceptance 6 — expires at the run-budget ceiling).
  if (Math.floor(nowMs / 1000) >= claims.exp) return { ok: false, reason: "expired" };

  // 4. Tenancy + run scope (acceptance 6 — cross-run / cross-tenant rejected).
  if (claims.ws !== expected.workspaceId || claims.cl !== expected.clientId) {
    return { ok: false, reason: "wrong-tenant" };
  }
  if (claims.run !== expected.runId) return { ok: false, reason: "wrong-run" };

  return { ok: true, claims };
}

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
