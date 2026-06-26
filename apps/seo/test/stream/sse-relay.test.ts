/**
 * SSE relay + /api/run dispatch — Tier 1 (no infra).
 *
 * Covers PR 007's acceptance criteria with the worker dispatch + Supabase reads
 * INJECTED (no live Sandbox, no live Supabase, no provider key):
 *
 *   - AC2: tool-use events arrive as STABLE taxonomy codes; an unknown tool name
 *          is dropped, never forwarded as raw prose.
 *   - AC3: CostAccountant.reserve() runs pre-flight; an over-cap request returns a
 *          cost error BEFORE any worker dispatch (the dispatcher is never called).
 *   - AC4: a worker terminal error surfaces as a terminal SSE `error` frame with a
 *          stable code and the stream ENDS (no hang); a silent stall trips the
 *          heartbeat stall ceiling -> terminal HEARTBEAT_TIMEOUT.
 *   - AC5: on a last_event_id reconnect the relay emits the PERSISTED truth
 *          snapshot (content_pieces + gate_results) then resumes only deltas AFTER
 *          the cursor — no duplication, no loss; never replays worker memory.
 *   - AC6: the per-run JWT is scoped to exactly (workspace_id, client_id, run_id)
 *          and expires at the run-budget ceiling; an expired OR cross-run OR
 *          cross-tenant token is rejected by the host verifier.
 *
 * Also asserts event ORDERING through the relay and the worker-side emitter's
 * taxonomy translation (the AC2 chokepoint).
 */

import { describe, it, expect, vi } from "vitest";

import {
  serializeSseEvent,
  TOOL_USE_CODES,
  SSE_EVENT_TYPES,
  type SseEvent,
} from "@/lib/stream/event-taxonomy";
import {
  relayFrames,
  parseLastEventId,
  RUN_BUDGET_CEILING_MS,
  type RelayClock,
  type TruthSnapshotReader,
  type SseRelayConfig,
} from "@/lib/stream/sse-relay";
import { WorkerEventEmitter, toolNameToCode, type EventSink } from "@/worker/emit";
import {
  handleRun,
  mintBridgeToken,
  verifyBridgeToken,
  type RunDeps,
  type WorkerDispatcher,
} from "@/app/api/run/route";
import { CostAccountant } from "@sagemark/core";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_A = "run-A-0001";
const RUN_B = "run-B-0002";
const SCOPE_A = { workspaceId: WORKSPACE_A, clientId: CLIENT_A, runId: RUN_A };
const SECRET = "test-bridge-secret-not-a-real-key";

function workspace(id = WORKSPACE_A) {
  return { id, ownerType: "user" as const, ownerId: "owner", name: "Test WS" };
}

/** A data-access stub where CLIENT_A belongs to WORKSPACE_A only. */
function makeData() {
  return {
    clientBelongsToWorkspace: vi.fn(async (clientId: string, workspaceId: string) =>
      clientId === CLIENT_A && workspaceId === WORKSPACE_A,
    ),
  } as unknown as RunDeps["data"];
}

/** Build an async event source from a fixed list of events. */
async function* sourceOf(events: SseEvent[]): AsyncGenerator<SseEvent> {
  for (const e of events) yield e;
}

/** Drain a frame generator to an array of parsed event payloads (in order). */
async function drain(gen: AsyncGenerator<string>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const frame of gen) {
    // Each frame: "id: N\nevent: T\ndata: {...}\n\n"
    const m = /\ndata: (.*)\n\n$/s.exec(frame);
    expect(m, `frame missing data line: ${frame}`).not.toBeNull();
    out.push(JSON.parse(m![1]) as SseEvent);
  }
  return out;
}

/** A clock that fires no timers (events always win the race) — for ordering tests. */
const NO_FIRE_CLOCK: RelayClock = { setTimer: () => () => undefined };

/** A truth reader that returns a fixed persisted snapshot. */
function truthReaderOf(snap: Awaited<ReturnType<TruthSnapshotReader>>): TruthSnapshotReader {
  return vi.fn(async () => snap);
}

// ── Taxonomy stability (AC2 wire contract) ────────────────────────────────────

describe("event-taxonomy — stable codes (AC2 wire contract)", () => {
  it("freezes the tool-use code set (a rename is a breaking change caught here)", () => {
    expect([...TOOL_USE_CODES]).toEqual([
      "serpFetch",
      "draftBody",
      "persistPiece",
      "runFaithfulnessGate",
      "runGate.stageA",
      "runGate.stageB",
    ]);
  });

  it("freezes the SSE event-type channels", () => {
    expect([...SSE_EVENT_TYPES]).toEqual([
      "token-delta",
      "tool-use",
      "thinking",
      "gate",
      "snapshot",
      "heartbeat",
      "error",
      "done",
    ]);
  });

  it("serializes a frame with id/event/data lines and a terminating blank line", () => {
    const frame = serializeSseEvent({ type: "token-delta", seq: 3, runId: RUN_A, delta: "hi" });
    expect(frame).toBe(`id: 3\nevent: token-delta\ndata: ${JSON.stringify({ type: "token-delta", seq: 3, runId: RUN_A, delta: "hi" })}\n\n`);
  });
});

// ── Worker emitter translation (AC2 chokepoint) ───────────────────────────────

describe("worker/emit — taxonomy translation (AC2)", () => {
  it("maps raw tool names (incl. MCP prefix + aliases) to stable codes", () => {
    expect(toolNameToCode("mcp__seo-worker-host-tools__persistPiece")).toBe("persistPiece");
    expect(toolNameToCode("draft")).toBe("persistPiece");
    expect(toolNameToCode("serp_fetch")).toBe("serpFetch");
    expect(toolNameToCode("stageA")).toBe("runGate.stageA");
    expect(toolNameToCode("stageB")).toBe("runGate.stageB");
    expect(toolNameToCode("faithfulness")).toBe("runFaithfulnessGate");
  });

  it("DROPS an unknown tool name (never a free-text row)", async () => {
    const seen: SseEvent[] = [];
    const sink: EventSink = (e) => void seen.push(e);
    const emitter = new WorkerEventEmitter(RUN_A, sink);
    const seq = await emitter.toolUseFromRawName("evil_curl_exfiltrate", "running");
    expect(seq).toBeNull();
    expect(seen).toHaveLength(0);
    expect(toolNameToCode("evil_curl_exfiltrate")).toBeNull();
  });

  it("stamps a monotonic gap-free seq + runId on every frame", async () => {
    const seen: SseEvent[] = [];
    const emitter = new WorkerEventEmitter(RUN_A, (e) => void seen.push(e));
    await emitter.toolUse({ code: "serpFetch", status: "running" });
    await emitter.tokenDelta("Once upon");
    await emitter.gate({ stage: "stageB", score: 83, verdict: "REVIEW" });
    expect(seen.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(seen.every((e) => e.runId === RUN_A)).toBe(true);
    expect(seen[0]).toMatchObject({ type: "tool-use", code: "serpFetch", status: "running" });
    expect(seen[2]).toMatchObject({ type: "gate", stage: "stageB", score: 83, verdict: "REVIEW" });
  });
});

// ── Relay: ordering + token-delta first (AC1/AC2) ─────────────────────────────

describe("sse-relay — event ordering (fresh connect)", () => {
  it("forwards every event in order, ending on `done`", async () => {
    const events: SseEvent[] = [
      { type: "tool-use", seq: 0, runId: RUN_A, code: "serpFetch", status: "ok" },
      { type: "token-delta", seq: 1, runId: RUN_A, delta: "Hello " },
      { type: "token-delta", seq: 2, runId: RUN_A, delta: "world" },
      { type: "tool-use", seq: 3, runId: RUN_A, code: "persistPiece", status: "ok" },
      { type: "gate", seq: 4, runId: RUN_A, stage: "stageB", score: 88, verdict: "PUBLISH" },
      { type: "done", seq: 5, runId: RUN_A },
    ];
    const cfg: SseRelayConfig = {
      scope: SCOPE_A,
      source: sourceOf(events),
      truthReader: truthReaderOf({ piece: null, scorecard: null }),
      clock: NO_FIRE_CLOCK,
    };
    const out = await drain(relayFrames(cfg));
    expect(out.map((e) => e.type)).toEqual([
      "tool-use",
      "token-delta",
      "token-delta",
      "tool-use",
      "gate",
      "done",
    ]);
    // First token-delta arrives early (AC1 — a delta within the stream).
    expect(out.findIndex((e) => e.type === "token-delta")).toBeGreaterThanOrEqual(0);
  });

  it("drops an event whose runId belongs to another run (defence-in-depth)", async () => {
    const events: SseEvent[] = [
      { type: "token-delta", seq: 0, runId: RUN_B, delta: "leak" }, // wrong run -> dropped
      { type: "token-delta", seq: 1, runId: RUN_A, delta: "ok" },
      { type: "done", seq: 2, runId: RUN_A },
    ];
    const out = await drain(
      relayFrames({
        scope: SCOPE_A,
        source: sourceOf(events),
        truthReader: truthReaderOf({ piece: null, scorecard: null }),
        clock: NO_FIRE_CLOCK,
      }),
    );
    expect(out.map((e) => (e as { delta?: string }).delta).filter(Boolean)).toEqual(["ok"]);
  });
});

// ── Relay: terminal error + stall (AC4) ───────────────────────────────────────

describe("sse-relay — terminal error + stall ceiling (AC4)", () => {
  it("forwards a worker terminal error frame then ENDS the stream (no hang)", async () => {
    const events: SseEvent[] = [
      { type: "token-delta", seq: 0, runId: RUN_A, delta: "partial" },
      { type: "error", seq: 1, runId: RUN_A, code: "WORKER_LOOP_FAILED", message: "boom" },
      // anything after a terminal frame must NOT be emitted:
      { type: "token-delta", seq: 2, runId: RUN_A, delta: "should-not-appear" },
    ];
    const out = await drain(
      relayFrames({
        scope: SCOPE_A,
        source: sourceOf(events),
        truthReader: truthReaderOf({ piece: null, scorecard: null }),
        clock: NO_FIRE_CLOCK,
      }),
    );
    expect(out.map((e) => e.type)).toEqual(["token-delta", "error"]);
    expect(out[1]).toMatchObject({ type: "error", code: "WORKER_LOOP_FAILED" });
  });

  it("a silent stall (no event) trips the stall ceiling -> terminal HEARTBEAT_TIMEOUT", async () => {
    // A source that never yields (simulates a wedged worker).
    const wedged: AsyncIterable<SseEvent> = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<SseEvent>>(() => {}) };
      },
    };
    // A clock where the STALL timer fires immediately, heartbeat never.
    const stallClock: RelayClock = {
      setTimer(fn, ms) {
        if (ms === RUN_BUDGET_CEILING_MS) {
          queueMicrotask(fn); // fire the stall ceiling
        }
        return () => undefined;
      },
    };
    const out = await drain(
      relayFrames({
        scope: SCOPE_A,
        source: wedged,
        truthReader: truthReaderOf({ piece: null, scorecard: null }),
        clock: stallClock,
        stallMs: RUN_BUDGET_CEILING_MS,
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", code: "HEARTBEAT_TIMEOUT" });
  });

  it("an idle-but-not-stalled gap emits a heartbeat keep-alive then continues", async () => {
    // First race: heartbeat fires (idle); the test then lets one event through.
    let beats = 0;
    const events: SseEvent[] = [
      { type: "token-delta", seq: 0, runId: RUN_A, delta: "after-heartbeat" },
      { type: "done", seq: 1, runId: RUN_A },
    ];
    // Source that delays its first event until after one heartbeat fire.
    let resolveFirst: (() => void) | null = null;
    const gate = new Promise<void>((r) => (resolveFirst = r));
    async function* delayedSource(): AsyncGenerator<SseEvent> {
      await gate; // wait for the heartbeat to have fired once
      for (const e of events) yield e;
    }
    const hbClock: RelayClock = {
      setTimer(fn, ms) {
        if (ms === 15_000 && beats === 0) {
          beats++;
          queueMicrotask(() => {
            fn();
            resolveFirst?.(); // unblock the source after the heartbeat
          });
        }
        return () => undefined;
      },
    };
    const out = await drain(
      relayFrames({
        scope: SCOPE_A,
        source: delayedSource(),
        truthReader: truthReaderOf({ piece: null, scorecard: null }),
        clock: hbClock,
        heartbeatMs: 15_000,
        stallMs: RUN_BUDGET_CEILING_MS,
      }),
    );
    expect(out[0].type).toBe("heartbeat");
    expect(out.map((e) => e.type)).toEqual(["heartbeat", "token-delta", "done"]);
  });
});

// ── Relay: last_event_id truth-snapshot resume (AC5) ──────────────────────────

describe("sse-relay — last_event_id truth-snapshot resume (AC5)", () => {
  it("on reconnect: emits the PERSISTED snapshot, then only deltas AFTER the cursor (no dup, no loss)", async () => {
    const persisted = {
      piece: {
        pieceId: "piece-1",
        slug: "memory-care-basics",
        title: "Memory Care Basics",
        body: "## Heading\n\nGrounded body so far.",
        status: "draft",
      },
      scorecard: { stageAVetoes: [], score: 83, verdict: "REVIEW" as const },
    };
    const reader = truthReaderOf(persisted);

    // The worker re-emits its full buffer (seq 0..4), but the client already has
    // through seq 2. The relay must skip 0..2 (already delivered) and resume 3,4.
    const replayed: SseEvent[] = [
      { type: "token-delta", seq: 0, runId: RUN_A, delta: "A" }, // <= cursor -> skipped
      { type: "token-delta", seq: 1, runId: RUN_A, delta: "B" }, // <= cursor -> skipped
      { type: "token-delta", seq: 2, runId: RUN_A, delta: "C" }, // == cursor -> skipped
      { type: "token-delta", seq: 3, runId: RUN_A, delta: "D" }, // > cursor -> resumed
      { type: "gate", seq: 4, runId: RUN_A, stage: "stageB", score: 83, verdict: "REVIEW" },
      { type: "done", seq: 5, runId: RUN_A },
    ];

    const out = await drain(
      relayFrames({
        scope: SCOPE_A,
        source: sourceOf(replayed),
        truthReader: reader,
        lastEventId: 2, // the client's Last-Event-ID
        clock: NO_FIRE_CLOCK,
      }),
    );

    // 1. The truth snapshot is FIRST and reflects the PERSISTED rows (not worker memory).
    expect(out[0].type).toBe("snapshot");
    expect(out[0]).toMatchObject({
      type: "snapshot",
      seq: 2, // cursor-aligned, not a new delta
      piece: { pieceId: "piece-1", slug: "memory-care-basics", status: "draft" },
      scorecard: { score: 83, verdict: "REVIEW", stageAVetoes: [] },
    });
    // The reader was called with the FULL tenancy scope (AC5 scoping).
    expect(reader).toHaveBeenCalledWith(SCOPE_A);

    // 2. No duplication: deltas <= cursor (A,B,C) are NOT replayed.
    const deltas = out.filter((e) => e.type === "token-delta").map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(["D"]);

    // 3. No loss: everything after the cursor (D, the gate, done) is present + ordered.
    expect(out.map((e) => e.type)).toEqual(["snapshot", "token-delta", "gate", "done"]);
  });

  it("parseLastEventId handles header values + the fresh-connect (null) case", () => {
    expect(parseLastEventId("7")).toBe(7);
    expect(parseLastEventId(null)).toBeNull();
    expect(parseLastEventId("")).toBeNull();
    expect(parseLastEventId("not-a-number")).toBeNull();
  });
});

// ── Per-run bridge JWT scoping (AC6) ──────────────────────────────────────────

describe("/api/run bridge JWT — per-run scope + expiry (AC6)", () => {
  it("a token is accepted only for its exact (workspace, client, run)", () => {
    const now = 1_000_000_000_000; // fixed ms
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now });
    const ok = verifyBridgeToken(token, SCOPE_A, { secret: SECRET, nowMs: now });
    expect(ok.ok).toBe(true);
  });

  it("rejects a CROSS-RUN token (minted for run A, presented for run B)", () => {
    const now = 1_000_000_000_000;
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now });
    const res = verifyBridgeToken(
      token,
      { workspaceId: WORKSPACE_A, clientId: CLIENT_A, runId: RUN_B },
      { secret: SECRET, nowMs: now },
    );
    expect(res).toEqual({ ok: false, reason: "wrong-run" });
  });

  it("rejects a CROSS-TENANT token (client A token presented for client B)", () => {
    const now = 1_000_000_000_000;
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now });
    const res = verifyBridgeToken(
      token,
      { workspaceId: WORKSPACE_B, clientId: CLIENT_B, runId: RUN_A },
      { secret: SECRET, nowMs: now },
    );
    expect(res).toEqual({ ok: false, reason: "wrong-tenant" });
  });

  it("rejects an EXPIRED token (past the run-budget ceiling)", () => {
    const now = 1_000_000_000_000;
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now, ceilingMs: RUN_BUDGET_CEILING_MS });
    // Verify well past the ~90s ceiling.
    const later = now + RUN_BUDGET_CEILING_MS + 5_000;
    const res = verifyBridgeToken(token, SCOPE_A, { secret: SECRET, nowMs: later });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered signature", () => {
    const now = 1_000_000_000_000;
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now });
    const forged = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    const res = verifyBridgeToken(forged, SCOPE_A, { secret: SECRET, nowMs: now });
    expect(res.ok).toBe(false);
  });

  it("the minted token expires at ~the run-budget ceiling (claims.exp)", () => {
    const now = 1_000_000_000_000;
    const token = mintBridgeToken(SCOPE_A, { secret: SECRET, nowMs: now });
    const [, payload] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(claims.ws).toBe(WORKSPACE_A);
    expect(claims.cl).toBe(CLIENT_A);
    expect(claims.run).toBe(RUN_A);
    expect((claims.exp - claims.iat) * 1000).toBe(RUN_BUDGET_CEILING_MS);
  });
});

// ── /api/run dispatch gates (AC1 first-delta / AC3 cost / AC4 dispatch fail) ───

describe("/api/run handler — dispatch gates", () => {
  function baseDeps(over: Partial<RunDeps> = {}): RunDeps {
    return {
      data: makeData(),
      resolveWorkspace: async () => workspace(),
      // The dispatcher stamps the bound run's id on its events (as the live worker
      // does from its JWT/env binding) — runId MUST match the relay scope.
      dispatcher: async (d) =>
        sourceOf([
          { type: "tool-use", seq: 0, runId: d.scope.runId, code: "serpFetch", status: "ok" },
          { type: "token-delta", seq: 1, runId: d.scope.runId, delta: "first token" },
          { type: "tool-use", seq: 2, runId: d.scope.runId, code: "persistPiece", status: "ok" },
          { type: "done", seq: 3, runId: d.scope.runId },
        ]),
      truthReader: truthReaderOf({ piece: null, scorecard: null }),
      makeAccountant: () => new CostAccountant(2.0),
      newRunId: () => RUN_A,
      jwtSecret: SECRET,
      nowMs: () => 1_000_000_000_000,
      ...over,
    };
  }

  function runRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/run", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("401 when unauthenticated (no workspace)", async () => {
    const res = await handleRun(runRequest({ clientId: CLIENT_A }), baseDeps({ resolveWorkspace: async () => null }));
    expect(res.status).toBe(401);
  });

  it("404 when the client is not owned by the operator's workspace", async () => {
    const res = await handleRun(runRequest({ clientId: CLIENT_B }), baseDeps());
    expect(res.status).toBe(404);
  });

  it("AC3: an over-cap request returns 402 COST_CAP_EXCEEDED and NEVER dispatches", async () => {
    const dispatcher = vi.fn<WorkerDispatcher>(async () => sourceOf([]));
    const res = await handleRun(
      runRequest({ clientId: CLIENT_A, estimatedCostUsd: 5.0 }), // over the $2 cap
      baseDeps({ dispatcher, makeAccountant: () => new CostAccountant(2.0) }),
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("COST_CAP_EXCEEDED");
    // The pre-flight tripped BEFORE any worker dispatch.
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("AC1: a valid run streams an SSE body whose FIRST token-delta is present", async () => {
    const res = await handleRun(runRequest({ clientId: CLIENT_A }), baseDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    // The relay forwarded the worker's events, including a token-delta and the
    // persistPiece tool row (the persisted-piece signal, AC1).
    expect(text).toContain("event: token-delta");
    expect(text).toContain('"code":"persistPiece"');
    expect(text).toContain("event: done");
  });

  it("AC6 wiring: /api/run mints a token scoped to the bound (workspace, client, run)", async () => {
    let dispatched: { scope: unknown; bridgeJwt: string } | null = null;
    const dispatcher: WorkerDispatcher = async (d) => {
      dispatched = { scope: d.scope, bridgeJwt: d.bridgeJwt };
      return sourceOf([{ type: "done", seq: 0, runId: RUN_A }]);
    };
    const res = await handleRun(runRequest({ clientId: CLIENT_A }), baseDeps({ dispatcher }));
    await res.text();
    expect(dispatched).not.toBeNull();
    expect(dispatched!.scope).toEqual(SCOPE_A);
    // The minted token verifies for exactly this scope and nothing else.
    const v = verifyBridgeToken(dispatched!.bridgeJwt, SCOPE_A, {
      secret: SECRET,
      nowMs: 1_000_000_000_000,
    });
    expect(v.ok).toBe(true);
  });

  it("AC4: a dispatch failure returns a synchronous 503 (not a hung stream)", async () => {
    const res = await handleRun(
      runRequest({ clientId: CLIENT_A }),
      baseDeps({
        dispatcher: async () => {
          throw new Error("sandbox boot refused");
        },
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("WORKER_LOOP_FAILED");
  });

  it("AC5 wiring: a Last-Event-ID reconnect emits the persisted snapshot first", async () => {
    const persisted = {
      piece: { pieceId: "p1", slug: "s", title: "T", body: "B", status: "draft" },
      scorecard: { stageAVetoes: [], score: 90, verdict: "PUBLISH" as const },
    };
    const res = await handleRun(
      runRequest({ clientId: CLIENT_A }, { "last-event-id": "2" }),
      baseDeps({
        truthReader: truthReaderOf(persisted),
        dispatcher: async () =>
          sourceOf([
            { type: "token-delta", seq: 1, runId: RUN_A, delta: "old" }, // <= cursor -> skipped
            { type: "token-delta", seq: 3, runId: RUN_A, delta: "new" }, // > cursor -> resumed
            { type: "done", seq: 4, runId: RUN_A },
          ]),
      }),
    );
    const text = await res.text();
    expect(text).toContain("event: snapshot");
    expect(text).toContain('"pieceId":"p1"');
    expect(text).toContain('"delta":"new"');
    expect(text).not.toContain('"delta":"old"'); // no duplication across the cursor
  });
});
