/**
 * post-turn-stream — the POST-fetch-stream consumer (studio-ui, chat front door).
 *
 * The composer cannot use `EventSource` (POST `/api/run` returns the relay body), so
 * it POSTs + reads the streaming response body + folds the SAME taxonomy via the
 * SHARED reducer. These node-env units exercise the parts with no DOM:
 *   - `parseSseFrames`: the wire-frame parser (the bytes the EventSource path gets for
 *     free) — single frame, multi-frame, a CHUNK-SPLIT frame (partial held in `rest`),
 *     malformed-frame tolerance, heartbeat/id-only frames ignored.
 *   - `runTurnStream`: POSTs the TENANCY-MINIMAL body `{ conversationId, clientId,
 *     prompt }`, streams a scripted body, and folds every event in order; a non-OK
 *     HTTP response surfaces as a transport error (no SSE frame to fold).
 *   - `snapshotFromPersisted`: builds the synthetic on-done reconcile snapshot.
 *
 * The fold itself is the shared `reduceUiMessageStream` (its own suite proves the
 * taxonomy projection) — here we only prove the wire->events->fold plumbing.
 */

import { describe, it, expect } from "vitest";
import {
  parseSseFrames,
  runTurnStream,
  snapshotFromPersisted,
  type ResponseLike,
} from "@/lib/stream/post-turn-stream";
import {
  INITIAL_STREAM_STATE,
  reduceUiMessageStream,
} from "@/lib/stream/use-ui-message-stream";
import { serializeSseEvent, type SseEvent } from "@/lib/stream/event-taxonomy";

const RUN = "run-1";

/** A scripted streaming Response: hands back the supplied chunks then closes. */
function scriptedResponse(chunks: string[], init?: { ok?: boolean; status?: number }): ResponseLike {
  let i = 0;
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { done: false, value: chunks[i++] };
            return { done: true };
          },
          cancel() {},
        };
      },
    },
  };
}

describe("parseSseFrames — wire frames -> taxonomy events", () => {
  it("parses a single complete frame", () => {
    const wire = serializeSseEvent({ type: "token-delta", seq: 1, runId: RUN, delta: "Hi" });
    const { events, rest } = parseSseFrames(wire);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "token-delta", delta: "Hi" });
    expect(rest).toBe("");
  });

  it("parses multiple frames in one chunk, in order", () => {
    const wire =
      serializeSseEvent({ type: "thinking", seq: 1, runId: RUN, delta: "Plan." }) +
      serializeSseEvent({ type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "ok" });
    const { events } = parseSseFrames(wire);
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool-use"]);
  });

  it("holds a chunk-split partial frame in `rest` and completes it next chunk", () => {
    const full = serializeSseEvent({ type: "token-delta", seq: 1, runId: RUN, delta: "Body" });
    const splitAt = Math.floor(full.length / 2);
    const a = parseSseFrames(full.slice(0, splitAt));
    expect(a.events).toHaveLength(0); // not yet terminated
    expect(a.rest).not.toBe("");
    const b = parseSseFrames(a.rest + full.slice(splitAt));
    expect(b.events).toHaveLength(1);
    expect(b.events[0]).toMatchObject({ delta: "Body" });
  });

  it("tolerates a malformed data line without corrupting the batch", () => {
    const good = serializeSseEvent({ type: "done", seq: 9, runId: RUN });
    const bad = "event: token-delta\ndata: {not json\n\n";
    const { events } = parseSseFrames(bad + good);
    expect(events.map((e) => e.type)).toEqual(["done"]); // the bad frame is dropped
  });

  it("ignores a frame with no data line (id-only / comment heartbeat)", () => {
    const { events } = parseSseFrames("id: 5\nevent: heartbeat\n\n");
    expect(events).toHaveLength(0);
  });
});

describe("runTurnStream — POST + stream + fold", () => {
  it("POSTs EXACTLY {conversationId, clientId, prompt} (tenancy-minimal)", async () => {
    let captured: { url: string; init: { method: string; body: string } } | null = null;
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      captured = { url, init };
      return scriptedResponse([serializeSseEvent({ type: "done", seq: 1, runId: RUN })]);
    };
    await runTurnStream(
      { conversationId: "c-1", clientId: "cl-1", prompt: "  write it  " },
      { onEvent: () => {}, onTransportError: () => {} },
      { fetchImpl, endpoint: "/api/run" },
    );
    expect(captured!.url).toBe("/api/run");
    expect(captured!.init.method).toBe("POST");
    const body = JSON.parse(captured!.init.body) as Record<string, unknown>;
    // The body is EXACTLY the three tenancy-minimal fields — never a workspace id.
    expect(Object.keys(body).sort()).toEqual(["clientId", "conversationId", "prompt"]);
    expect(body).toMatchObject({ conversationId: "c-1", clientId: "cl-1", prompt: "  write it  " });
    expect(body).not.toHaveProperty("workspaceId");
  });

  it("folds a scripted streamed run (across chunk boundaries) into the projection", async () => {
    const frames = [
      serializeSseEvent({ type: "thinking", seq: 1, runId: RUN, delta: "Researching." }),
      serializeSseEvent({ type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "ok", label: "3 sources" }),
      serializeSseEvent({ type: "token-delta", seq: 3, runId: RUN, delta: "# Title" }),
      serializeSseEvent({ type: "gate", seq: 4, runId: RUN, stage: "stageB", score: 88, verdict: "PUBLISH" }),
      serializeSseEvent({ type: "done", seq: 5, runId: RUN }),
    ];
    // Glue all frames then re-split into awkward chunks to prove the partial-buffer logic.
    const wire = frames.join("");
    const chunks = [wire.slice(0, 30), wire.slice(30, 90), wire.slice(90)];
    const fetchImpl = async () => scriptedResponse(chunks);

    let state = INITIAL_STREAM_STATE;
    await runTurnStream(
      { conversationId: "c-1", clientId: "cl-1", prompt: "go" },
      { onEvent: (e: SseEvent) => (state = reduceUiMessageStream(state, e)), onTransportError: () => {} },
      { fetchImpl },
    );

    expect(state.body).toBe("# Title");
    expect(state.feed.filter((f) => f.kind === "tool-use")).toHaveLength(1);
    expect(state.feed.filter((f) => f.kind === "thinking")).toHaveLength(1);
    expect(state.scorecard).toMatchObject({ verdict: "PUBLISH", score: 88 });
    expect(state.phase).toBe("done");
  });

  it("surfaces a non-OK HTTP response as a transport error (no SSE frame)", async () => {
    const fetchImpl = async () => scriptedResponse([], { ok: false, status: 402 });
    let transportError = "";
    await runTurnStream(
      { conversationId: "c-1", clientId: "cl-1", prompt: "go" },
      { onEvent: () => {}, onTransportError: (m) => (transportError = m) },
      { fetchImpl },
    );
    expect(transportError).toContain("402");
  });

  it("surfaces a thrown fetch (network failure) as a transport error", async () => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    let transportError = "";
    await runTurnStream(
      { conversationId: "c-1", clientId: "cl-1", prompt: "go" },
      { onEvent: () => {}, onTransportError: (m) => (transportError = m) },
      { fetchImpl },
    );
    expect(transportError).toContain("network down");
  });
});

describe("snapshotFromPersisted — on-done reconcile event", () => {
  it("builds a cursor-aligned snapshot the reducer folds to the persisted truth", () => {
    const snap = snapshotFromPersisted(RUN, 4, {
      piece: { pieceId: "p1", slug: "s", title: "T", body: "PERSISTED BODY", status: "draft" },
      scorecard: { stageAVetoes: [], score: 91, verdict: "PUBLISH" },
    });
    expect(snap.type).toBe("snapshot");
    expect(snap.seq).toBe(4); // cursor-aligned, never a NEW delta
    // Fold it onto a dirty stream-accumulated body — the persisted body wins.
    const dirty = reduceUiMessageStream(INITIAL_STREAM_STATE, {
      type: "token-delta",
      seq: 1,
      runId: RUN,
      delta: "stale stream partial",
    });
    const reconciled = reduceUiMessageStream(dirty, snap);
    expect(reconciled.body).toBe("PERSISTED BODY");
    expect(reconciled.scorecard).toMatchObject({ score: 91, verdict: "PUBLISH" });
  });
});
