/**
 * SSE event taxonomy (PR 007 / P0.W.4, lane worker-runtime).
 *
 * THE STABLE WIRE CONTRACT for the streaming hop (worker -> apps/seo -> browser).
 * Every event the relay forwards downstream carries one of these STABLE codes —
 * never raw model prose re-piped into the loop (PRD 2 / acceptance 2). The
 * worker translates Agent-SDK messages into these coded events (`emit.ts`); the
 * relay forwards them verbatim; the browser canvas (PR 010/011) reads them by
 * code. A renamed/dropped code is a breaking change, caught by the unit test.
 *
 * Two layers of stability:
 *   1. The SSE EVENT TYPE (the `event:` line) — the coarse channel a consumer
 *      subscribes to: `token-delta`, `tool-use`, `thinking`, `gate`, `error`,
 *      `heartbeat`, `done`, `snapshot`.
 *   2. The TOOL-USE CODE + GATE CODE — the fine taxonomy inside a `tool-use` /
 *      `gate` event (`serpFetch`, `runFaithfulnessGate`, `runGate.stageA`,
 *      `runGate.stageB`, ...). These are the rows the LEFT panel renders as
 *      spinner -> check; they are an injection-surface discipline (the panel
 *      reads codes, not free text).
 *
 * PURE + ISOMORPHIC: no Next APIs, no DB, no `server-only` marker — imported by
 * the host relay, the worker emitter, AND the browser. Clean ASCII / UTF-8.
 */

// ── SSE event types (the coarse `event:` channels) ────────────────────────────

/**
 * The stable set of SSE event types the relay emits. The browser's `EventSource`
 * subscribes to these by name. `snapshot` is the truth-snapshot frame replayed on
 * a `last_event_id` reconnect (acceptance 5); `heartbeat` is the silent-stall guard
 * (acceptance 4); `error` is the terminal failure (acceptance 4); `done` closes
 * the stream cleanly.
 */
export const SSE_EVENT_TYPES = [
  "token-delta", // an article/body token delta (the "types in live" beat)
  "tool-use", // a taxonomy-coded tool-use row (spinner -> check)
  "thinking", // an agent-thinking delta (muted italic in the canvas)
  "gate", // a deterministic-gate result frame (Stage-A / Stage-B)
  "snapshot", // the persisted truth-snapshot replayed on reconnect
  "heartbeat", // keep-alive; proves the stream is live, not wedged
  "error", // terminal error with a stable code (stream ends)
  "done", // clean end-of-run marker (stream ends)
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

// ── Tool-use codes (the fine taxonomy inside a `tool-use` event) ───────────────

/**
 * The stable tool-use codes the worker emits and the canvas renders as coded
 * rows. These are the named beats from PRD 2 ("serpFetch ✓", "runFaithfulnessGate
 * ✓", "runGate -> Stage-A clean", "runGate -> Stage-B 83 REVIEW") plus the
 * persist mutation. A `tool-use` event whose `code` is outside this set is a
 * contract violation (the relay refuses it rather than forwarding raw prose).
 */
export const TOOL_USE_CODES = [
  "serpFetch", // live SERP / source fetch (the brief's first tool call)
  "draftBody", // body drafting in progress (streaming...)
  "persistPiece", // the host-validated content_pieces write (the only mutation)
  "persistStrategy", // the host-validated projects.strategy write (hub skill, Slice 2)
  "requestImages", // per-page image request emitted during hub authoring (hub skill, Slice 6)
  "runFaithfulnessGate", // the drafter!=verifier faithfulness check
  "runGate.stageA", // deterministic Stage-A veto pass
  "runGate.stageB", // deterministic Stage-B 8-dimension scoring pass
] as const;

export type ToolUseCode = (typeof TOOL_USE_CODES)[number];

/** A tool-use row's lifecycle status (spinner -> check / cross). */
export const TOOL_USE_STATUSES = ["running", "ok", "error"] as const;
export type ToolUseStatus = (typeof TOOL_USE_STATUSES)[number];

// ── Gate codes (the fine taxonomy inside a `gate` event) ──────────────────────

/** Which stage of the deterministic gate a `gate` event reports. */
export const GATE_STAGES = ["stageA", "stageB"] as const;
export type GateStage = (typeof GATE_STAGES)[number];

// ── Event payload shapes (what rides in the `data:` line) ─────────────────────

/** Common envelope fields every relayed event carries. */
export interface SseEnvelope {
  /** Monotonic, gap-free per-run cursor (the `id:` line / `last_event_id`). */
  seq: number;
  /** The run this event belongs to (defence-in-depth against a crossed stream). */
  runId: string;
}

export interface TokenDeltaEvent extends SseEnvelope {
  type: "token-delta";
  /** The article/body token text fragment. */
  delta: string;
}

export interface ToolUseEvent extends SseEnvelope {
  type: "tool-use";
  code: ToolUseCode;
  status: ToolUseStatus;
  /** Optional short, already-sanitized label (e.g. "FAITHFUL 91%"). Never raw prose. */
  label?: string;
}

export interface ThinkingEvent extends SseEnvelope {
  type: "thinking";
  delta: string;
}

export interface GateEvent extends SseEnvelope {
  type: "gate";
  stage: GateStage;
  /** Stage-A veto codes that fired (empty when clean). */
  vetoes?: string[];
  /** Stage-B composite 0-100, or null when a Stage-A veto suppressed scoring. */
  score?: number | null;
  /** The verdict band string (PUBLISH / REVIEW / REVISE / REJECT), if computed. */
  verdict?: string | null;
}

export interface SnapshotEvent extends SseEnvelope {
  type: "snapshot";
  /** The persisted artifact (content_pieces row projection) — the truth body. */
  piece: {
    pieceId: string;
    slug: string;
    title: string;
    body: string;
    status: string;
  } | null;
  /** The persisted scorecard (gate_results projection) — the truth scorecard. */
  scorecard: {
    stageAVetoes: string[];
    score: number | null;
    verdict: string | null;
  } | null;
}

export interface HeartbeatEvent extends SseEnvelope {
  type: "heartbeat";
}

/** Stable terminal-error codes (acceptance 4). The stream ends after one of these. */
export const SSE_ERROR_CODES = [
  "WORKER_TIMEOUT", // the worker loop exceeded its wedge ceiling
  "WORKER_LOOP_FAILED", // the worker loop threw
  "HEARTBEAT_TIMEOUT", // no worker event within the heartbeat ceiling (silent stall)
  "COST_CAP_EXCEEDED", // pre-flight cost reservation tripped (no dispatch)
  "RELAY_FAILED", // the host relay itself failed
] as const;

export type SseErrorCode = (typeof SSE_ERROR_CODES)[number];

export interface ErrorEvent extends SseEnvelope {
  type: "error";
  code: SseErrorCode | string;
  message: string;
}

export interface DoneEvent extends SseEnvelope {
  type: "done";
}

/** The discriminated union of every event the relay forwards downstream. */
export type SseEvent =
  | TokenDeltaEvent
  | ToolUseEvent
  | ThinkingEvent
  | GateEvent
  | SnapshotEvent
  | HeartbeatEvent
  | ErrorEvent
  | DoneEvent;

// ── Guards (the relay's "is this a legal coded event?" check) ─────────────────

export function isToolUseCode(value: unknown): value is ToolUseCode {
  return typeof value === "string" && (TOOL_USE_CODES as readonly string[]).includes(value);
}

export function isSseEventType(value: unknown): value is SseEventType {
  return typeof value === "string" && (SSE_EVENT_TYPES as readonly string[]).includes(value);
}

// ── SSE wire serialization (the on-the-wire framing) ──────────────────────────

/**
 * Serialize one event to the SSE wire format. Every frame carries:
 *   - `id:`    the per-run `seq` (becomes the browser's `last_event_id` on reconnect)
 *   - `event:` the stable event type
 *   - `data:`  the JSON payload (single line — no embedded newlines after JSON.stringify)
 *
 * The trailing blank line terminates the frame. This is the ONE place the wire
 * format is defined, so the relay and any test framer agree byte-for-byte.
 */
export function serializeSseEvent(event: SseEvent): string {
  const data = JSON.stringify(event);
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${data}\n\n`;
}
