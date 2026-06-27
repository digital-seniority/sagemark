/**
 * SSE relay (PR 007 / P0.W.4, lane worker-runtime).
 *
 * THE HOST HALF OF THE STREAMING HOP. The worker emits stable taxonomy-coded
 * events (`worker/emit.ts`); this relay turns them into a `text/event-stream`
 * `ReadableStream` the browser canvas consumes. It is the fragile two-hop seam
 * (worker -> Vercel -> browser, PRD runtime-fact 3), so it carries the disciplines
 * that keep it from silently stalling or losing a run:
 *
 *   HEARTBEAT / TIMEOUT (acceptance 4). If no worker event arrives within the
 *   heartbeat interval, the relay emits a `heartbeat` keep-alive; if none arrives
 *   within the harder STALL ceiling, it emits a terminal `error` (HEARTBEAT_TIMEOUT)
 *   and closes — a wedged worker surfaces as an explicit error row, never an
 *   indefinite spinner (the admin-app 8-day failure mode the PRD calls out).
 *
 *   TERMINAL ERROR (acceptance 4). A worker terminal error is forwarded as a
 *   single SSE `error` frame with a STABLE code, then the stream ends. The stream
 *   never hangs open after a terminal frame.
 *
 *   LAST_EVENT_ID TRUTH-SNAPSHOT RESUME (acceptance 5). On reconnect the relay
 *   does NOT replay from worker memory. It re-reads the PERSISTED `content_pieces`
 *   + `gate_results` rows (via the injected `TruthSnapshotReader`), emits ONE
 *   `snapshot` frame as the canonical artifact + scorecard, and then resumes
 *   streaming only the live deltas AFTER the client's `last_event_id` cursor — so
 *   there is no duplication (the client already has <= cursor) and no loss (the
 *   snapshot carries everything persisted, the resumed deltas carry everything
 *   after). The persisted row is the truth; the stream is a convenience.
 *
 * INJECTION-FIRST so Tier-1 unit tests exercise the relay logic with NO live
 * infra: the worker event source is an async iterable the test supplies; the
 * truth snapshot reader is an injected function; the clock + heartbeat timers are
 * injectable. The live wiring (real worker dispatch + Supabase reads) is the
 * route's job (`/api/run`) and a Tier-2/3 step.
 *
 * PURE-ISH: no Next APIs (returns a Web `ReadableStream` / `Response` the route
 * wraps), no DB import (reads go through the injected reader). Clean ASCII / UTF-8.
 */

import {
  serializeSseEvent,
  type SseEvent,
  type SnapshotEvent,
} from "./event-taxonomy";

// ── Truth snapshot (the persisted-row read seam, acceptance 5) ────────────────

/** The persisted artifact projection (a `content_pieces` row, the truth body). */
export interface PersistedPiece {
  pieceId: string;
  slug: string;
  title: string;
  body: string;
  status: string;
}

/**
 * The persisted scorecard projection (the truth scorecard). Per DR-039 this is
 * read from the persisted scorecard fields on the `content_pieces` /
 * `content_piece_versions` row (verdict + eval_score + dimensions) — there is NO
 * `gate_results` table; the row IS the authoritative scorecard.
 */
export interface PersistedScorecard {
  stageAVetoes: string[];
  score: number | null;
  verdict: string | null;
}

/** The truth snapshot for one run: the persisted artifact + scorecard. */
export interface TruthSnapshot {
  piece: PersistedPiece | null;
  scorecard: PersistedScorecard | null;
}

/**
 * Reads the persisted truth for a run, scoped by tenancy. The relay calls this on
 * a `last_event_id` reconnect to build the resume snapshot — it NEVER reconstructs
 * from worker memory (acceptance 5). The production impl reads the persisted
 * `content_pieces` row (which carries BOTH the truth body AND the truth scorecard
 * fields — verdict/eval_score/dimensions; there is no separate `gate_results`
 * table per DR-039) WHERE workspace_id = ? AND client_id = ? AND run_id = ? (the
 * tenancy scope is mandatory — see `/api/run`). Tests inject a fixture.
 */
export type TruthSnapshotReader = (scope: {
  workspaceId: string;
  clientId: string;
  runId: string;
}) => Promise<TruthSnapshot>;

// ── Relay configuration ───────────────────────────────────────────────────────

/** An async source of worker events (the worker emit sink, bridged to the host). */
export type WorkerEventSource = AsyncIterable<SseEvent>;

export interface RelayClock {
  /** Schedule `fn` after `ms`; returns a cancel handle. Injectable for tests. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** The default clock backed by setTimeout. */
export const REAL_CLOCK: RelayClock = {
  setTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface SseRelayConfig {
  /** Run identity + tenancy scope (mints into every frame's `runId` + snapshot read). */
  scope: { workspaceId: string; clientId: string; runId: string };
  /** The live worker event source. */
  source: WorkerEventSource;
  /** Reads the persisted truth snapshot on reconnect (acceptance 5). */
  truthReader: TruthSnapshotReader;
  /**
   * The client's `Last-Event-ID` on a reconnect (the highest `seq` it already has),
   * or null/undefined on a fresh connect. On reconnect the relay emits the truth
   * snapshot then resumes only deltas with `seq > lastEventId`.
   */
  lastEventId?: number | null;
  /** Heartbeat interval (ms) — emit a keep-alive if idle this long. Default 15s. */
  heartbeatMs?: number;
  /**
   * Hard stall ceiling (ms) — if no worker event arrives within this, emit a
   * terminal HEARTBEAT_TIMEOUT error and close (acceptance 4). Default 90s (the
   * single-piece run-budget ceiling, matching the bridge-JWT expiry).
   */
  stallMs?: number;
  /** Injectable clock (tests drive timers deterministically). */
  clock?: RelayClock;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
/** The run-budget ceiling — the single-piece generation cap (matches the JWT exp). */
export const RUN_BUDGET_CEILING_MS = 90_000;

// ── The core relay (string-frame generator, the unit-testable heart) ──────────

/**
 * The relay as an async generator of SSE WIRE FRAMES (strings). This is the heart
 * the Tier-1 test drives directly (no Response/stream plumbing needed): it yields
 * exactly the bytes that go on the wire, in order, so the test can assert event
 * ordering, the reconnect snapshot, no duplication/loss across the cursor, the
 * heartbeat, and the terminal error frame.
 *
 * Ordering contract:
 *   1. On reconnect (lastEventId != null): yield ONE `snapshot` frame first
 *      (the persisted truth), THEN only source events with `seq > lastEventId`.
 *   2. On fresh connect: yield every source event in order.
 *   3. A terminal `error` or `done` source event is yielded, then the generator
 *      RETURNS (the stream ends — never hangs open).
 *   4. If the source goes idle past `heartbeatMs`, yield a synthetic `heartbeat`;
 *      past `stallMs` with no event, yield a terminal `error` (HEARTBEAT_TIMEOUT)
 *      and return.
 *
 * The snapshot frame is given `seq = lastEventId` (it carries no NEW delta — it is
 * the cursor-aligned truth), so it can never be mistaken for a missed delta.
 */
export async function* relayFrames(config: SseRelayConfig): AsyncGenerator<string> {
  const {
    scope,
    source,
    truthReader,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    stallMs = RUN_BUDGET_CEILING_MS,
    clock = REAL_CLOCK,
  } = config;
  const lastEventId =
    config.lastEventId === null || config.lastEventId === undefined ? null : config.lastEventId;
  const isReconnect = lastEventId !== null;

  // 1. RECONNECT: emit the persisted truth snapshot FIRST (acceptance 5).
  if (isReconnect) {
    const snap = await truthReader(scope);
    const snapshotEvent: SnapshotEvent = {
      type: "snapshot",
      seq: lastEventId, // cursor-aligned: carries truth <= cursor, never a new delta
      runId: scope.runId,
      piece: snap.piece,
      scorecard: snap.scorecard
        ? {
            stageAVetoes: snap.scorecard.stageAVetoes,
            score: snap.scorecard.score,
            verdict: snap.scorecard.verdict,
          }
        : null,
    };
    yield serializeSseEvent(snapshotEvent);
  }

  // 2. Stream live events, applying the cursor filter + heartbeat/stall discipline.
  const iterator = source[Symbol.asyncIterator]();

  type RaceResult =
    | { kind: "event"; value: IteratorResult<SseEvent> }
    | { kind: "heartbeat" }
    | { kind: "stall" };

  // ONE in-flight `next()` pull, held across heartbeat iterations. Re-pulling the
  // iterator after a heartbeat would advance it and DROP an event — so we pull
  // once, tag the resolved value, and only re-pull after we consume an event.
  let pending: Promise<RaceResult> | null = null;
  const pull = (): Promise<RaceResult> =>
    iterator.next().then(
      (value): RaceResult => ({ kind: "event", value }),
      // A source error is treated as a stall-class terminal failure.
      (): RaceResult => ({ kind: "stall" }),
    );
  while (true) {
    if (!pending) pending = pull();

    // Race the in-flight event pull against the stall ceiling + heartbeat timer.
    let cancelHeartbeat: (() => void) | null = null;
    let cancelStall: (() => void) | null = null;

    const race = await new Promise<RaceResult>((resolve) => {
      let settled = false;
      const settle = (r: RaceResult) => {
        if (settled) return;
        settled = true;
        cancelHeartbeat?.();
        cancelStall?.();
        resolve(r);
      };
      cancelHeartbeat = clock.setTimer(() => settle({ kind: "heartbeat" }), heartbeatMs);
      cancelStall = clock.setTimer(() => settle({ kind: "stall" }), stallMs);
      pending!.then((r) => settle(r));
    });

    if (race.kind === "stall") {
      // Hard ceiling with no event -> terminal error, then end (acceptance 4).
      const errEvent: SseEvent = {
        type: "error",
        seq: nextLiveSeq(lastEventId),
        runId: scope.runId,
        code: "HEARTBEAT_TIMEOUT",
        message: `no worker event within the ${stallMs}ms stall ceiling — closing the stream (fail-loud, not a silent stall)`,
      };
      yield serializeSseEvent(errEvent);
      return;
    }

    if (race.kind === "heartbeat") {
      // Idle but not yet stalled -> keep-alive, then keep waiting on the SAME pull
      // (do NOT null `pending` — re-pulling would drop the next event).
      const hb: SseEvent = {
        type: "heartbeat",
        seq: lastEventId ?? -1, // heartbeats are not part of the gap-free delta cursor
        runId: scope.runId,
      };
      yield serializeSseEvent(hb);
      continue;
    }

    // race.kind === "event" — consume the pull; the next loop pulls fresh.
    pending = null;
    const { value, done } = race.value;
    if (done) {
      // Source ended without a terminal frame — close cleanly with `done`.
      const doneEvent: SseEvent = {
        type: "done",
        seq: nextLiveSeq(lastEventId),
        runId: scope.runId,
      };
      yield serializeSseEvent(doneEvent);
      return;
    }

    const event = value;

    // Defence-in-depth: never forward an event from another run.
    if (event.runId && event.runId !== scope.runId) {
      continue;
    }

    // CURSOR FILTER (acceptance 5 — no duplication): on reconnect, skip any delta
    // the client already has (seq <= lastEventId). Heartbeats/snapshots are not
    // gap-free deltas and are not subject to the filter.
    if (isReconnect && isCursoredDelta(event) && event.seq <= (lastEventId as number)) {
      continue;
    }

    yield serializeSseEvent(event);

    // A terminal frame ends the stream — never hang open after it (acceptance 4).
    if (event.type === "error" || event.type === "done") {
      return;
    }
  }
}

/** Events that participate in the gap-free `seq` cursor (subject to the resume filter). */
function isCursoredDelta(event: SseEvent): boolean {
  return event.type !== "heartbeat" && event.type !== "snapshot";
}

/** A synthetic seq for relay-generated terminal/done frames on a fresh-vs-reconnect stream. */
function nextLiveSeq(lastEventId: number | null): number {
  // On a fresh stream we don't know the worker's last seq here; use -1 to mark a
  // relay-synthesized frame (the browser keys terminal frames by type, not seq).
  return lastEventId === null ? -1 : lastEventId + 1;
}

// ── Web stream + Response plumbing (what the route returns) ────────────────────

const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Disable proxy buffering so frames flush immediately (the live-typing beat).
  "x-accel-buffering": "no",
};

/**
 * Bridge the string-frame generator to a Web `ReadableStream<Uint8Array>` —
 * the body the App Router route hands back. Each yielded frame is UTF-8 encoded
 * and enqueued; the stream closes when the generator returns.
 */
export function relayStream(config: SseRelayConfig): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = relayFrames(config);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await frames.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        // Last-ditch terminal error so the stream never dies silently.
        const message = err instanceof Error ? err.message : String(err);
        const fallback = serializeSseEvent({
          type: "error",
          seq: -1,
          runId: config.scope.runId,
          code: "RELAY_FAILED",
          message,
        });
        controller.enqueue(encoder.encode(fallback));
        controller.close();
      }
    },
    cancel() {
      void frames.return?.(undefined);
    },
  });
}

/** Wrap the relay stream in a `text/event-stream` Response (the route's return). */
export function relayResponse(config: SseRelayConfig): Response {
  return new Response(relayStream(config), { status: 200, headers: SSE_HEADERS });
}

/** Parse a `Last-Event-ID` header value into a numeric cursor, or null. */
export function parseLastEventId(headerValue: string | null | undefined): number | null {
  if (headerValue == null || headerValue === "") return null;
  const n = Number(headerValue);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
