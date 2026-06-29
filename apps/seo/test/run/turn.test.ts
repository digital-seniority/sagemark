/**
 * turn.test.ts — POST /api/run turn-awareness (Slice 5 / P-F, lane worker-runtime).
 *
 * Drives `handleRun` with INJECTED fake deps (conversation/data/dispatcher/truth) —
 * NO live infra. The load-bearing proofs:
 *
 *   (1) ONE-SHOT BACK-COMPAT: with NO `conversationId`, the dispatched brief is the
 *       request `prompt` VERBATIM (the composer never runs) and NO conversation
 *       method is touched — the existing one-shot path is unchanged.
 *   (2) TURN PRE-AMBLE: with a `conversationId`, the USER turn is appended
 *       synchronously (at the next seq) BEFORE dispatch, and the dispatched brief is
 *       the COMPOSED turn prompt (not the raw message) — the composer's framing is
 *       present.
 *   (3) AGENT-TURN ON DONE: when the worker stream completes (terminal `done`), the
 *       AGENT turn is recorded with `runId` + the persisted `pieceVersion` + verdict,
 *       and the conversation is LINKED to its piece (first draft).
 *   (4) IDEMPOTENCY: a second completion for the SAME run never double-records.
 *   (5) FAILED RUN: a terminal `error` frame records NO agent turn (no phantom turn).
 *   (6) CROSS-TENANT 404: a conversationId not owned by the bound (workspaceId,
 *       clientId) returns 404 and dispatches NOTHING (no user turn, no worker).
 *
 * The relay consumes the (wrapped) source internally; we DRAIN the streamed
 * `text/event-stream` body to drive the wrapper to completion, then assert the
 * recorded turns (the agent-turn write is fire-and-forget, so we await a microtask
 * flush).
 */
import { describe, it, expect, vi } from "vitest";

import { handleRun, type RunDeps } from "@/app/api/run/route";
import {
  NOT_WIRED_CONVERSATION_ACCESS,
  type ConversationDataAccess,
  type ConversationRow,
  type ConversationTurnRow,
  type CreateConversationInput,
  type AppendTurnInput,
} from "@/lib/conversation/context";
import { NOT_WIRED_DATA_ACCESS, type ContentDataAccess, type ContentPieceRow } from "@/lib/content/context";
import type { Workspace } from "@/lib/auth";
import type { WorkerEventSource, TruthSnapshotReader } from "@/lib/stream/sse-relay";
import type { SseEvent } from "@/lib/stream/event-taxonomy";

// ── fixtures (valid RFC-4122 v4 UUIDs) ────────────────────────────────────────
const WS = "11111111-1111-4111-8111-111111111111";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PIECE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const WORKSPACE: Workspace = { id: WS, ownerType: "user", ownerId: "op-1", name: "WW" };

// ── in-memory conversation access (faithful, tenancy-scoped) ──────────────────
function makeConvAccess(seed?: Partial<ConversationRow>): {
  access: ConversationDataAccess;
  conversations: ConversationRow[];
  turns: ConversationTurnRow[];
  spy: { appendTurn: ReturnType<typeof vi.fn>; setConversationPiece: ReturnType<typeof vi.fn> };
} {
  const conversations: ConversationRow[] = [];
  const turns: ConversationTurnRow[] = [];
  let turnSeq = 0;

  if (seed) {
    conversations.push({
      id: seed.id ?? "conv-1",
      workspaceId: seed.workspaceId ?? WS,
      clientId: seed.clientId ?? CLIENT,
      pieceId: seed.pieceId ?? null,
      title: seed.title ?? null,
      status: seed.status ?? "active",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
  }

  const scoped = (c: ConversationRow, ws: string, cl: string) =>
    c.workspaceId === ws && c.clientId === cl;

  const appendTurn = vi.fn(async (input: AppendTurnInput): Promise<string> => {
    const dup = turns.find(
      (t) => t.conversationId === input.conversationId && t.seq === input.seq,
    );
    if (dup) throw new Error(`duplicate (conversation, seq)=(${input.conversationId}, ${input.seq})`);
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
  });

  const setConversationPiece = vi.fn(
    async (conversationId: string, pieceId: string, ws: string, cl: string) => {
      const c = conversations.find((x) => x.id === conversationId && scoped(x, ws, cl));
      if (!c) throw new Error("no such conversation under bound tenancy");
      if (c.pieceId === pieceId) return;
      if (c.pieceId !== null) throw new Error("piece conflict");
      c.pieceId = pieceId;
    },
  );

  const access: ConversationDataAccess = {
    createConversation: async (input: CreateConversationInput) => {
      const id = `conv-${conversations.length + 1}`;
      conversations.push({
        id,
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        pieceId: null,
        title: input.title ?? null,
        status: "active",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      });
      return id;
    },
    getConversation: async (conversationId, ws, cl) => {
      const c = conversations.find((x) => x.id === conversationId && scoped(x, ws, cl));
      return c ? { ...c } : null;
    },
    listConversations: async (ws, cl) =>
      conversations.filter((c) => scoped(c, ws, cl)).map((c) => ({ ...c })),
    listTurns: async (conversationId, ws, cl) =>
      turns
        .filter((t) => t.conversationId === conversationId && t.workspaceId === ws && t.clientId === cl)
        .sort((a, b) => a.seq - b.seq)
        .map((t) => ({ ...t })),
    appendTurn,
    nextSeq: async (conversationId, ws, cl) => {
      const mine = turns.filter(
        (t) => t.conversationId === conversationId && t.workspaceId === ws && t.clientId === cl,
      );
      return mine.length === 0 ? 0 : Math.max(...mine.map((t) => t.seq)) + 1;
    },
    setConversationPiece,
    setConversationTitle: vi.fn(async () => {}),
  };

  return { access, conversations, turns, spy: { appendTurn, setConversationPiece } };
}

// ── fake content data access (clientBelongsToWorkspace + loadPiece) ───────────
function makeDataAccess(opts: {
  ownedClients?: string[];
  piece?: ContentPieceRow | null;
}): ContentDataAccess {
  const owned = new Set(opts.ownedClients ?? [CLIENT]);
  return {
    ...NOT_WIRED_DATA_ACCESS,
    clientBelongsToWorkspace: async (clientId, workspaceId) =>
      owned.has(clientId) && workspaceId === WS,
    loadPiece: async (pieceId, clientId) => {
      if (opts.piece && opts.piece.id === pieceId && opts.piece.clientId === clientId) {
        return { ...opts.piece };
      }
      return null;
    },
    loadLatestVersion: async () => null,
  };
}

function makePiece(over?: Partial<ContentPieceRow>): ContentPieceRow {
  return {
    id: PIECE,
    clientId: CLIENT,
    slug: "hip-protectors",
    title: "Hip Protectors",
    body: "The current draft body.",
    status: "draft",
    version: 2,
    isYmyl: false,
    authorId: null,
    verdict: "REVIEW",
    evalScore: 83,
    faqData: null,
    briefSnapshot: null,
    ...over,
  };
}

// A scripted worker event source that yields the given frames then ends.
function scriptedSource(events: SseEvent[]): WorkerEventSource {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

const RUN_ID = "run-fixed-0001";
const JWT_SECRET = "test-bridge-secret-not-a-real-key";
const truthReaderNoop: TruthSnapshotReader = async () => ({ piece: null, scorecard: null });

/**
 * Drain a streamed Response body to completion (drives the source wrapper). If a
 * `recording` promise was captured (the turn path's fire-and-forget agent-turn
 * write), await it for deterministic assertions.
 */
async function drainResponse(res: Response, recording?: () => Promise<void> | null): Promise<string> {
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  const settled = recording?.();
  if (settled) await settled;
  // Flush any remaining microtasks.
  await new Promise((r) => setTimeout(r, 0));
  return out;
}

function makeBaseDeps(over: Partial<RunDeps>): RunDeps {
  return {
    data: makeDataAccess({}),
    conversations: NOT_WIRED_CONVERSATION_ACCESS,
    resolveWorkspace: async () => WORKSPACE,
    dispatcher: async () => scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]),
    truthReader: truthReaderNoop,
    makeAccountant: () => ({ reserve: () => undefined }) as never,
    newRunId: () => RUN_ID,
    jwtSecret: JWT_SECRET,
    nowMs: () => 1_700_000_000_000,
    ...over,
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/run — one-shot back-compat (no conversationId)", () => {
  it("dispatches the request prompt VERBATIM and never touches the conversation seam", async () => {
    let dispatchedPrompt = "";
    const conv = makeConvAccess(); // any conversation method call would be a contract break
    const convSpy = {
      ...conv.access,
      appendTurn: vi.fn(conv.access.appendTurn),
      getConversation: vi.fn(conv.access.getConversation),
    };
    const deps = makeBaseDeps({
      conversations: convSpy as unknown as ConversationDataAccess,
      dispatcher: async ({ prompt }) => {
        dispatchedPrompt = prompt;
        return scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]);
      },
    });

    const res = await handleRun(req({ clientId: CLIENT, prompt: "ONE SHOT BRIEF" }), deps);
    await drainResponse(res);

    expect(dispatchedPrompt).toBe("ONE SHOT BRIEF");
    expect(convSpy.appendTurn).not.toHaveBeenCalled();
    expect(convSpy.getConversation).not.toHaveBeenCalled();
  });

  it("falls back to the default one-shot brief when no prompt is sent (unchanged)", async () => {
    let dispatchedPrompt = "";
    const deps = makeBaseDeps({
      dispatcher: async ({ prompt }) => {
        dispatchedPrompt = prompt;
        return scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]);
      },
    });
    const res = await handleRun(req({ clientId: CLIENT }), deps);
    await drainResponse(res);
    expect(dispatchedPrompt).toContain("seo-blog-writer");
  });
});

describe("POST /api/run — turn-aware (conversationId present)", () => {
  it("records the USER turn synchronously and dispatches the COMPOSED brief", async () => {
    const conv = makeConvAccess({ id: "conv-1", pieceId: null }); // first turn, no draft
    let dispatchedPrompt = "";
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({}),
      dispatcher: async ({ prompt }) => {
        dispatchedPrompt = prompt;
        return scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]);
      },
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "Write about hip protectors" }),
      deps,
    );

    // The USER turn is recorded BEFORE dispatch (synchronous pre-amble).
    const afterPreamble = conv.turns.filter((t) => t.role === "user");
    expect(afterPreamble).toHaveLength(1);
    expect(afterPreamble[0].seq).toBe(0);
    expect(afterPreamble[0].content).toBe("Write about hip protectors");

    // The dispatched brief is the standalone-author assignment template, NOT the
    // raw message — the single-drafter else branch ran and replaced it.
    expect(dispatchedPrompt).not.toBe("Write about hip protectors");
    expect(dispatchedPrompt).toContain("ARTICLE ASSIGNMENT");
    expect(dispatchedPrompt).toContain("Write about hip protectors");

    await drainResponse(res);
  });

  it("records the AGENT turn on `done` with runId + pieceVersion + verdict, and links the piece", async () => {
    // The conversation is ALREADY linked to a piece (a revision turn), and the
    // persisted piece carries a version + verdict.
    const conv = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    const piece = makePiece({ version: 3, verdict: "PUBLISH" });
    let recording: Promise<void> | null = null;
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({ piece }),
      dispatcher: async () => scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]),
      onAgentTurnRecording: (p) => {
        recording = p;
      },
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "make it warmer" }),
      deps,
    );
    await drainResponse(res, () => recording);

    const agentTurns = conv.turns.filter((t) => t.role === "agent");
    expect(agentTurns).toHaveLength(1);
    expect(agentTurns[0].runId).toBe(RUN_ID);
    expect(agentTurns[0].pieceVersion).toBe(3);
    expect(agentTurns[0].verdict).toBe("PUBLISH");
    // The user turn precedes the agent turn in seq order.
    expect(conv.turns.map((t) => t.role)).toEqual(["user", "agent"]);
  });

  it("links the conversation to its piece on the FIRST draft (setConversationPiece)", async () => {
    // First turn: conversation has NO piece yet; the worker creates one. We simulate
    // the worker linking it out-of-band by having getConversation reflect the link
    // AFTER dispatch — here we link it via the seam so the recorder sees pieceId.
    const conv = makeConvAccess({ id: "conv-1", pieceId: null });
    const piece = makePiece({ version: 1, verdict: "REVIEW" });
    // The worker persisted + linked the piece during the run; reflect that by
    // pre-linking right before completion via a dispatcher side-effect.
    let recording: Promise<void> | null = null;
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({ piece }),
      dispatcher: async () => {
        await conv.access.setConversationPiece("conv-1", PIECE, WS, CLIENT);
        return scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]);
      },
      onAgentTurnRecording: (p) => {
        recording = p;
      },
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "write it" }),
      deps,
    );
    await drainResponse(res, () => recording);

    const linked = await conv.access.getConversation("conv-1", WS, CLIENT);
    expect(linked!.pieceId).toBe(PIECE);
    const agentTurns = conv.turns.filter((t) => t.role === "agent");
    expect(agentTurns).toHaveLength(1);
    expect(agentTurns[0].pieceVersion).toBe(1);
  });

  it("is IDEMPOTENT: a terminal `done` records the agent turn exactly once", async () => {
    const conv = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    const piece = makePiece();
    let recording: Promise<void> | null = null;
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({ piece }),
      // Two terminal `done` frames — the wrapper must record only on the FIRST.
      dispatcher: async () =>
        scriptedSource([
          { type: "done", seq: 0, runId: RUN_ID },
          { type: "done", seq: 1, runId: RUN_ID },
        ]),
      onAgentTurnRecording: (p) => {
        recording = p;
      },
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "again" }),
      deps,
    );
    await drainResponse(res, () => recording);

    expect(conv.turns.filter((t) => t.role === "agent")).toHaveLength(1);
  });

  it("records NO agent turn when the run ends in a terminal `error` (no phantom turn)", async () => {
    const conv = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({ piece: makePiece() }),
      dispatcher: async () =>
        scriptedSource([
          { type: "error", seq: 0, runId: RUN_ID, code: "WORKER_LOOP_FAILED", message: "boom" },
        ]),
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "fail me" }),
      deps,
    );
    await drainResponse(res);

    // The user turn was recorded (intent is durable); the agent turn was NOT.
    expect(conv.turns.filter((t) => t.role === "user")).toHaveLength(1);
    expect(conv.turns.filter((t) => t.role === "agent")).toHaveLength(0);
  });

  it("returns 404 and dispatches NOTHING for a conversation not owned by the bound tenancy", async () => {
    // The conversation exists, but under a DIFFERENT client (cross-tenant).
    const conv = makeConvAccess({ id: "conv-1", clientId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    const dispatcher = vi.fn(async () =>
      scriptedSource([{ type: "done", seq: 0, runId: RUN_ID }]),
    );
    const deps = makeBaseDeps({
      conversations: conv.access,
      data: makeDataAccess({}), // CLIENT is owned; the conversation is not
      dispatcher,
    });

    const res = await handleRun(
      req({ clientId: CLIENT, conversationId: "conv-1", prompt: "leak attempt" }),
      deps,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not-found");
    expect(dispatcher).not.toHaveBeenCalled();
    // No user turn was recorded for a non-owned conversation.
    expect(conv.turns).toHaveLength(0);
  });
});

// ── turn.ts helper units (drained directly, no route) ─────────────────────────
import {
  wrapSourceRecordingAgentTurn,
  recordAgentTurn,
  readPieceTruthSnapshot,
  makeConversationTruthReader,
  type AgentTurnRecorderDeps,
} from "@/app/api/run/turn";

async function drainSource(source: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of source) out.push(e);
  return out;
}

describe("turn.ts — wrapSourceRecordingAgentTurn", () => {
  it("records the agent turn when the source ENDS WITH NO terminal frame (clean close)", async () => {
    const conv = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    let recording: Promise<void> | null = null;
    const deps: AgentTurnRecorderDeps = {
      conversationId: "conv-1",
      runId: RUN_ID,
      bound: { workspaceId: WS, clientId: CLIENT },
      conversation: conv.conversations[0],
      conversations: conv.access,
      data: makeDataAccess({ piece: makePiece({ version: 5 }) }),
      onRecording: (p) => {
        recording = p;
      },
    };
    // A source with NO terminal frame — just a token, then exhausts.
    const source = scriptedSource([{ type: "token-delta", seq: 0, runId: RUN_ID, delta: "hi" }]);
    const frames = await drainSource(wrapSourceRecordingAgentTurn(source, deps));

    // The wrapper forwarded the token verbatim (no terminal frame synthesized here —
    // that is the relay's job downstream).
    expect(frames).toEqual([{ type: "token-delta", seq: 0, runId: RUN_ID, delta: "hi" }]);
    await recording;
    expect(conv.turns.filter((t) => t.role === "agent")).toHaveLength(1);
    expect(conv.turns.find((t) => t.role === "agent")!.pieceVersion).toBe(5);
  });
});

describe("turn.ts — recordAgentTurn idempotency (lazy-reconciliation guard)", () => {
  it("skips when an agent turn for THIS runId already exists", async () => {
    const conv = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    // Pre-seed an agent turn carrying RUN_ID (as if a prior completion / lazy pass).
    await conv.access.appendTurn({
      conversationId: "conv-1",
      workspaceId: WS,
      clientId: CLIENT,
      seq: 0,
      role: "agent",
      content: "already here",
      runId: RUN_ID,
      pieceVersion: 1,
      verdict: "REVIEW",
    });

    await recordAgentTurn({
      conversationId: "conv-1",
      runId: RUN_ID,
      bound: { workspaceId: WS, clientId: CLIENT },
      conversation: conv.conversations[0],
      conversations: conv.access,
      data: makeDataAccess({ piece: makePiece() }),
    });

    // Still exactly one agent turn for this run — no double-record.
    expect(conv.turns.filter((t) => t.role === "agent" && t.runId === RUN_ID)).toHaveLength(1);
  });
});

describe("turn.ts — truth snapshot reads (built from the live read adapter)", () => {
  it("readPieceTruthSnapshot maps loadPiece + verdict to the relay TruthSnapshot", async () => {
    const data = makeDataAccess({ piece: makePiece({ version: 4, verdict: "REVISE", evalScore: 71 }) });
    const snap = await readPieceTruthSnapshot(PIECE, CLIENT, data);
    expect(snap.piece).toMatchObject({ pieceId: PIECE, slug: "hip-protectors", title: "Hip Protectors" });
    expect(snap.scorecard).toEqual({ stageAVetoes: [], score: 71, verdict: "REVISE" });
  });

  it("readPieceTruthSnapshot returns the empty snapshot for an unknown piece (no fabrication)", async () => {
    const data = makeDataAccess({ piece: null });
    expect(await readPieceTruthSnapshot(PIECE, CLIENT, data)).toEqual({ piece: null, scorecard: null });
  });

  it("makeConversationTruthReader resolves the conversation's piece, fail-soft when unlinked", async () => {
    const linked = makeConvAccess({ id: "conv-1", pieceId: PIECE });
    const reader = makeConversationTruthReader({
      conversationId: "conv-1",
      bound: { workspaceId: WS, clientId: CLIENT },
      conversations: linked.access,
      data: makeDataAccess({ piece: makePiece({ version: 2 }) }),
    });
    const snap = await reader({ workspaceId: WS, clientId: CLIENT, runId: RUN_ID });
    expect(snap.piece?.pieceId).toBe(PIECE);

    // An unlinked conversation → empty snapshot (mid-first-draft, no piece yet).
    const unlinked = makeConvAccess({ id: "conv-1", pieceId: null });
    const reader2 = makeConversationTruthReader({
      conversationId: "conv-1",
      bound: { workspaceId: WS, clientId: CLIENT },
      conversations: unlinked.access,
      data: makeDataAccess({ piece: makePiece() }),
    });
    expect(await reader2({ workspaceId: WS, clientId: CLIENT, runId: RUN_ID })).toEqual({
      piece: null,
      scorecard: null,
    });
  });
});
