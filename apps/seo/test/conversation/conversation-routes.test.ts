/**
 * /api/conversations + /api/conversations/[id] — the chat-first front door's
 * conversation CRUD routes (Slice 5, lane worker-runtime/studio). Proves, with NO
 * DB and NO provider key (injected seams: an in-memory ConversationDataAccess + a
 * fake operator/workspace + a fake clientBelongsToWorkspace), the tenancy contract:
 *
 *   - POST create   — scoped to the BOUND (workspaceId, clientId); the body's
 *     `clientId` is validated to belong to the bound workspace; `title` is carried
 *     but tenancy is NEVER request input. Returns { conversationId }.
 *   - GET list      — `?clientId=` scoped: only the bound workspace/client's
 *     conversations come back (a second workspace's threads are invisible).
 *   - GET [id]      — loads the conversation header + turns ordered by `seq`; a
 *     cross-tenant conversation id resolves to null -> 404 (no transcript leak, no
 *     existence oracle).
 *   - UNAUTH        — no operator/workspace -> 401 on every route, nothing read/written.
 *   - CROSS-TENANT  — a forged/foreign clientId -> 404 (the bind never widens tenancy).
 *
 * The in-memory store keys every row by (workspaceId, clientId) so a cross-tenant
 * read structurally resolves to null/empty — the same fail-closed boundary the live
 * service-role adapter enforces with its WHERE clauses.
 */

import { describe, it, expect } from "vitest";

import {
  handleCreateConversation,
  handleListConversations,
  type RouteDeps,
} from "@/app/api/conversations/route";
import { handleGetConversation } from "@/app/api/conversations/[id]/route";
import type {
  ConversationDataAccess,
  ConversationRow,
  ConversationTurnRow,
  CreateConversationInput,
} from "@/lib/conversation/context";
import type { Workspace } from "@/lib/auth";
import {
  workspace,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
} from "../content/fixtures";

// A conversation id owned by (WORKSPACE_A, CLIENT_A) in the seed store.
const CONV_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
// A conversation id owned by a DIFFERENT tenant (WORKSPACE_B, CLIENT_B).
const CONV_B = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
// A syntactically-valid uuid that names no conversation at all.
const CONV_MISSING = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

// ── In-memory ConversationDataAccess (tenancy-keyed; no live infra) ────────────

interface SeededTurn {
  conversationId: string;
  workspaceId: string;
  clientId: string;
  seq: number;
}

function makeConversations(): ConversationDataAccess & {
  created: CreateConversationInput[];
} {
  const created: CreateConversationInput[] = [];
  let nextId = 100;

  // Seed: CONV_A under (WORKSPACE_A, CLIENT_A) with two ordered turns (inserted out
  // of seq order to prove the route sorts ascending); CONV_B under (WORKSPACE_B,
  // CLIENT_B) — the cross-tenant decoy.
  const rows: ConversationRow[] = [
    {
      id: CONV_A,
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      pieceId: null,
      title: "Thread A",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: CONV_B,
      workspaceId: WORKSPACE_B,
      clientId: CLIENT_B,
      pieceId: null,
      title: "Thread B (other tenant)",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
    },
  ];

  const turns: Array<SeededTurn & ConversationTurnRow> = [
    {
      id: "turn-2",
      conversationId: CONV_A,
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      seq: 2,
      role: "agent",
      content: "agent reply",
      runId: "run-1",
      pieceVersion: 1,
      verdict: "REVIEW",
      createdAt: "2026-01-01T00:00:02.000Z",
    },
    {
      id: "turn-1",
      conversationId: CONV_A,
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      seq: 1,
      role: "user",
      content: "user prompt",
      runId: null,
      pieceVersion: null,
      verdict: null,
      createdAt: "2026-01-01T00:00:01.000Z",
    },
  ];

  return {
    created,
    createConversation: async (input: CreateConversationInput) => {
      created.push(input);
      const id = `conv-${nextId++}`;
      rows.push({
        id,
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        pieceId: null,
        title: input.title ?? null,
        status: "active",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      return id;
    },
    getConversation: async (conversationId, workspaceId, clientId) =>
      rows.find(
        (r) =>
          r.id === conversationId &&
          r.workspaceId === workspaceId &&
          r.clientId === clientId,
      ) ?? null,
    listConversations: async (workspaceId, clientId) =>
      rows
        .filter((r) => r.workspaceId === workspaceId && r.clientId === clientId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    listTurns: async (conversationId, workspaceId, clientId) =>
      turns.filter(
        (t) =>
          t.conversationId === conversationId &&
          t.workspaceId === workspaceId &&
          t.clientId === clientId,
      ),
    // Unused by these read/create routes — throw if reached (fail-loud).
    appendTurn: async () => {
      throw new Error("appendTurn not expected in CRUD route tests");
    },
    nextSeq: async () => {
      throw new Error("nextSeq not expected in CRUD route tests");
    },
    setConversationPiece: async () => {
      throw new Error("setConversationPiece not expected in CRUD route tests");
    },
  };
}

// ── Fake content seam + workspace resolver ─────────────────────────────────────

/** CLIENT_A belongs to WORKSPACE_A only — mirrors the content fixture's rule. */
function makeContentData(): RouteDeps["data"] {
  return {
    clientBelongsToWorkspace: async (clientId: string, workspaceId: string) =>
      clientId === CLIENT_A && workspaceId === WORKSPACE_A,
  };
}

/** Authenticated as the operator who owns WORKSPACE_A. */
function authedDeps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    data: makeContentData(),
    conversations: makeConversations(),
    resolveWorkspace: async (): Promise<Workspace | null> => workspace(WORKSPACE_A),
    ...over,
  };
}

/** Unauthenticated: no operator/workspace resolves. */
function unauthDeps(over: Partial<RouteDeps> = {}): RouteDeps {
  return authedDeps({ resolveWorkspace: async () => null, ...over });
}

// ── Request builders ───────────────────────────────────────────────────────────

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listRequest(query: Record<string, string>): Request {
  const url = new URL("http://localhost/api/conversations");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

function getByIdRequest(conversationId: string, query: Record<string, string>): Request {
  const url = new URL("http://localhost/api/conversations/" + conversationId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST create
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/conversations — create (scoped to the bound workspace/client)", () => {
  it("creates a conversation bound to the SERVER's workspace + the validated clientId", async () => {
    const deps = authedDeps();
    const res = await handleCreateConversation(
      postRequest({ clientId: CLIENT_A, title: "My new thread" }),
      deps,
    );
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(typeof out.conversationId).toBe("string");

    // The create was scoped by the BOUND tenancy — never widened by request input.
    const created = (deps.conversations as ReturnType<typeof makeConversations>).created;
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      title: "My new thread",
    });
  });

  it("creates without a title (title is optional)", async () => {
    const deps = authedDeps();
    const res = await handleCreateConversation(postRequest({ clientId: CLIENT_A }), deps);
    expect(res.status).toBe(201);
    const created = (deps.conversations as ReturnType<typeof makeConversations>).created;
    expect(created[0]).toEqual({ workspaceId: WORKSPACE_A, clientId: CLIENT_A, title: undefined });
  });

  it("a forged/foreign clientId not owned by the workspace -> 404 (no create)", async () => {
    const deps = authedDeps();
    const res = await handleCreateConversation(postRequest({ clientId: CLIENT_B }), deps);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not-found");
    expect((deps.conversations as ReturnType<typeof makeConversations>).created).toHaveLength(0);
  });

  it("unauthenticated (no workspace) -> 401 (no create)", async () => {
    const deps = unauthDeps();
    const res = await handleCreateConversation(
      postRequest({ clientId: CLIENT_A }),
      deps,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
    expect((deps.conversations as ReturnType<typeof makeConversations>).created).toHaveLength(0);
  });

  it("a request body carrying its own workspaceId is rejected (strict schema) -> 400", async () => {
    const deps = authedDeps();
    const res = await handleCreateConversation(
      postRequest({ clientId: CLIENT_A, workspaceId: WORKSPACE_B }),
      deps,
    );
    // The strict schema refuses unknown keys — a caller can never inject tenancy.
    expect(res.status).toBe(400);
  });

  it("a malformed body (non-uuid clientId) -> 400", async () => {
    const deps = authedDeps();
    const res = await handleCreateConversation(postRequest({ clientId: "nope" }), deps);
    expect(res.status).toBe(400);
  });

  it("invalid JSON -> 400", async () => {
    const deps = authedDeps();
    const req = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await handleCreateConversation(req, deps);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET list
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/conversations — list (scoped to the bound workspace/client)", () => {
  it("returns only the bound workspace/client's conversations", async () => {
    const deps = authedDeps();
    const res = await handleListConversations(listRequest({ clientId: CLIENT_A }), deps);
    expect(res.status).toBe(200);
    const out = await res.json();
    // CONV_A is owned by (WORKSPACE_A, CLIENT_A); CONV_B (other tenant) is NOT visible.
    const ids = out.conversations.map((c: { id: string }) => c.id);
    expect(ids).toContain(CONV_A);
    expect(ids).not.toContain(CONV_B);
  });

  it("a forged/foreign clientId -> 404 (the bind never widens tenancy)", async () => {
    const deps = authedDeps();
    const res = await handleListConversations(listRequest({ clientId: CLIENT_B }), deps);
    expect(res.status).toBe(404);
  });

  it("unauthenticated -> 401", async () => {
    const deps = unauthDeps();
    const res = await handleListConversations(listRequest({ clientId: CLIENT_A }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("missing clientId -> 400", async () => {
    const deps = authedDeps();
    const res = await handleListConversations(listRequest({}), deps);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET [id] — transcript
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/conversations/[id] — load the transcript (header + ordered turns)", () => {
  it("loads the conversation + its turns ordered by seq ascending", async () => {
    const deps = authedDeps();
    const res = await handleGetConversation(
      getByIdRequest(CONV_A, { clientId: CLIENT_A }),
      CONV_A,
      deps,
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.conversation.id).toBe(CONV_A);
    expect(out.conversation.title).toBe("Thread A");
    // Turns come back ordered by seq even though the store seeded them out of order.
    expect(out.turns.map((t: { seq: number }) => t.seq)).toEqual([1, 2]);
    expect(out.turns[0].role).toBe("user");
    expect(out.turns[1].role).toBe("agent");
    expect(out.turns[1].runId).toBe("run-1");
  });

  it("a conversation owned by a DIFFERENT tenant -> 404 (cross-tenant, no leak)", async () => {
    const deps = authedDeps();
    // CONV_B belongs to (WORKSPACE_B, CLIENT_B). The operator is bound to
    // (WORKSPACE_A, CLIENT_A); the scoped getConversation resolves null -> 404.
    const res = await handleGetConversation(
      getByIdRequest(CONV_B, { clientId: CLIENT_A }),
      CONV_B,
      deps,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not-found");
  });

  it("a syntactically-valid but unknown conversation id -> 404", async () => {
    const deps = authedDeps();
    const res = await handleGetConversation(
      getByIdRequest(CONV_MISSING, { clientId: CLIENT_A }),
      CONV_MISSING,
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("a forged/foreign clientId -> 404 (the bind 404s before any conversation read)", async () => {
    const deps = authedDeps();
    const res = await handleGetConversation(
      getByIdRequest(CONV_A, { clientId: CLIENT_B }),
      CONV_A,
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("unauthenticated -> 401", async () => {
    const deps = unauthDeps();
    const res = await handleGetConversation(
      getByIdRequest(CONV_A, { clientId: CLIENT_A }),
      CONV_A,
      deps,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("a non-uuid [id] segment -> 400 (it can never name a real conversation)", async () => {
    const deps = authedDeps();
    const res = await handleGetConversation(
      getByIdRequest("not-a-uuid", { clientId: CLIENT_A }),
      "not-a-uuid",
      deps,
    );
    expect(res.status).toBe(400);
  });

  it("missing clientId query -> 400", async () => {
    const deps = authedDeps();
    const res = await handleGetConversation(getByIdRequest(CONV_A, {}), CONV_A, deps);
    expect(res.status).toBe(400);
  });
});
