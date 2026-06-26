/**
 * PR 010 / P1.U.1 — the UI message-stream reducer consumes the PR 007 SSE taxonomy.
 *
 * Drives the PURE `reduceUiMessageStream` fold directly with taxonomy events (no
 * DOM, no live EventSource) and asserts the projection the three zones render:
 *   - token-delta -> accumulated artifact body + streaming phase
 *   - thinking    -> coalesced into ONE growing feed row
 *   - tool-use    -> upserted in place by stable code (running -> ok), never duped
 *   - gate        -> latest scorecard projection
 *   - snapshot    -> reconnect resume replaces body + scorecard with persisted truth
 *   - error/done  -> terminal phase
 *
 * This is the contract seam: the canvas reads the taxonomy by SHAPE, never raw
 * prose (PRD 2 / acceptance 2).
 */

import { describe, it, expect } from "vitest";
import {
  reduceUiMessageStream,
  INITIAL_STREAM_STATE,
  type UiMessageStreamState,
} from "@/lib/stream/use-ui-message-stream";
import type { SseEvent } from "@/lib/stream/event-taxonomy";

const RUN = "run-1";
function fold(events: SseEvent[], start: UiMessageStreamState = INITIAL_STREAM_STATE) {
  return events.reduce(reduceUiMessageStream, start);
}

describe("reduceUiMessageStream — token-delta -> artifact body", () => {
  it("accumulates body text in order and flips to streaming", () => {
    const state = fold([
      { type: "token-delta", seq: 1, runId: RUN, delta: "Memory " },
      { type: "token-delta", seq: 2, runId: RUN, delta: "care is" },
    ]);
    expect(state.body).toBe("Memory care is");
    expect(state.phase).toBe("streaming");
    expect(state.lastSeq).toBe(2);
  });
});

describe("reduceUiMessageStream — thinking coalesces into one row", () => {
  it("merges consecutive thinking deltas into a single feed item", () => {
    const state = fold([
      { type: "thinking", seq: 1, runId: RUN, delta: "Planning " },
      { type: "thinking", seq: 2, runId: RUN, delta: "the outline." },
    ]);
    const thinking = state.feed.filter((f) => f.kind === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({ kind: "thinking", text: "Planning the outline." });
  });

  it("starts a NEW thinking row after a tool-use row breaks the run", () => {
    const state = fold([
      { type: "thinking", seq: 1, runId: RUN, delta: "first" },
      { type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "running" },
      { type: "thinking", seq: 3, runId: RUN, delta: "second" },
    ]);
    const thinking = state.feed.filter((f) => f.kind === "thinking");
    expect(thinking.map((t) => t.kind === "thinking" && t.text)).toEqual(["first", "second"]);
  });
});

describe("reduceUiMessageStream — tool-use upserts by stable code", () => {
  it("updates a row in place (running -> ok) without duplicating the code", () => {
    const state = fold([
      { type: "tool-use", seq: 1, runId: RUN, code: "serpFetch", status: "running" },
      { type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "ok", label: "3 sources" },
    ]);
    const rows = state.feed.filter((f) => f.kind === "tool-use");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "serpFetch", status: "ok", label: "3 sources" });
  });

  it("appends distinct codes in arrival order", () => {
    const state = fold([
      { type: "tool-use", seq: 1, runId: RUN, code: "serpFetch", status: "ok" },
      { type: "tool-use", seq: 2, runId: RUN, code: "draftBody", status: "running" },
      { type: "tool-use", seq: 3, runId: RUN, code: "runGate.stageB", status: "ok", label: "83 REVIEW" },
    ]);
    const codes = state.feed.filter((f) => f.kind === "tool-use").map((f) => (f.kind === "tool-use" ? f.code : ""));
    expect(codes).toEqual(["serpFetch", "draftBody", "runGate.stageB"]);
  });
});

describe("reduceUiMessageStream — gate -> scorecard", () => {
  it("projects the latest gate stage into the scorecard", () => {
    const state = fold([
      { type: "gate", seq: 1, runId: RUN, stage: "stageA", vetoes: [] },
      { type: "gate", seq: 2, runId: RUN, stage: "stageB", score: 83, verdict: "REVIEW" },
    ]);
    expect(state.scorecard).toEqual({ stage: "stageB", vetoes: [], score: 83, verdict: "REVIEW" });
  });

  it("keeps Stage-A vetoes with a null (suppressed) score", () => {
    const state = fold([
      { type: "gate", seq: 1, runId: RUN, stage: "stageA", vetoes: ["BANNED_LEXICON"], score: null, verdict: "REJECT" },
    ]);
    expect(state.scorecard).toMatchObject({ stage: "stageA", vetoes: ["BANNED_LEXICON"], score: null, verdict: "REJECT" });
  });
});

describe("reduceUiMessageStream — snapshot reconnect resume", () => {
  it("replaces body + scorecard with the persisted truth (acceptance 5)", () => {
    const dirty = fold([{ type: "token-delta", seq: 1, runId: RUN, delta: "stale partial" }]);
    const resumed = reduceUiMessageStream(dirty, {
      type: "snapshot",
      seq: 5,
      runId: RUN,
      piece: { pieceId: "p1", slug: "s", title: "T", body: "PERSISTED BODY", status: "draft" },
      scorecard: { stageAVetoes: [], score: 91, verdict: "PUBLISH" },
    });
    expect(resumed.body).toBe("PERSISTED BODY");
    expect(resumed.scorecard).toMatchObject({ stage: "stageB", score: 91, verdict: "PUBLISH" });
  });

  it("infers Stage-A truth when the snapshot score is null", () => {
    const resumed = reduceUiMessageStream(INITIAL_STREAM_STATE, {
      type: "snapshot",
      seq: 2,
      runId: RUN,
      piece: null,
      scorecard: { stageAVetoes: ["YMYL_NO_BYLINE"], score: null, verdict: "REJECT" },
    });
    expect(resumed.scorecard).toMatchObject({ stage: "stageA", score: null, vetoes: ["YMYL_NO_BYLINE"] });
  });
});

describe("reduceUiMessageStream — heartbeat + terminal frames", () => {
  it("ignores heartbeats (liveness only, no projection change)", () => {
    const before = fold([{ type: "token-delta", seq: 1, runId: RUN, delta: "x" }]);
    const after = reduceUiMessageStream(before, { type: "heartbeat", seq: -1, runId: RUN });
    expect(after).toEqual(before);
  });

  it("sets error phase + stable code on a terminal error", () => {
    const state = reduceUiMessageStream(INITIAL_STREAM_STATE, {
      type: "error",
      seq: -1,
      runId: RUN,
      code: "HEARTBEAT_TIMEOUT",
      message: "stalled",
    });
    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ code: "HEARTBEAT_TIMEOUT", message: "stalled" });
  });

  it("sets done phase on a clean done frame", () => {
    const state = reduceUiMessageStream(INITIAL_STREAM_STATE, { type: "done", seq: 9, runId: RUN });
    expect(state.phase).toBe("done");
  });
});

describe("reduceUiMessageStream — a full interleaved run", () => {
  it("projects feed, body, and scorecard together", () => {
    const state = fold([
      { type: "thinking", seq: 1, runId: RUN, delta: "Researching." },
      { type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "running" },
      { type: "tool-use", seq: 3, runId: RUN, code: "serpFetch", status: "ok" },
      { type: "token-delta", seq: 4, runId: RUN, delta: "# Title\n" },
      { type: "token-delta", seq: 5, runId: RUN, delta: "Body." },
      { type: "gate", seq: 6, runId: RUN, stage: "stageB", score: 88, verdict: "PUBLISH" },
      { type: "done", seq: 7, runId: RUN },
    ]);
    expect(state.body).toBe("# Title\nBody.");
    expect(state.feed.filter((f) => f.kind === "tool-use")).toHaveLength(1);
    expect(state.feed.filter((f) => f.kind === "thinking")).toHaveLength(1);
    expect(state.scorecard).toMatchObject({ verdict: "PUBLISH", score: 88 });
    expect(state.phase).toBe("done");
  });
});
