/**
 * GET /api/conversations/[id] — the chat-first front door's transcript load
 * (Slice 5, lane worker-runtime/studio). PRODUCTION-CRITICAL (tenancy).
 *
 *   GET /api/conversations/[id]?clientId= -> { conversation, turns }
 *
 * THE CANVAS MOUNT READ. When the studio canvas opens a thread it loads the
 * conversation header + its ordered turn log (`seq` ascending) through this route.
 * `[id]` is the CONVERSATION id. It mirrors the kernel-route conventions
 * (PR 005 / PR 013): runtime="nodejs", dynamic, the auth -> bind -> scoped-read
 * shape, JSON `{ error, code }` error envelopes, Next 16 async `params`.
 *
 * FAIL-CLOSED + TENANT-SCOPED. Tenancy is the SERVER's resolution of the operator's
 * workspace (`bindRequestContext` -> the DR-003 auth seam), NEVER request input.
 * The only caller-supplied tenancy field is `clientId` (validated to belong to the
 * bound workspace — 404 on a forged id, 401 unauthenticated). The conversation is
 * then loaded scoped by the BOUND `(id, workspaceId, clientId)`: a conversation that
 * is NOT owned by the bound workspace/client resolves to null -> 404 (no
 * cross-tenant transcript leak, no existence oracle). The turns are read with the
 * SAME bound scope, ordered by `seq` ascending.
 *
 * The handler is exported (`handleGetConversation`) with the same `RouteDeps` seam
 * as the collection route so it is unit-testable with an in-memory
 * `ConversationDataAccess` + a fake workspace resolver (no live Supabase). The thin
 * `GET` wrapper resolves the live seams behind the creds gate (DR-026 pattern).
 *
 * PII rule: log only ids (workspace/client/conversation) + the turn count — never
 * the turn content. Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import {
  bindRequestContext,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import {
  NOT_WIRED_CONVERSATION_ACCESS,
  type ConversationRow,
  type ConversationTurnRow,
} from "@/lib/conversation/context";
import { resolveConversationDataAccess } from "@/lib/conversation/resolve-conversation-access";
import { type RouteDeps } from "../route";

export const runtime = "nodejs";
/** A live, per-operator read — never cached. */
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DEFAULT_DEPS: RouteDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  conversations: NOT_WIRED_CONVERSATION_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

// ── Request schema ────────────────────────────────────────────────────────────

/** The query — `clientId` only (the bound workspace is the SERVER's). */
const QuerySchema = z.object({ clientId: z.string().uuid() });

/** Project a persisted conversation header to the wire shape the canvas consumes. */
function toConversationWire(c: ConversationRow) {
  return {
    id: c.id,
    pieceId: c.pieceId,
    title: c.title,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Project a persisted turn to the wire shape the transcript consumes. */
function toTurnWire(t: ConversationTurnRow) {
  return {
    id: t.id,
    seq: t.seq,
    role: t.role,
    content: t.content,
    runId: t.runId,
    pieceVersion: t.pieceVersion,
    verdict: t.verdict,
    createdAt: t.createdAt,
  };
}

// ── GET: load the conversation + its ordered turns (the transcript) ────────────

/**
 * Load a single conversation header + its turns (ordered by `seq` ascending) scoped
 * by the BOUND `(id, workspaceId, clientId)`. `conversationId` is the `[id]`
 * segment; `clientId` is read from the query (validated owned). A cross-tenant
 * conversation id resolves to null -> 404 (no leak).
 *
 *   - 400 bad-request   — invalid conversation id / missing-invalid `clientId`.
 *   - 401 unauthorized  — no authenticated operator/workspace.
 *   - 404 not-found     — `clientId` not owned, OR the conversation is not owned by
 *                          the bound workspace/client.
 *   - 200               — `{ conversation, turns }`.
 */
export async function handleGetConversation(
  request: Request,
  conversationId: string,
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. The `[id]` segment must be a uuid (a junk id is a bad request, not a 404 —
  //    it can never name a real conversation).
  if (!z.string().uuid().safeParse(conversationId).success) {
    return json({ error: "invalid conversation id", code: "bad-request" }, 400);
  }

  // 2. Read + validate the `clientId` query (the only caller-supplied tenancy).
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({
    clientId: url.searchParams.get("clientId") ?? "",
  });
  if (!query.success) {
    return json({ error: "missing or invalid clientId", code: "bad-request" }, 400);
  }

  // 3. AUTH -> bind tenancy SERVER-side. 401 unauth / 404 foreign-client (no leak).
  const bound = await bindRequestContext(
    query.data.clientId,
    deps.data,
    deps.resolveWorkspace,
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 4. Load the conversation scoped by the BOUND tenancy. A conversation that is not
  //    owned by this workspace/client resolves to null -> 404 (no cross-tenant leak,
  //    no existence oracle).
  const conversation = await deps.conversations.getConversation(
    conversationId,
    ctx.workspaceId,
    ctx.clientId,
  );
  if (!conversation) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 5. Load the turns with the SAME bound scope, ordered by `seq` ascending (the
  //    seam contracts ascending order; we re-sort defensively so the transcript is
  //    stable regardless of the impl).
  const turns = await deps.conversations.listTurns(
    conversationId,
    ctx.workspaceId,
    ctx.clientId,
  );

  console.log(
    `[api/conversations/[id]] load workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} ` +
      `conversationId=${conversationId} turns=${turns.length}`,
  );

  return json(
    {
      conversation: toConversationWire(conversation),
      turns: turns
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map(toTurnWire),
    },
    200,
  );
}

// ── Next 16 dynamic route handler (async params, live seams behind the gate) ───

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
  return {
    data: data as Pick<ContentDataAccess, "clientBelongsToWorkspace">,
    conversations,
    resolveWorkspace: getCurrentWorkspace,
  };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleGetConversation(request, id, await liveDeps());
}
