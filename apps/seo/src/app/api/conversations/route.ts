/**
 * /api/conversations — the chat-first front door's conversation collection
 * (Slice 5, lane worker-runtime/studio). PRODUCTION-CRITICAL (tenancy).
 *
 *   POST /api/conversations          { clientId, title? } -> { conversationId }
 *   GET  /api/conversations?clientId= -> { conversations: [...] }
 *
 * THE HOME-LIST + NEW-THREAD FRONT DOOR. The studio UI opens a new chat thread
 * (POST) and lists an operator's threads for a client (GET) through this route. It
 * mirrors the kernel-route conventions (PR 005 / PR 013): runtime="nodejs",
 * dynamic, the auth -> bind -> scoped-read shape, JSON `{ error, code }` error
 * envelopes.
 *
 * FAIL-CLOSED + TENANT-SCOPED. Tenancy is the SERVER's resolution of the operator's
 * workspace (`bindRequestContext` -> the DR-003 auth seam), NEVER request input.
 * The ONLY caller-supplied tenancy field is `clientId`, which is VALIDATED to belong
 * to the bound workspace (the layer-3 bridge): a forged/foreign client id resolves
 * to NOT_OWNED and the route returns 404 (no existence leak) — and 401 when there is
 * no authenticated operator at all. Every conversation read/write is then scoped by
 * the BOUND `(workspaceId, clientId)` pair via the `ConversationDataAccess` seam.
 *
 * The handlers are exported (`handleCreateConversation`/`handleListConversations`)
 * with a `RouteDeps` seam so the route is unit-testable with an in-memory
 * `ConversationDataAccess` + a fake workspace resolver (no live Supabase). The thin
 * `POST`/`GET` wrappers resolve the live seams behind the creds gate (DR-026
 * pattern: NOT_WIRED defaults when no creds are set).
 *
 * PII rule: log only ids (workspace/client/conversation) — never the title body.
 * Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
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

export const runtime = "nodejs";
/** A live, per-operator read/write — never cached. */
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// ── Dependency seam (injection for tests) ─────────────────────────────────────

/**
 * The injectable deps the conversation collection handlers consume. `data` is the
 * content seam (its `clientBelongsToWorkspace` is the only method used — the
 * layer-3 clientId-belongs-to-workspace validation); `conversations` is the
 * conversation seam the create/list run against. `resolveWorkspace` is the
 * SERVER-side tenancy source (the DR-003 auth seam). Tests inject an in-memory
 * `ConversationDataAccess` + a fake workspace resolver — no live infra.
 */
export interface RouteDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  conversations: ConversationDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
}

const DEFAULT_DEPS: RouteDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  conversations: NOT_WIRED_CONVERSATION_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

// ── Request schemas ───────────────────────────────────────────────────────────

/**
 * The POST body. `clientId` is the ONLY caller-supplied tenancy field (validated to
 * belong to the bound workspace). `title` is optional, trimmed, length-capped —
 * never tenancy. NO workspaceId is accepted: it comes from the SERVER's binding.
 */
const CreateBodySchema = z
  .object({
    clientId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    /** Optional project to open the thread inside (Slice 5b). Reads are tenancy-scoped. */
    projectId: z.string().uuid().optional(),
  })
  .strict();

/** The GET query — `clientId` only (the bound workspace is the SERVER's). */
const ListQuerySchema = z.object({ clientId: z.string().uuid() });

/** Project a persisted conversation to the wire shape the home list consumes. */
function toWire(c: ConversationRow) {
  return {
    id: c.id,
    pieceId: c.pieceId,
    title: c.title,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ── POST: create a conversation (scoped to the bound workspace/client) ─────────

/**
 * Create a new conversation for the BOUND `(workspaceId, clientId)`. Tenancy is the
 * SERVER's binding; the body supplies ONLY `clientId` (validated owned) + an
 * optional `title`. Returns `{ conversationId }`.
 *
 *   - 400 bad-request   — invalid JSON / body shape.
 *   - 401 unauthorized  — no authenticated operator/workspace.
 *   - 404 not-found     — `clientId` is not owned by the operator's workspace.
 *   - 201               — created; `{ conversationId }`.
 */
export async function handleCreateConversation(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate the body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  // 2. AUTH -> bind tenancy SERVER-side. 401 unauth / 404 foreign-client (no leak).
  //    `clientId` is validated to belong to the operator's workspace HERE.
  const bound = await bindRequestContext(body.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context; // { workspaceId, clientId } — the SERVER's binding

  // 3. Create — scoped by the BOUND tenancy, never request input (only `title` is
  //    carried from the body, and it is not tenancy).
  const conversationId = await deps.conversations.createConversation({
    workspaceId: ctx.workspaceId,
    clientId: ctx.clientId,
    title: body.title,
    projectId: body.projectId ?? null,
  });

  console.log(
    `[api/conversations] create workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} ` +
      `conversationId=${conversationId}`,
  );

  return json({ conversationId }, 201);
}

// ── GET: list the operator's conversations for a client (the home list) ────────

/**
 * List the conversations for the BOUND `(workspaceId, clientId)` — the home list,
 * most-recently-updated first (the seam's order). `clientId` is read from the query
 * and validated owned; the read is scoped by the BOUND pair.
 *
 *   - 400 bad-request   — missing/invalid `clientId` query param.
 *   - 401 unauthorized  — no authenticated operator/workspace.
 *   - 404 not-found     — `clientId` is not owned by the operator's workspace.
 *   - 200               — `{ conversations: [...] }`.
 */
export async function handleListConversations(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Read + validate the `clientId` query (the only caller-supplied tenancy).
  const url = new URL(request.url);
  const query = ListQuerySchema.safeParse({
    clientId: url.searchParams.get("clientId") ?? "",
  });
  if (!query.success) {
    return json({ error: "missing or invalid clientId", code: "bad-request" }, 400);
  }

  // 2. AUTH -> bind tenancy SERVER-side. 401 unauth / 404 foreign-client (no leak).
  const bound = await bindRequestContext(
    query.data.clientId,
    deps.data,
    deps.resolveWorkspace,
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. List — scoped by the BOUND tenancy. A foreign tenancy never reaches here
  //    (the bind 404s first); the seam is additionally tenancy-filtered.
  const rows = await deps.conversations.listConversations(ctx.workspaceId, ctx.clientId);

  return json({ conversations: rows.map(toWire) }, 200);
}

// ── Next 16 route handlers (live-resolve the seams behind the creds gate) ──────

/**
 * Resolve the live seams behind the service-role creds gate (DR-026 pattern). With
 * no creds set both return their NOT_WIRED defaults — `bindRequestContext` 401s (no
 * workspace) before any conversation method is reached, so the route fails closed.
 */
async function liveDeps(): Promise<RouteDeps> {
  const [data, conversations] = await Promise.all([
    resolveContentDataAccess(),
    resolveConversationDataAccess(),
  ]);
  return { data, conversations, resolveWorkspace: getCurrentWorkspace };
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateConversation(request, await liveDeps());
}

export async function GET(request: Request): Promise<Response> {
  return handleListConversations(request, await liveDeps());
}
