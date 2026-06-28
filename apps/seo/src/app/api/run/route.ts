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
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import {
  NOT_WIRED_CONVERSATION_ACCESS,
  type ConversationDataAccess,
  type ConversationRow,
} from "@/lib/conversation/context";
import { resolveConversationDataAccess } from "@/lib/conversation/resolve-conversation-access";
import {
  NOT_WIRED_PROJECT_ACCESS,
  type ProjectDataAccess,
} from "@/lib/projects/context";
import { resolveProjectDataAccess } from "@/lib/projects/resolve-project-access";
import {
  prepareTurn,
  wrapSourceRecordingAgentTurn,
  makeDefaultTruthReader,
  makeConversationTruthReader,
} from "./turn";
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
// The live Sandbox dispatcher (provisions the per-run microVM, starts the worker,
// relays its `::worker-*::` marker stream as coded SSE). Kept in a sibling helper
// module so this route file stays the gate-sequence orchestrator; `route.ts`
// imports only the factory (value) — the helper imports types back from here, which
// are erased at runtime, so the import cycle has no runtime edge.
import { createLiveDispatcher } from "./live-dispatcher";

export const runtime = "nodejs";
/** Always run at request time — this is a live dispatch + SSE relay, never cached. */
export const dynamic = "force-dynamic";
/** The single-piece generation cap (seconds) — the relay/JWT run-budget ceiling. */
export const maxDuration = 300;

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
  scope: {
    workspaceId: string;
    clientId: string;
    runId: string;
    /** The project this run belongs to (absent for one-shot/single-drafter runs). */
    projectId?: string;
    /** The skill mode to activate in the worker (absent → single-drafter default). */
    workerMode?: string;
  };
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
  /**
   * OPTIONAL chat-turn handle (Slice 5 / P-F). ABSENT → the existing one-shot path
   * (byte-for-byte unchanged). PRESENT → this run is one TURN of a persisted
   * conversation: the host loads the transcript + current draft, records the user
   * turn, composes the per-turn brief (replacing the default), dispatches, and
   * records the agent turn on completion. The id is VALIDATED to be owned by the
   * bound (workspaceId, clientId) — a forged/foreign id 404s (no leak); tenancy is
   * NEVER widened by it.
   */
  conversationId?: unknown;
}

// ── Dependency seam (injection for tests) ─────────────────────────────────────

export interface RunDeps {
  data: ContentDataAccess;
  /** The chat-turn persistence seam (Slice 5 / P-F). Inert (NOT_WIRED) one-shot. */
  conversations: ConversationDataAccess;
  /** The Projects seam (Slice 5b). When a turn's conversation has a project, its
   *  cross-article context is injected into the worker brief. Inert by default. */
  projects: ProjectDataAccess;
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
  /**
   * OPTIONAL test hook: receives the in-flight agent-turn recording promise (the
   * fire-and-forget write the source wrapper kicks off on completion) so a test can
   * await it deterministically. Production leaves it unset — the write never blocks
   * the stream. The promise never rejects (recording errors are swallowed).
   */
  onAgentTurnRecording?: (settled: Promise<void>) => void;
}

/**
 * The STATIC defaults — fail-closed where a live composition needs creds (`data`,
 * `conversations`, `truthReader`). The production entrypoint (`POST`) swaps in the
 * creds-gated LIVE composition via `resolveLiveRunDeps()`; tests inject fakes.
 * Keeping the static default on NOT_WIRED preserves the fail-closed discipline (a
 * direct `handleRun()` with no creds + no injection still fails loudly).
 */
const DEFAULT_DEPS: RunDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  conversations: NOT_WIRED_CONVERSATION_ACCESS,
  projects: NOT_WIRED_PROJECT_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  // The LIVE dispatcher (replaces NOT_WIRED_DISPATCHER). The injection seam is
  // preserved: tests pass a fake `dispatcher` via RunDeps, and NOT_WIRED_DISPATCHER
  // stays exported for the not-wired fail-closed assertion.
  dispatcher: createLiveDispatcher(),
  truthReader: NOT_WIRED_TRUTH_READER,
  makeAccountant: () => new CostAccountant(),
  newRunId: () => randomUUID(),
};

/**
 * Resolve the LIVE run deps for the production POST entrypoint, creds-gated +
 * safe-default. With service-role creds PRESENT:
 *   - `data` ← the live content read+write adapter (`resolveContentDataAccess`);
 *   - `conversations` ← the live conversation adapter (`resolveConversationDataAccess`);
 *   - `truthReader` ← a real reader built from the live read adapter
 *     (`makeDefaultTruthReader`) for the one-shot reconnect path. (The turn-aware
 *     path overrides this with a conversation-scoped reader in `handleRun`.)
 * With creds ABSENT every factory returns its NOT_WIRED fail-closed default, so the
 * route behaves EXACTLY as before (inert) — a merge changes nothing live.
 */
async function resolveLiveRunDeps(): Promise<RunDeps> {
  const data = await resolveContentDataAccess();
  const conversations = await resolveConversationDataAccess();
  const projects = await resolveProjectDataAccess();
  // The default reader is built from the live read adapter, but stays fail-soft for
  // the one-shot path (no run->piece link). When creds are absent, `data` is the
  // NOT_WIRED stub; building the reader does NOT touch it (it only closes over the
  // read methods), so this is safe + inert.
  const truthReader: TruthSnapshotReader =
    data === NOT_WIRED_DATA_ACCESS ? NOT_WIRED_TRUTH_READER : makeDefaultTruthReader();
  return { ...DEFAULT_DEPS, data, conversations, projects, truthReader };
}

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
  // OPTIONAL chat-turn handle. A non-string / empty value leaves the run on the
  // one-shot path (back-compat); a non-empty string opts into the turn flow below.
  const conversationId =
    typeof raw.conversationId === "string" && raw.conversationId.trim().length > 0
      ? raw.conversationId
      : null;

  // 1. AUTH -> WORKSPACE -> CLIENT (server-side tenancy bind; never request input).
  const bound = await bindRequestContext(clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context; // { workspaceId, clientId } — the SERVER's binding

  // 1.5 TURN PRE-AMBLE (only when conversationId present) — AFTER the tenancy bind,
  //     BEFORE cost/mint/dispatch. Load the OWNED conversation (404 if not owned by
  //     the bound (workspaceId, clientId)), list the transcript + current draft,
  //     record the USER turn synchronously, and compose the per-turn worker brief
  //     (which REPLACES the default one-shot brief for this dispatch). The agent
  //     turn is recorded later, on stream completion, via the source wrapper.
  let dispatchPrompt = prompt;
  let turnTruthReader: TruthSnapshotReader | null = null;
  // The pre-turn conversation row the agent-turn recorder closes over (its `pieceId`
  // distinguishes a first draft from a revision). Null on the one-shot path.
  let turnConversation: ConversationRow | null = null;
  // Hub run-mode fields resolved from the conversation's project (absent on the one-shot path).
  let dispatchProjectId: string | undefined;
  let dispatchWorkerMode: string | undefined;
  if (conversationId) {
    const turn = await prepareTurn({
      conversationId,
      newMessage: prompt,
      bound: ctx,
      conversations: deps.conversations,
      data: deps.data,
      projects: deps.projects,
    });
    if (!turn.ok) {
      return json({ error: turn.code, code: turn.code }, turn.status);
    }
    dispatchPrompt = turn.prompt;
    turnConversation = turn.conversation;
    // A turn-aware reconnect resolves the conversation's CURRENT piece (real read).
    turnTruthReader = makeConversationTruthReader({
      conversationId,
      bound: ctx,
      conversations: deps.conversations,
      data: deps.data,
    });
    // Resolve hub run-mode from the conversation's project (if one is linked).
    // NOT_WIRED_PROJECT_ACCESS throws — catch and fall through to single-drafter.
    if (turnConversation.projectId) {
      dispatchProjectId = turnConversation.projectId;
      try {
        const project = await deps.projects.getProject(
          turnConversation.projectId,
          ctx.workspaceId,
          ctx.clientId,
        );
        if (project) {
          dispatchWorkerMode =
            project.strategyStatus === "approved" ? "standalone-author" : "standalone-strategy";
        }
      } catch {
        // NOT_WIRED or project not found — fall through to single-drafter (back-compat).
      }
    }
    // Hub run-modes: the default composeTurnPrompt brief says "run seo-blog-writer /
    // use persistPiece" which directly conflicts with the strategy/author system prompt.
    // Replace dispatchPrompt with a mode-aligned instruction so the model calls the
    // correct tool (persistStrategy for Run 1, persistPiece for Runs 2+).
    if (dispatchWorkerMode === "standalone-strategy") {
      let strategyPrompt =
        `The operator requests: ${prompt}\n\n` +
        `Follow your system prompt instructions to produce a complete ContentStrategy ` +
        `for this client. When all sections are filled (objective/audience/market, ` +
        `topic-cluster map, competitive-gap analysis, E-E-A-T/authorship plan, ` +
        `GEO/AEO + schema plan, conversion architecture, prioritized content roadmap), ` +
        `call the \`persistStrategy\` tool ONCE with the full strategy as a JSON object. ` +
        `Do not write article drafts. Do not use persistPiece.`;
      if (turn.projectContextNote) {
        strategyPrompt += `\n\n=== CLIENT & PROJECT CONTEXT (data) ===\n${turn.projectContextNote}\n=== END CONTEXT ===`;
      }
      dispatchPrompt = strategyPrompt;
    } else if (dispatchWorkerMode === "standalone-author") {
      // composeTurnPrompt generates a REVISION brief when the conversation is linked
      // to an existing piece (e.g. the pillar after the first authoring run). That
      // brief tells the model to REVISE the linked piece — wrong for hub authoring
      // where each run must write the NEXT PENDING page. Override with an explicit
      // "write next pending page" brief so the model drafts the correct article.
      //
      // We query listProjectPieces (one extra read) to identify the first roadmap
      // page whose slug is not yet authored, then generate a page-specific prompt.
      let nextPage: {
        slug: string;
        title: string;
        clusterRole: string;
        funnelStage?: string | null;
        primaryKeyword?: string | null;
      } | null = null;
      try {
        if (dispatchProjectId) {
          const [proj, existingPieces] = await Promise.all([
            deps.projects.getProject(dispatchProjectId, ctx.workspaceId, ctx.clientId),
            deps.projects.listProjectPieces(dispatchProjectId, ctx.workspaceId, ctx.clientId),
          ]);
          if (proj?.strategy && proj.strategyStatus === "approved") {
            const rawStrategy = proj.strategy as Record<string, unknown>;
            const rawRoadmap = (
              Array.isArray(rawStrategy.roadmap)
                ? rawStrategy.roadmap
                : Array.isArray(rawStrategy.prioritized_roadmap)
                  ? rawStrategy.prioritized_roadmap
                  : []
            ) as Record<string, unknown>[];
            const authoredSlugs = new Set(existingPieces.map((p) => p.slug));
            for (const item of rawRoadmap) {
              const title = typeof item.title === "string" ? item.title : null;
              if (!title) continue;
              const slug =
                typeof item.slug === "string"
                  ? item.slug
                  : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
              if (!authoredSlugs.has(slug)) {
                nextPage = {
                  slug,
                  title,
                  clusterRole:
                    typeof item.clusterRole === "string"
                      ? item.clusterRole
                      : typeof item.cluster_role === "string"
                        ? item.cluster_role
                        : "spoke",
                  funnelStage:
                    typeof item.funnelStage === "string"
                      ? item.funnelStage
                      : typeof item.funnel_stage === "string"
                        ? item.funnel_stage
                        : null,
                  primaryKeyword:
                    typeof item.primaryKeyword === "string"
                      ? item.primaryKeyword
                      : typeof item.target_keyword === "string"
                        ? item.target_keyword
                        : null,
                };
                break;
              }
            }
          }
        }
      } catch {
        // DB error or missing project — fall through to the generic brief below.
      }

      let authorPrompt: string;
      if (nextPage) {
        // DISPATCH PROMPT: must be assertive enough to override the seo-blog-writer
        // SKILL.md's "kernel draft route" mental model. That SKILL.md describes Step 6
        // as "the route persists automatically" — causing the model to generate the
        // article as text output rather than calling persistPiece. This prompt
        // explicitly states that the auto-persist route is NOT active and that
        // persistPiece is the ONLY delivery mechanism.
        authorPrompt =
          `IMPORTANT — KERNEL MODE OVERRIDE:\n` +
          `The seo-blog-writer "draft route" auto-persist (SKILL.md Step 6) is NOT ` +
          `active in this context. There is no route that captures your text output. ` +
          `Text responses are DISCARDED. The article is saved ONLY when you call the ` +
          `persistPiece tool with the body parameter containing the full Markdown article.\n\n` +
          `REQUIRED TOOL CALL SEQUENCE:\n` +
          `1. [Optional] Call requestImages once: query="<descriptive image search>", ` +
          `slug="${nextPage.slug}"\n` +
          `2. [Required] Call persistPiece ONCE with:\n` +
          `   - title: "${nextPage.title}"\n` +
          `   - slug: "${nextPage.slug}"\n` +
          `   - body: <the complete 1500-2500 word Markdown article — written as the ` +
          `VALUE of this parameter, NOT as text output>\n` +
          `   - excerpt: 1-2 sentence summary\n` +
          `   - metaDescription: 150-160 character search snippet\n` +
          `   - clusterRole: "${nextPage.clusterRole}"\n` +
          (nextPage.funnelStage ? `   - funnelStage: "${nextPage.funnelStage}"\n` : "") +
          `   - projectId: "${dispatchProjectId}"\n` +
          `   - faqData: array of {question, answer} objects from the FAQ block\n\n` +
          `ARTICLE REQUIREMENTS:\n` +
          `- Open with a self-contained quick-answer paragraph (2-3 sentences; direct ` +
          `answer to the article's core question — AI answer engines will lift this)\n` +
          `- Every statistic cites a named, authoritative source (no fabrication)\n` +
          `- YMYL-safe framing throughout; short disclaimer near the end\n` +
          `- FAQ block at the end: 5-7 Q&A pairs with self-contained answers\n` +
          `- Include one [photo:${nextPage.slug}] placeholder where an image fits\n\n` +
          (nextPage.primaryKeyword ? `TARGET KEYWORD: ${nextPage.primaryKeyword}\n\n` : "") +
          `This is a NEW article. Do NOT revise any existing draft.`;
      } else {
        // Fallback: no pending page found (all authored, or DB error). Give the model
        // a generic instruction so it can at least try via the project context.
        authorPrompt =
          `IMPORTANT — KERNEL MODE OVERRIDE:\n` +
          `Text responses are DISCARDED. The article is saved ONLY when you call the ` +
          `persistPiece tool with the body parameter containing the full Markdown article.\n\n` +
          `Look at the "Full hub roadmap" in the project context below. ` +
          `Find the FIRST roadmap page not in "Articles already authored" and write it ` +
          `as a complete, grounded SEO article. ` +
          `Call persistPiece ONCE with the exact slug, clusterRole, funnelStage, ` +
          `and projectId '${dispatchProjectId ?? ""}'. ` +
          `Do NOT revise any existing draft.`;
      }
      if (turn.projectContextNote) {
        authorPrompt +=
          `\n\n=== PROJECT CONTEXT (data) ===\n${turn.projectContextNote}\n=== END PROJECT CONTEXT ===`;
      }
      dispatchPrompt = authorPrompt;
    }
  }

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
  const scope: WorkerDispatch["scope"] = {
    workspaceId: ctx.workspaceId,
    clientId: ctx.clientId,
    runId,
    ...(dispatchProjectId ? { projectId: dispatchProjectId } : {}),
    ...(dispatchWorkerMode ? { workerMode: dispatchWorkerMode } : {}),
  };
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
    // The dispatch prompt is the COMPOSED per-turn brief on the turn path, else the
    // default one-shot brief — back-compat: with no conversationId, `dispatchPrompt`
    // === `prompt` (the original brief), byte-for-byte unchanged.
    source = await deps.dispatcher({ scope, bridgeJwt, prompt: dispatchPrompt });
  } catch (err) {
    // Dispatch failed before any stream — return a synchronous terminal error so
    // the client never sees a hung stream (acceptance 4).
    return json(
      { error: "worker dispatch failed", code: "WORKER_LOOP_FAILED", message: (err as Error).message },
      503,
    );
  }

  // On the turn path, WRAP the worker source so the AGENT turn is recorded when the
  // run completes (terminal `done` / clean close). The relay drains the wrapped
  // iterable; the recorder is idempotent + its failures never surface to the stream.
  // On the one-shot path the source is forwarded verbatim (no wrap, no behavior
  // change).
  const relaySource: WorkerEventSource =
    conversationId && turnConversation
      ? wrapSourceRecordingAgentTurn(source, {
          conversationId,
          runId,
          bound: ctx,
          conversation: turnConversation,
          conversations: deps.conversations,
          data: deps.data,
          onRecording: deps.onAgentTurnRecording,
        })
      : source;

  return relayResponse({
    scope,
    source: relaySource,
    // The turn-aware reconnect reads the conversation's persisted piece; the one-shot
    // path keeps the injected (default) reader unchanged.
    truthReader: turnTruthReader ?? deps.truthReader,
    lastEventId,
    stallMs: RUN_BUDGET_CEILING_MS,
  });
}

export async function POST(request: Request): Promise<Response> {
  // Production entrypoint: resolve the creds-gated LIVE deps (data + conversations +
  // truth reader), then run the gate sequence. With no creds every dep stays on its
  // fail-closed NOT_WIRED default (inert) — back-compat.
  return handleRun(request, await resolveLiveRunDeps());
}

// Re-export the SseEvent type for dispatcher implementations (live wiring convenience).
export type { SseEvent };
