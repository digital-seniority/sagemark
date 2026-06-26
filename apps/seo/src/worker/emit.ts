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
