/**
 * conversation-data-access.test.ts — the `ConversationDataAccess` seam round-trip
 * (Slice 5, lane schema-tenancy).
 *
 * Exercises the seam contract against a SMALL in-memory `ConversationDataAccess`
 * impl (a faithful, tenancy-scoped stand-in for the live adapter). The load-bearing
 * proofs:
 *   (a) the create→appendTurn(user)→appendTurn(agent)→listTurns(ordered)→
 *       setConversationPiece round-trip persists + reads back correctly;
 *   (b) `nextSeq` returns 0 on an empty conversation, then max(seq)+1;
 *   (c) `setConversationPiece` is idempotent (same piece) and rejects a re-link to
 *       a DIFFERENT piece;
 *   (d) every read is tenancy-scoped — a cross-tenant `(workspaceId, clientId)`
 *       resolves to null / empty, never a leak.
 */
import { describe, it, expect } from "vitest";
import {
  ConversationPieceConflictError,
  type ConversationDataAccess,
  type ConversationRow,
  type ConversationTurnRow,
  type CreateConversationInput,
  type AppendTurnInput,
} from "@/lib/conversation/context";

// ── fixtures (valid RFC-4122 v4 UUIDs) ──────────────────────────────
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PIECE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/**
 * A small in-memory `ConversationDataAccess` impl. Faithful to the seam contract:
 * tenancy-scoped reads (a row only resolves under its OWN workspace+client),
 * append-only seq (a duplicate (conversation, seq) throws), and the
 * set-piece-once idempotency/conflict rule. Used to prove the seam round-trip
 * independent of any DB.
 */
function makeInMemoryConversationAccess(): ConversationDataAccess {
  let convSeq = 0;
  let turnSeq = 0;
  const conversations: ConversationRow[] = [];
  const turns: ConversationTurnRow[] = [];

  function scoped(c: ConversationRow, ws: string, cl: string): boolean {
    return c.workspaceId === ws && c.clientId === cl;
  }

  return {
    async createConversation(input: CreateConversationInput): Promise<string> {
      convSeq += 1;
      const id = `conv-${convSeq}`;
      const now = "2026-06-27T00:00:00.000Z";
      conversations.push({
        id,
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        pieceId: null,
        title: input.title ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },
    async getConversation(conversationId, workspaceId, clientId) {
      const c = conversations.find(
        (x) => x.id === conversationId && scoped(x, workspaceId, clientId),
      );
      return c ? { ...c } : null;
    },
    async listConversations(workspaceId, clientId) {
      return conversations
        .filter((c) => scoped(c, workspaceId, clientId))
        .map((c) => ({ ...c }));
    },
    async listTurns(conversationId, workspaceId, clientId) {
      return turns
        .filter(
          (t) =>
            t.conversationId === conversationId &&
            t.workspaceId === workspaceId &&
            t.clientId === clientId,
        )
        .sort((a, b) => a.seq - b.seq)
        .map((t) => ({ ...t }));
    },
    async appendTurn(input: AppendTurnInput): Promise<string> {
      const dup = turns.find(
        (t) => t.conversationId === input.conversationId && t.seq === input.seq,
      );
      if (dup) {
        throw new Error(`duplicate (conversation, seq)=(${input.conversationId}, ${input.seq})`);
      }
      turnSeq += 1;
      const id = `turn-${turnSeq}`;
      turns.push({
        id,
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        seq: input.seq,
        role: input.role,
        content: input.content,
        runId: input.runId ?? null,
        pieceVersion: input.pieceVersion ?? null,
        verdict: input.verdict ?? null,
        createdAt: "2026-06-27T00:00:00.000Z",
      });
      return id;
    },
    async nextSeq(conversationId, workspaceId, clientId) {
      const mine = turns.filter(
        (t) =>
          t.conversationId === conversationId &&
          t.workspaceId === workspaceId &&
          t.clientId === clientId,
      );
      if (mine.length === 0) return 0;
      return Math.max(...mine.map((t) => t.seq)) + 1;
    },
    async setConversationPiece(conversationId, pieceId, workspaceId, clientId) {
      const c = conversations.find(
        (x) => x.id === conversationId && scoped(x, workspaceId, clientId),
      );
      if (!c) throw new Error("no such conversation under the bound tenancy");
      if (c.pieceId === pieceId) return; // idempotent
      if (c.pieceId !== null) {
        throw new ConversationPieceConflictError(conversationId, c.pieceId, pieceId);
      }
      c.pieceId = pieceId;
      c.updatedAt = "2026-06-27T01:00:00.000Z";
    },
  };
}

describe("ConversationDataAccess: in-memory round-trip", () => {
  it("create → appendTurn(user) → appendTurn(agent) → listTurns(ordered) → setConversationPiece", async () => {
    const data = makeInMemoryConversationAccess();

    const conversationId = await data.createConversation({
      workspaceId: WS_A,
      clientId: CLIENT_A,
      title: "First thread",
    });
    expect(conversationId).toBeTruthy();

    // Born active, no piece, the bound tenancy.
    const created = await data.getConversation(conversationId, WS_A, CLIENT_A);
    expect(created).not.toBeNull();
    expect(created!.status).toBe("active");
    expect(created!.pieceId).toBeNull();
    expect(created!.title).toBe("First thread");

    // nextSeq is 0 on the empty conversation.
    expect(await data.nextSeq(conversationId, WS_A, CLIENT_A)).toBe(0);

    const seq0 = await data.nextSeq(conversationId, WS_A, CLIENT_A);
    await data.appendTurn({
      conversationId,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: seq0,
      role: "user",
      content: "Write me a post about hip protectors",
    });

    const seq1 = await data.nextSeq(conversationId, WS_A, CLIENT_A);
    expect(seq1).toBe(1);
    await data.appendTurn({
      conversationId,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: seq1,
      role: "agent",
      content: "Here is your draft.",
      runId: "run-abc",
      pieceVersion: 1,
      verdict: "REVIEW",
    });

    // listTurns is ordered by seq, both turns present, agent metadata carried.
    const turns = await data.listTurns(conversationId, WS_A, CLIENT_A);
    expect(turns.map((t) => t.seq)).toEqual([0, 1]);
    expect(turns.map((t) => t.role)).toEqual(["user", "agent"]);
    expect(turns[1].runId).toBe("run-abc");
    expect(turns[1].pieceVersion).toBe(1);
    expect(turns[1].verdict).toBe("REVIEW");

    // setConversationPiece links the thread to the piece.
    await data.setConversationPiece(conversationId, PIECE_A, WS_A, CLIENT_A);
    const linked = await data.getConversation(conversationId, WS_A, CLIENT_A);
    expect(linked!.pieceId).toBe(PIECE_A);

    // It surfaces in the home list for the bound tenancy.
    const list = await data.listConversations(WS_A, CLIENT_A);
    expect(list.map((c) => c.id)).toContain(conversationId);
  });

  it("setConversationPiece is idempotent for the SAME piece, rejects a re-link to a DIFFERENT piece", async () => {
    const data = makeInMemoryConversationAccess();
    const conversationId = await data.createConversation({ workspaceId: WS_A, clientId: CLIENT_A });

    await data.setConversationPiece(conversationId, PIECE_A, WS_A, CLIENT_A);
    // Same piece again — idempotent, no throw.
    await expect(
      data.setConversationPiece(conversationId, PIECE_A, WS_A, CLIENT_A),
    ).resolves.toBeUndefined();
    // A different piece — conflict.
    await expect(
      data.setConversationPiece(conversationId, PIECE_B, WS_A, CLIENT_A),
    ).rejects.toBeInstanceOf(ConversationPieceConflictError);
  });

  it("appendTurn rejects a duplicate seq (append-only ordering)", async () => {
    const data = makeInMemoryConversationAccess();
    const conversationId = await data.createConversation({ workspaceId: WS_A, clientId: CLIENT_A });
    await data.appendTurn({
      conversationId,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: 0,
      role: "user",
      content: "hi",
    });
    await expect(
      data.appendTurn({
        conversationId,
        workspaceId: WS_A,
        clientId: CLIENT_A,
        seq: 0,
        role: "agent",
        content: "collision",
      }),
    ).rejects.toThrow();
  });

  it("reads are tenancy-scoped: a cross-tenant pair resolves to null / empty (no leak)", async () => {
    const data = makeInMemoryConversationAccess();
    const conversationId = await data.createConversation({ workspaceId: WS_A, clientId: CLIENT_A });
    await data.appendTurn({
      conversationId,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: 0,
      role: "user",
      content: "private",
    });

    // Right conversation id, but a foreign workspace/client → null / empty.
    expect(await data.getConversation(conversationId, WS_B, CLIENT_A)).toBeNull();
    expect(await data.getConversation(conversationId, WS_A, CLIENT_B)).toBeNull();
    expect(await data.listTurns(conversationId, WS_B, CLIENT_A)).toHaveLength(0);
    expect(await data.listTurns(conversationId, WS_A, CLIENT_B)).toHaveLength(0);
    expect(await data.nextSeq(conversationId, WS_B, CLIENT_A)).toBe(0);
    expect(await data.listConversations(WS_B, CLIENT_B)).toHaveLength(0);
  });
});
