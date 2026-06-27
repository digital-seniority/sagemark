/**
 * studio-ui (Slice 5 / P-I): the home + canvas SERVER-SIDE resolution units.
 *
 * `resolveHome` / `resolveCanvas` are the tenancy-resolving cores the two studio
 * Server Components share (operator -> workspace -> client -> conversation/turns/
 * brief). These prove, with injected fakes (no RSC render, no live Supabase):
 *
 *   - HOME: no-workspace / no-client / ready branches; the conversation list is read
 *     SCOPED by the bound (workspaceId, clientId).
 *   - CANVAS: redirect-home on no-workspace, no-client, blank id, AND a CROSS-TENANT
 *     conversation id (the owned-scope read returns null -> redirect; no leak); ready
 *     mounts with the turns + the linked-piece brief; a conversation with no pieceId
 *     yields a null brief.
 *   - The scoped reads receive the SERVER's (workspaceId, clientId), never the URL.
 */

import { describe, it, expect } from "vitest";

import {
  resolveHome,
  resolveCanvas,
  type HomeResolveDeps,
  type CanvasResolveDeps,
} from "@/app/(studio)/studio-resolve";
import type { Workspace } from "@/lib/auth";
import type { WorkspaceClient } from "@/lib/content/resolve-workspace-client";
import type {
  ConversationRow,
  ConversationTurnRow,
} from "@/lib/conversation/context";
import type { ContentPieceRow } from "@/lib/content/context";

const WS: Workspace = { id: "ws-1", ownerType: "user", ownerId: "op-1", name: "WW" };
const CLIENT: WorkspaceClient = { id: "cl-1", name: "Whispering Willows", blogSlug: "ww" };

function conv(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-1",
    workspaceId: WS.id,
    clientId: CLIENT.id,
    pieceId: null,
    title: "A piece",
    status: "active",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
    ...over,
  };
}

function turn(over: Partial<ConversationTurnRow> = {}): ConversationTurnRow {
  return {
    id: "t-1",
    conversationId: "conv-1",
    workspaceId: WS.id,
    clientId: CLIENT.id,
    seq: 1,
    role: "user",
    content: "hi",
    runId: null,
    pieceVersion: null,
    verdict: null,
    createdAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

// ── Home ───────────────────────────────────────────────────────────────────────

describe("resolveHome", () => {
  it("returns no-workspace when the operator has no workspace", async () => {
    const deps: HomeResolveDeps = {
      resolveWorkspace: async () => null,
      resolveClient: async () => {
        throw new Error("must not resolve a client without a workspace");
      },
      conversations: {
        listConversations: async () => {
          throw new Error("must not list without a workspace");
        },
      },
    };
    expect(await resolveHome(deps)).toEqual({ kind: "no-workspace" });
  });

  it("returns no-client when the workspace owns no client", async () => {
    const deps: HomeResolveDeps = {
      resolveWorkspace: async () => WS,
      resolveClient: async () => null,
      conversations: {
        listConversations: async () => {
          throw new Error("must not list without a client");
        },
      },
    };
    expect(await resolveHome(deps)).toEqual({ kind: "no-client", workspace: WS });
  });

  it("returns ready with the conversation list scoped by the bound (workspace, client)", async () => {
    let scope: { ws: string; cl: string } | null = null;
    const rows = [conv({ id: "conv-a" }), conv({ id: "conv-b" })];
    const deps: HomeResolveDeps = {
      resolveWorkspace: async () => WS,
      resolveClient: async (workspaceId) => {
        expect(workspaceId).toBe(WS.id); // resolved from the SERVER workspace
        return CLIENT;
      },
      conversations: {
        listConversations: async (ws, cl) => {
          scope = { ws, cl };
          return rows;
        },
      },
    };
    const state = await resolveHome(deps);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.client).toEqual(CLIENT);
    expect(state.conversations).toEqual(rows);
    expect(scope).toEqual({ ws: WS.id, cl: CLIENT.id }); // BOUND tenancy, not URL
  });
});

// ── Canvas ───────────────────────────────────────────────────────────────────

function canvasDeps(over: Partial<CanvasResolveDeps> = {}): CanvasResolveDeps {
  return {
    resolveWorkspace: async () => WS,
    resolveClient: async () => CLIENT,
    conversations: {
      getConversation: async () => conv(),
      listTurns: async () => [turn()],
    },
    content: {
      loadPiece: async () => {
        throw new Error("loadPiece not stubbed");
      },
    },
    ...over,
  };
}

describe("resolveCanvas", () => {
  it("redirects home when there is no workspace", async () => {
    const state = await resolveCanvas("conv-1", canvasDeps({ resolveWorkspace: async () => null }));
    expect(state).toEqual({ kind: "redirect-home" });
  });

  it("redirects home when the workspace has no client", async () => {
    const state = await resolveCanvas("conv-1", canvasDeps({ resolveClient: async () => null }));
    expect(state).toEqual({ kind: "redirect-home" });
  });

  it("redirects home when no conversation id is supplied", async () => {
    expect(await resolveCanvas(null, canvasDeps())).toEqual({ kind: "redirect-home" });
    expect(await resolveCanvas("   ", canvasDeps())).toEqual({ kind: "redirect-home" });
  });

  it("redirects home when the conversation is NOT owned by the bound workspace/client (cross-tenant)", async () => {
    let scope: { id: string; ws: string; cl: string } | null = null;
    const deps = canvasDeps({
      conversations: {
        // A foreign conversation id resolves to null under the bound scope.
        getConversation: async (id, ws, cl) => {
          scope = { id, ws, cl };
          return null;
        },
        listTurns: async () => {
          throw new Error("must not list turns for an unowned conversation");
        },
      },
    });
    const state = await resolveCanvas("foreign-conv", deps);
    expect(state).toEqual({ kind: "redirect-home" });
    // The owned-scope read was keyed by the SERVER's (workspace, client) + the URL id.
    expect(scope).toEqual({ id: "foreign-conv", ws: WS.id, cl: CLIENT.id });
  });

  it("mounts ready with turns + a null brief when the conversation has no piece", async () => {
    const deps = canvasDeps({
      conversations: {
        getConversation: async () => conv({ pieceId: null }),
        listTurns: async () => [
          turn({ id: "t-2", seq: 2, role: "agent", content: "draft", verdict: "PUBLISH" as never, pieceVersion: 1 }),
          turn({ id: "t-1", seq: 1, role: "user", content: "go" }),
        ],
      },
    });
    const state = await resolveCanvas("conv-1", deps);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.clientId).toBe(CLIENT.id);
    expect(state.conversationId).toBe("conv-1");
    expect(state.brief).toBeNull();
    // Turns are sorted by seq ascending + projected to the transcript wire shape.
    expect(state.transcript.map((t) => t.seq)).toEqual([1, 2]);
    expect(state.transcript[1]).toMatchObject({ role: "agent", verdict: "PUBLISH", pieceVersion: 1 });
  });

  it("builds the brief from the linked piece (scoped by the bound client)", async () => {
    let pieceScope: { id: string; cl: string } | null = null;
    const piece: ContentPieceRow = {
      id: "p-1",
      clientId: CLIENT.id,
      slug: "memory-care",
      title: "Memory care basics",
      body: "# body",
      status: "draft" as never,
      version: 1,
      isYmyl: true,
      authorId: null,
      verdict: null,
      evalScore: null,
      faqData: null,
      briefSnapshot: {
        keyword: "memory care",
        sources: [],
        isYmyl: true,
      },
    };
    const deps = canvasDeps({
      conversations: {
        getConversation: async () => conv({ pieceId: "p-1" }),
        listTurns: async () => [],
      },
      content: {
        loadPiece: async (pieceId, clientId) => {
          pieceScope = { id: pieceId, cl: clientId };
          return piece;
        },
      },
    });
    const state = await resolveCanvas("conv-1", deps);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(pieceScope).toEqual({ id: "p-1", cl: CLIENT.id }); // bound client, not URL
    expect(state.brief).toEqual({
      title: "Memory care basics",
      slug: "memory-care",
      primaryKeyword: "memory care",
      funnelStage: null,
      isYmyl: true,
    });
  });
});
