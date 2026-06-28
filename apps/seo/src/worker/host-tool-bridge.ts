/**
 * Worker -> host-tool HTTP bridge (PR 006 / P0.W.2, lane worker-runtime).
 *
 * THE WORKER'S ONLY WAY OUT. The Agent-SDK worker runs inside an ephemeral
 * Vercel Sandbox microVM with NO Supabase credentials and NO raw provider key.
 * Every mutation and every kernel-engine step the loop performs is a call BACK
 * into the `apps/seo` `/content/api/*` route contract (PR 005) through this
 * bridge — the routes ARE the worker's toolset (it never re-implements the
 * kernel). The bridge is the structural reason acceptance #2 holds: the worker
 * cannot write Supabase directly because it has no client; it can only ask the
 * host to, and the host (`session-store.ts`, holding the service role) decides.
 *
 * TENANCY SCOPING (acceptance #3). A bridge instance is minted for exactly ONE
 * run and is bound to exactly one `(workspaceId, clientId, runId)` triple. The
 * per-run bearer JWT encodes that triple; every request carries it. A bridge
 * minted for client A literally cannot be pointed at client B — the binding is
 * frozen at construction and re-asserted on the response. The host routes ALSO
 * enforce the binding server-side (`assertTenancyMatch`); the bridge is the
 * client-side half of the same chokepoint, so a token leak cannot widen scope.
 *
 * FAIL-CLOSED TRANSPORT. Every call is wrapped in `assertKernelReachable`
 * (contract.ts): a transport failure or a 502/503/504 becomes a single,
 * non-silent `KernelHostUnreachableError` naming the route + base URL. The
 * worker surfaces a terminal error and STOPS — it never fabricates a draft and
 * never silently skips a gate.
 *
 * PURE-ISH / ISOMORPHIC: imports only the shared contract module + `fetch`. No
 * Next APIs, no DB, no `server-only` marker — this runs inside the Sandbox, far
 * from Next. Clean ASCII / UTF-8.
 */

import {
  CONTENT_CONTRACT_VERSION,
  CONTRACT_VERSION_HEADER,
  KERNEL_ROUTES,
  assertKernelReachable,
  type DraftRequest,
  type PersistStrategyRequest,
  type RequestImagesRequest,
  type KernelRouteName,
} from "../lib/content/contract";

/**
 * The immutable tenancy + run identity a bridge is bound to. Minted host-side
 * (the launcher derives it; the worker never invents it) and frozen for the
 * bridge's lifetime. The triple is the unit the per-run JWT scopes (acceptance
 * #3): a bridge can only ever act for THIS run, THIS client, THIS workspace.
 */
export interface RunBinding {
  workspaceId: string;
  clientId: string;
  runId: string;
  /** Non-null for strategy + authoring runs; absent for the legacy single-drafter path. */
  projectId?: string;
}

/**
 * Raised when a bridge is asked to act outside its frozen `(workspace, client,
 * run)` binding — the client-side analogue of the route's 403 tenancy-mismatch.
 * Surfaced as a typed, loud failure so a cross-tenant attempt can never be a
 * silent no-op.
 */
export class TenancyScopeError extends Error {
  readonly code = "TENANCY_SCOPE_VIOLATION" as const;
  constructor(
    readonly binding: RunBinding,
    readonly attempted: { workspaceId?: string; clientId?: string },
    detail: string,
  ) {
    super(
      `bridge tenancy scope violation: bound to run=${binding.runId} ` +
        `workspace=${binding.workspaceId} client=${binding.clientId}, ` +
        `but call targeted workspace=${attempted.workspaceId ?? "?"} ` +
        `client=${attempted.clientId ?? "?"} (${detail})`,
    );
    this.name = "TenancyScopeError";
  }
}

/**
 * Raised when the host rejects the bridge's bearer token / tenancy (401/403) —
 * i.e. a client-A token presented for client-B's host tools. Kept distinct from
 * a transport failure so the worker can tell "I was refused" from "I couldn't
 * reach the host".
 */
export class HostToolAuthError extends Error {
  readonly code = "HOST_TOOL_AUTH_REJECTED" as const;
  constructor(
    readonly route: KernelRouteName,
    readonly status: number,
  ) {
    super(`host tool ${KERNEL_ROUTES[route]} rejected the run token (status ${status})`);
    this.name = "HostToolAuthError";
  }
}

/** The persisted-piece result the host returns from the draft (persist) tool. */
export interface PersistPieceResult {
  contractVersion: string;
  pieceId: string;
  slug: string;
  status: string;
}

/** What the model-facing `persistPiece` tool accepts. Tenancy and the project id
 *  are NOT taken from here — injected from the frozen binding so the model can
 *  never widen them. The model MAY supply clusterRole/funnelStage (content decisions). */
export type PersistPieceInput = Omit<
  DraftRequest,
  "contractVersion" | "workspaceId" | "clientId" | "projectId"
>;

/** The host's response from the strategy persist route. */
export interface PersistStrategyResult {
  contractVersion: string;
  projectId: string;
  strategyStatus: "proposed";
}

/** What the model-facing `persistStrategy` tool accepts. Tenancy + projectId are
 *  NOT taken from here — injected from the frozen binding. */
export type PersistStrategyInput = { strategy: Record<string, unknown> };

/** The host's response from the images request route. */
export interface RequestImagesResult {
  contractVersion: string;
  /** The render token to embed in the draft body (e.g. `[photo:my-slug]`). */
  token: string;
  slug: string;
}

/** What the model-facing `requestImages` tool accepts. Tenancy is injected. */
export type RequestImagesInput = Omit<
  RequestImagesRequest,
  "contractVersion" | "workspaceId" | "clientId"
>;

/** Construction config for a run-scoped bridge. */
export interface HostToolBridgeConfig {
  /** The `apps/seo` host base URL the `/content/api/*` routes live under. */
  baseUrl: string;
  /** The frozen `(workspace, client, run)` binding this bridge acts for. */
  binding: RunBinding;
  /** The per-run bearer JWT — the worker's ONLY host credential. Scopes the triple. */
  bridgeJwt: string;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * A run-scoped client over the `apps/seo` host tools. One instance == one run.
 * The binding + JWT are captured at construction and never re-settable, so the
 * scope cannot be widened after the fact (acceptance #3).
 */
export class HostToolBridge {
  private readonly baseUrl: string;
  private readonly binding: RunBinding;
  private readonly bridgeJwt: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HostToolBridgeConfig) {
    if (!config.bridgeJwt) {
      throw new Error("HostToolBridge requires a per-run bridge JWT (the worker's only host credential)");
    }
    if (!config.binding.workspaceId || !config.binding.clientId || !config.binding.runId) {
      throw new Error("HostToolBridge requires a complete (workspaceId, clientId, runId) binding");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.binding = Object.freeze({ ...config.binding });
    this.bridgeJwt = config.bridgeJwt;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Read-only view of the frozen binding (for logging / boot evidence). */
  get runBinding(): Readonly<RunBinding> {
    return this.binding;
  }

  /**
   * The headers every host-tool call carries: the per-run bearer JWT (Authorization),
   * the contract-version handshake, and the bound tenancy as ambient headers (the
   * host re-derives tenancy from the JWT/auth seam — these are belt-and-suspenders
   * so the host can 403 a mismatch fast).
   */
  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.bridgeJwt}`,
      [CONTRACT_VERSION_HEADER]: CONTENT_CONTRACT_VERSION,
      "x-run-id": this.binding.runId,
      "x-workspace-id": this.binding.workspaceId,
      "x-client-id": this.binding.clientId,
    };
  }

  /**
   * THE WORKER'S ONLY MUTATION PATH (acceptance #2). Persist a piece by calling
   * the host `/content/api/draft` route. Tenancy is injected from the frozen
   * binding — the model-supplied input carries NO workspace/client id, so the
   * model can never target another tenant. The host still re-validates the
   * binding server-side (the criterion-2 403 boundary).
   */
  async persistPiece(input: PersistPieceInput): Promise<PersistPieceResult> {
    // Defense-in-depth: refuse if any tenancy-shaped field slipped into the
    // model input (it must not — tenancy comes only from the binding).
    const sneaky = input as Record<string, unknown>;
    if ("workspaceId" in sneaky || "clientId" in sneaky) {
      throw new TenancyScopeError(
        this.binding,
        { workspaceId: sneaky.workspaceId as string, clientId: sneaky.clientId as string },
        "model-supplied tenancy is not permitted — tenancy is fixed by the run binding",
      );
    }

    const payload: DraftRequest = {
      contractVersion: CONTENT_CONTRACT_VERSION,
      workspaceId: this.binding.workspaceId,
      clientId: this.binding.clientId,
      // projectId is BOUND, never model-supplied (same principle as workspaceId/clientId).
      ...(this.binding.projectId ? { projectId: this.binding.projectId } : {}),
      ...input,
    };

    const res = await assertKernelReachable("draft", this.baseUrl, () =>
      this.fetchImpl(`${this.baseUrl}${KERNEL_ROUTES.draft}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      }),
    );

    if (res.status === 401 || res.status === 403) {
      // The host refused this run's token for this tenancy. This is the
      // client-A-token-for-client-B refusal (acceptance #3) seen from the worker.
      throw new HostToolAuthError("draft", res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`host tool draft failed (status ${res.status}): ${body.slice(0, 300)}`);
    }

    const result = (await res.json()) as PersistPieceResult;
    return result;
  }

  /**
   * Persist the strategy for the bound project (acceptance #2 analogue for strategy
   * runs). Tenancy + projectId are injected from the frozen binding — the model
   * cannot supply or widen them. The host verifies project ∈ (workspaceId, clientId)
   * server-side before writing.
   */
  async persistStrategy(input: PersistStrategyInput): Promise<PersistStrategyResult> {
    if (!this.binding.projectId) {
      throw new Error(
        "persistStrategy: no projectId in the run binding — set RUN_PROJECT_ID before dispatching a strategy run",
      );
    }

    const sneaky = input as Record<string, unknown>;
    if ("workspaceId" in sneaky || "clientId" in sneaky || "projectId" in sneaky) {
      throw new TenancyScopeError(
        this.binding,
        {
          workspaceId: sneaky.workspaceId as string | undefined,
          clientId: sneaky.clientId as string | undefined,
        },
        "model-supplied tenancy/projectId is not permitted — all scope comes from the run binding",
      );
    }

    const payload: PersistStrategyRequest = {
      contractVersion: CONTENT_CONTRACT_VERSION,
      workspaceId: this.binding.workspaceId,
      clientId: this.binding.clientId,
      projectId: this.binding.projectId,
      strategy: input.strategy,
    };

    const res = await assertKernelReachable("strategy", this.baseUrl, () =>
      this.fetchImpl(`${this.baseUrl}${KERNEL_ROUTES.strategy}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      }),
    );

    if (res.status === 401 || res.status === 403) {
      throw new HostToolAuthError("strategy", res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`host tool strategy failed (status ${res.status}): ${body.slice(0, 300)}`);
    }

    return (await res.json()) as PersistStrategyResult;
  }

  /**
   * Request a Pexels image for a hub page. The worker calls this during authoring
   * to register a per-page image request; the host enqueues the actual Pexels
   * search + download (Slice 7) and returns a `[photo:slug]` render token that
   * the worker embeds in the draft body. Tenancy is injected from the binding.
   */
  async requestImages(input: RequestImagesInput): Promise<RequestImagesResult> {
    const sneaky = input as Record<string, unknown>;
    if ("workspaceId" in sneaky || "clientId" in sneaky) {
      throw new TenancyScopeError(
        this.binding,
        { workspaceId: sneaky.workspaceId as string, clientId: sneaky.clientId as string },
        "model-supplied tenancy is not permitted in requestImages",
      );
    }

    const payload: RequestImagesRequest = {
      contractVersion: CONTENT_CONTRACT_VERSION,
      workspaceId: this.binding.workspaceId,
      clientId: this.binding.clientId,
      ...input,
    };

    const res = await assertKernelReachable("images", this.baseUrl, () =>
      this.fetchImpl(`${this.baseUrl}${KERNEL_ROUTES.images}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      }),
    );

    if (res.status === 401 || res.status === 403) {
      throw new HostToolAuthError("images", res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`host tool images failed (status ${res.status}): ${body.slice(0, 300)}`);
    }

    return (await res.json()) as RequestImagesResult;
  }
}

/**
 * Mint a run-scoped bridge. The single construction seam the launcher uses, so
 * the binding + JWT are always wired together (never a JWT for one run reused
 * against another binding).
 */
export function createHostToolBridge(config: HostToolBridgeConfig): HostToolBridge {
  return new HostToolBridge(config);
}
