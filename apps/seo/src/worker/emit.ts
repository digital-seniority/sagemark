/**
 * Worker-side event emitter (PR 007 / P0.W.4, lane worker-runtime).
 *
 * THE WORKER HALF OF THE STREAMING HOP. The Agent-SDK loop (`agent-worker.ts`)
 * yields raw SDK messages; this module TRANSLATES each one into the stable SSE
 * taxonomy (`event-taxonomy.ts`) and hands it to a sink. The host relay
 * (`sse-relay.ts`) consumes that sink and forwards the coded events to the
 * browser. The translation is the injection-surface discipline (acceptance 2):
 *
 *   - a tool-use message maps to a STABLE `tool-use` code (serpFetch,
 *     persistPiece, runFaithfulnessGate, runGate.stageA, runGate.stageB) — an
 *     UNKNOWN tool name is DROPPED, never forwarded as a free-text row. Raw model
 *     prose is never re-piped into the loop as a tool row.
 *   - assistant text deltas map to `token-delta` (the body "types in live").
 *   - thinking deltas map to `thinking`.
 *   - a gate tool result maps to a coded `gate` frame (Stage-A vetoes / Stage-B
 *     score+verdict).
 *
 * The emitter stamps a MONOTONIC, gap-free `seq` per run (the SSE `id:` /
 * `last_event_id` cursor) and the `runId` on every frame (defence-in-depth
 * against a crossed stream).
 *
 * PURE-ISH / ISOMORPHIC: imports only the taxonomy module. No Next APIs, no DB,
 * no SDK import (it consumes already-yielded messages, so Tier-1 tests drive it
 * with plain objects). Runs INSIDE the Sandbox. Clean ASCII / UTF-8.
 */

import {
  type SseEvent,
  type ToolUseCode,
  type ToolUseStatus,
  type GateStage,
  isToolUseCode,
} from "../lib/stream/event-taxonomy";

/** A sink the emitter pushes coded events into (the relay provides one). */
export type EventSink = (event: SseEvent) => void | Promise<void>;

// ── Stdout marker transport (the cross-PROCESS streaming hop, P-J) ─────────────
//
// In the Sandbox deployment the worker is a SEPARATE process from the host relay,
// so the only channel between them is the worker's stdout. The host dispatcher
// (`live-dispatcher.parseWorkerLine`) tails that stdout and re-codes each marker
// back into an `SseEvent`. This section is the WORKER half of that marker channel.
//
// THE INJECTION-SAFETY DISCIPLINE. A live model token can contain ANY bytes —
// including the literal string `::worker-token::`, a newline, or a fake JSON
// payload. If we wrote deltas verbatim the parser could be tricked into splitting
// a line early or mis-reading a forged marker. So every marker payload is
// `base64(JSON(payload))`: base64's alphabet (`A-Za-z0-9+/=`) contains NO space,
// NO newline, and NO `:` — so the encoded payload can never contain the marker
// prefix, can never break the newline framing, and round-trips losslessly. A
// malformed (non-base64 / non-JSON) payload is DROPPED by the parser, never
// forwarded as free text (the no-raw-prose-leak discipline holds end to end).

/** The rich live-delta marker kinds the worker pushes to stdout (P-J). */
export const WORKER_MARKER_KINDS = ["token", "tool", "thinking", "gate"] as const;
export type WorkerMarkerKind = (typeof WORKER_MARKER_KINDS)[number];

/** Base64-encode a UTF-8 string (Node `Buffer`, falling back to `btoa` shim). */
function base64Encode(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  // Isomorphic fallback (no Node Buffer): UTF-8 -> base64 via btoa.
  return btoa(unescape(encodeURIComponent(s)));
}

/**
 * Encode one rich-delta marker line for stdout. The payload is JSON-serialized
 * then base64-encoded so it is injection-safe (cannot contain `::`, a space, or a
 * newline) — see the discipline note above. The line is NOT newline-terminated;
 * the caller / sink adds the framing newline.
 */
export function encodeWorkerMarker(kind: WorkerMarkerKind, payload: unknown): string {
  return `::worker-${kind}:: ${base64Encode(JSON.stringify(payload))}`;
}

/** A line-writer the stdout sink emits marker lines through (default: process.stdout). */
export type MarkerWriter = (line: string) => void;

const defaultMarkerWriter: MarkerWriter = (line) => {
  // The worker's ONLY stdout output is markers — never bare prose (no-raw-prose
  // discipline). A trailing newline frames the line for the host's line buffer.
  if (typeof process !== "undefined" && process.stdout?.write) {
    process.stdout.write(line + "\n");
  } else {
    console.log(line);
  }
};

/**
 * Build an `EventSink` that serializes each coded `SseEvent` into a worker stdout
 * MARKER line (the cross-process transport). This is the bridge that lets the
 * existing `WorkerEventEmitter` + `emitFromSdkMessage` translation drive the
 * stdout channel: the SDK loop yields raw messages -> `emitFromSdkMessage` codes
 * them into `SseEvent`s -> this sink writes them as injection-safe markers ->
 * `live-dispatcher.parseWorkerLine` decodes them back into the SAME `SseEvent`s.
 *
 * Only the rich live-delta event types are projected to markers here
 * (`token-delta`/`thinking`/`tool-use`/`gate`). The run LIFECYCLE (session-id,
 * result, terminal/fatal errors) keeps its existing dedicated markers in
 * `entry.ts` — this sink does not duplicate them (a `done`/`error`/`heartbeat`/
 * `snapshot` event is ignored, so wiring it in cannot disturb the lifecycle
 * markers' content or ordering). The `seq`/`runId` envelope is dropped on the way
 * out (the host dispatcher re-stamps a fresh per-source envelope), so only the
 * event BODY needs to survive the hop.
 */
export function createStdoutMarkerSink(write: MarkerWriter = defaultMarkerWriter): EventSink {
  return (event: SseEvent) => {
    switch (event.type) {
      case "token-delta":
        write(encodeWorkerMarker("token", { delta: event.delta }));
        return;
      case "thinking":
        write(encodeWorkerMarker("thinking", { delta: event.delta }));
        return;
      case "tool-use":
        write(
          encodeWorkerMarker("tool", {
            code: event.code,
            status: event.status,
            label: event.label,
          }),
        );
        return;
      case "gate":
        write(
          encodeWorkerMarker("gate", {
            stage: event.stage,
            vetoes: event.vetoes,
            score: event.score ?? null,
            verdict: event.verdict ?? null,
          }),
        );
        return;
      // Lifecycle / transport-only frames are NOT marker-projected here — the
      // entry's dedicated lifecycle markers own those (session-id/result/error).
      case "done":
      case "error":
      case "heartbeat":
      case "snapshot":
        return;
      default:
        return;
    }
  };
}

/**
 * Distributive omit — applies `Omit` to EACH member of the union independently so
 * a `token-delta` partial keeps `delta`, a `tool-use` partial keeps `code`, etc.
 * (a plain `Omit<SseEvent, ...>` collapses the union to its shared keys).
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** One event minus the envelope fields the emitter stamps (`seq` + `runId`). */
type EventBody = DistributiveOmit<SseEvent, "seq" | "runId">;

/**
 * Map a raw Agent-SDK tool name to its stable taxonomy code, or null if it is
 * not a recognized host tool. An unrecognized tool is intentionally DROPPED
 * (acceptance 2) — the worker only ever has the curated host-tool surface, so an
 * unknown name means either a built-in (which must not appear) or noise; either
 * way it must never become a free-text row downstream.
 *
 * Handles the SDK MCP prefixing (`mcp__seo-worker-host-tools__persistPiece`) and
 * the bare gate-step aliases the suite skills use.
 */
export function toolNameToCode(rawName: string): ToolUseCode | null {
  // Strip the SDK MCP server prefix if present.
  const bare = rawName.replace(/^mcp__[^_]+(?:_[^_]+)*__/, "").replace(/^mcp__.*__/, "");
  const name = bare || rawName;

  // Direct taxonomy hits.
  if (isToolUseCode(name)) return name;

  // Known aliases the suite steps / kernel routes use.
  switch (name) {
    case "serp_fetch":
    case "serpFetch":
    case "fetchSerp":
      return "serpFetch";
    case "draftBody":
    case "draft_body":
      return "draftBody";
    case "persistPiece":
    case "draft": // the /content/api/draft route IS the persist tool
      return "persistPiece";
    case "runFaithfulnessGate":
    case "faithfulness":
      return "runFaithfulnessGate";
    case "runGateStageA":
    case "stageA":
      return "runGate.stageA";
    case "runGateStageB":
    case "stageB":
      return "runGate.stageB";
    default:
      return null;
  }
}

/**
 * Stateful per-run emitter. Owns the monotonic `seq` cursor so every frame is
 * gap-free and ordered. One instance == one run.
 */
export class WorkerEventEmitter {
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly sink: EventSink,
  ) {
    if (!runId) throw new Error("WorkerEventEmitter requires a runId (the per-run stream cursor key)");
  }

  /** The next event's `seq` (for tests / resume cursor inspection). */
  get nextSeq(): number {
    return this.seq;
  }

  private async push(partial: EventBody): Promise<number> {
    const seq = this.seq++;
    await this.sink({ ...(partial as object), seq, runId: this.runId } as SseEvent);
    return seq;
  }

  /** Emit a body/article token delta (the live-typing beat). */
  tokenDelta(delta: string): Promise<number> {
    return this.push({ type: "token-delta", delta });
  }

  /** Emit an agent-thinking delta (muted italic downstream). */
  thinking(delta: string): Promise<number> {
    return this.push({ type: "thinking", delta });
  }

  /**
   * Emit a coded tool-use row. The CODE is required and stable; a raw tool name
   * is mapped via `toolNameToCode` and DROPPED (returns null) if unrecognized —
   * the caller should check the return to know whether a row was emitted.
   */
  async toolUse(args: {
    code: ToolUseCode;
    status: ToolUseStatus;
    label?: string;
  }): Promise<number> {
    return this.push({ type: "tool-use", code: args.code, status: args.status, label: args.label });
  }

  /**
   * Translate a raw SDK tool name into a coded tool-use row. Returns the emitted
   * `seq`, or null if the tool name is not a recognized host tool (DROPPED — never
   * forwarded as free text). This is the acceptance-2 chokepoint.
   */
  async toolUseFromRawName(
    rawName: string,
    status: ToolUseStatus,
    label?: string,
  ): Promise<number | null> {
    const code = toolNameToCode(rawName);
    if (!code) return null;
    return this.toolUse({ code, status, label });
  }

  /** Emit a deterministic-gate result frame. */
  gate(args: {
    stage: GateStage;
    vetoes?: string[];
    score?: number | null;
    verdict?: string | null;
  }): Promise<number> {
    return this.push({
      type: "gate",
      stage: args.stage,
      vetoes: args.vetoes,
      score: args.score ?? null,
      verdict: args.verdict ?? null,
    });
  }

  /** Emit the terminal error frame (acceptance 4); the stream ends after this. */
  error(code: string, message: string): Promise<number> {
    return this.push({ type: "error", code, message });
  }

  /** Emit the clean end-of-run marker; the stream ends after this. */
  done(): Promise<number> {
    return this.push({ type: "done" });
  }

  /** Emit a keep-alive (the relay also injects these on its own timer). */
  heartbeat(): Promise<number> {
    return this.push({ type: "heartbeat" });
  }
}

/**
 * Translate ONE raw Agent-SDK message into zero-or-more coded events on the
 * emitter. Deliberately conservative: it recognizes the shapes the SDK yields
 * (assistant text deltas, thinking deltas, tool-use blocks, tool results) and
 * IGNORES anything it does not understand (no free-text passthrough). The shapes
 * are matched defensively because the SDK message schema is loosely typed.
 *
 * Returns the count of events emitted (for test assertions).
 */
export async function emitFromSdkMessage(
  emitter: WorkerEventEmitter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any,
): Promise<number> {
  if (!message || typeof message !== "object") return 0;
  let emitted = 0;

  // 1. A streamed assistant text delta (the body typing in).
  const textDelta: unknown =
    message.delta?.text ?? (message.type === "text_delta" ? message.text : undefined);
  if (typeof textDelta === "string" && textDelta.length > 0) {
    await emitter.tokenDelta(textDelta);
    emitted++;
  }

  // 2. A thinking delta.
  const thinkingDelta: unknown =
    message.delta?.thinking ?? (message.type === "thinking_delta" ? message.thinking : undefined);
  if (typeof thinkingDelta === "string" && thinkingDelta.length > 0) {
    await emitter.thinking(thinkingDelta);
    emitted++;
  }

  // 3. A tool-use block (the model invoked a host tool) -> a coded `running` row.
  const toolName: unknown = message.name ?? (message.type === "tool_use" ? message.tool : undefined);
  if (typeof toolName === "string" && (message.type === "tool_use" || message.name)) {
    const seq = await emitter.toolUseFromRawName(toolName, "running");
    if (seq !== null) emitted++;
  }

  // 4. A tool result for a known tool -> a coded `ok`/`error` row (+ gate frame).
  if (message.type === "tool_result" && typeof message.tool === "string") {
    const status: ToolUseStatus = message.is_error ? "error" : "ok";
    const seq = await emitter.toolUseFromRawName(message.tool, status);
    if (seq !== null) emitted++;
  }

  return emitted;
}
