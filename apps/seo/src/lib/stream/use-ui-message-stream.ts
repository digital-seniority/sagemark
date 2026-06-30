"use client";

/**
 * use-ui-message-stream — the browser hook that turns the PR 007 SSE wire
 * contract into renderable UI state for the three-zone canvas (PR 010 / P1.U.1).
 *
 * THE CONSUMER HALF OF THE STREAMING HOP. The worker emits stable taxonomy-coded
 * events (`worker/emit.ts`); the host relay forwards them verbatim
 * (`lib/stream/sse-relay.ts`); THIS hook subscribes to the resulting
 * `text/event-stream` via `EventSource` and folds each coded event into a small,
 * render-ready `UiMessageStreamState`. The canvas reads that state by SHAPE, never
 * re-parses raw prose — the discipline the taxonomy enforces (PRD 2 / acceptance 2):
 * a `tool-use` row is keyed on its `code`, a `gate` frame on its `stage`, body text
 * arrives only as `token-delta` deltas. Free model prose never drives the UI.
 *
 * The fold is a PURE reducer (`reduceUiMessageStream`) so it is unit-tested with no
 * DOM and no live `EventSource` (the route + relay own the wire; this owns the
 * projection). The hook is a thin `EventSource` wrapper around that reducer.
 *
 * SCOPE (PR 010 — the SHELL): this projects the stream into
 *   - an ordered AGENT FEED (thinking deltas + tool-use rows) for the left zone,
 *   - the accumulated BODY text (token-deltas) for the artifact zone,
 *   - the latest GATE scorecard projection for the inspector,
 *   - a lifecycle phase (idle | streaming | done | error) + last error.
 * It does NOT stream tokens INTO the editor (PR 011), own the gate scorecard
 * internals (PR 011), or drive the edit loop (PR 012) — those later PRs read this
 * same state. A `snapshot` frame (reconnect resume, acceptance 5) replaces the body
 * + scorecard with the persisted truth, exactly as the relay intends.
 *
 * Clean ASCII / UTF-8.
 */

import { useEffect, useReducer } from "react";
import type {
  GateStage,
  SseEvent,
  ToolUseCode,
  ToolUseStatus,
} from "./event-taxonomy";

// ── UI projection shapes (what the canvas renders) ────────────────────────────

/** The agent-feed lifecycle phase the canvas badges the run with. */
export type StreamPhase = "idle" | "streaming" | "done" | "error";

/** One agent-thinking row (muted italic in the left zone). */
export interface ThinkingItem {
  kind: "thinking";
  /** Stable React key (the originating event `seq`, or a synthetic for merges). */
  id: number;
  /** Accumulated thinking text (consecutive thinking deltas coalesce into one row). */
  text: string;
}

/** One tool-use row (spinner -> check / cross), keyed on the stable taxonomy code. */
export interface ToolUseItem {
  kind: "tool-use";
  /** Stable React key: the tool-use `code` (rows update in place, never duplicate). */
  id: string;
  code: ToolUseCode;
  status: ToolUseStatus;
  /** Optional pre-sanitized short label (e.g. "FAITHFUL 91%"). Never raw prose. */
  label?: string;
  /** The `seq` of the latest event that touched this row (for stable ordering). */
  seq: number;
}

/**
 * One agent-narration row — the model's text output (planning/commentary) that
 * arrives as `token-delta` events between tool calls. Rendered in the agent
 * feed (left zone), NOT in the draft body (center zone), because in
 * standalone-author mode the article body comes from the `persistPiece` tool
 * argument, never from the token stream directly. Consecutive token-delta
 * events coalesce into a single growing row, same as thinking.
 */
export interface NarrationItem {
  kind: "narration";
  /** Stable React key (seq of the first delta in this coalesced row). */
  id: number;
  /** Accumulated narration text. */
  text: string;
}

/** An ordered agent-feed item (the left zone renders these top-to-bottom). */
export type AgentFeedItem = ThinkingItem | ToolUseItem | NarrationItem;

/** The latest gate scorecard projection (the inspector zone reads this). */
export interface GateScorecard {
  stage: GateStage;
  /** Stage-A veto codes that fired (empty when clean). */
  vetoes: string[];
  /** Stage-B composite 0-100, or null when a veto suppressed scoring. */
  score: number | null;
  /** The verdict band, or null when not yet computed. */
  verdict: string | null;
}

/** The full render-ready projection of one run's stream. */
export interface UiMessageStreamState {
  phase: StreamPhase;
  /** Ordered agent feed: thinking rows + tool-use rows, in arrival order. */
  feed: AgentFeedItem[];
  /** Article body — populated only by `snapshot` (reconcile after persistPiece). Empty during streaming. */
  body: string;
  /** The latest gate scorecard, or null until a gate/snapshot frame arrives. */
  scorecard: GateScorecard | null;
  /**
   * The persisted piece id, learned from a `snapshot` frame (reconnect / on-done
   * reconcile). Null until a snapshot arrives — the live token stream alone does
   * not carry it. Drives the in-place edit save (Slice 3): no pieceId, no save.
   */
  pieceId: string | null;
  /** The highest gap-free delta `seq` seen (the reconnect `last_event_id`). */
  lastSeq: number | null;
  /** The terminal error (code + message), or null. */
  error: { code: string; message: string } | null;
}

export const INITIAL_STREAM_STATE: UiMessageStreamState = {
  phase: "idle",
  feed: [],
  body: "",
  scorecard: null,
  pieceId: null,
  lastSeq: null,
  error: null,
};

// ── The pure reducer (the unit-tested heart) ──────────────────────────────────

/**
 * Fold one taxonomy event into the UI state. PURE — no React, no DOM, no clock —
 * so the projection is fully unit-testable from a fixture event list.
 *
 * Folding rules (one per event type in the taxonomy):
 *   - token-delta : coalesce into a trailing `narration` feed row (the model's
 *                   planning text); does NOT touch `body` — the article body
 *                   arrives via `persistPiece` → `snapshot`, not as tokens.
 *   - thinking    : coalesce consecutive thinking deltas into the trailing
 *                   thinking row (a new row only when the previous feed item is
 *                   not a thinking row), so the left zone shows one growing
 *                   thought, not one row per token.
 *   - tool-use    : upsert the row keyed on `code` (running -> ok/error updates in
 *                   place); never duplicate a code. New codes append in order.
 *   - gate        : replace `scorecard` with the latest stage's projection.
 *   - snapshot    : reconnect resume — REPLACE body + scorecard with the persisted
 *                   truth (the relay's cursor-aligned frame), leaving the live feed.
 *   - heartbeat   : no UI change (liveness only); does not advance the delta cursor.
 *   - error       : terminal — set phase=error + the stable error.
 *   - done        : terminal — set phase=done.
 */
export function reduceUiMessageStream(
  state: UiMessageStreamState,
  event: SseEvent,
): UiMessageStreamState {
  switch (event.type) {
    case "token-delta": {
      // Route narration text to the agent feed, NOT to `state.body`.
      // In standalone-author mode the article body comes from the persistPiece
      // tool argument (→ snapshot reconcile); token-deltas are model commentary.
      const last = state.feed[state.feed.length - 1];
      let feed: AgentFeedItem[];
      if (last && last.kind === "narration") {
        const merged: NarrationItem = { ...last, text: last.text + event.delta };
        feed = [...state.feed.slice(0, -1), merged];
      } else {
        feed = [...state.feed, { kind: "narration", id: event.seq, text: event.delta }];
      }
      return {
        ...state,
        phase: state.phase === "idle" ? "streaming" : state.phase,
        feed,
        lastSeq: maxSeq(state.lastSeq, event.seq),
      };
    }

    case "thinking": {
      const last = state.feed[state.feed.length - 1];
      let feed: AgentFeedItem[];
      if (last && last.kind === "thinking") {
        // Coalesce into the trailing thinking row.
        const merged: ThinkingItem = { ...last, text: last.text + event.delta };
        feed = [...state.feed.slice(0, -1), merged];
      } else {
        feed = [...state.feed, { kind: "thinking", id: event.seq, text: event.delta }];
      }
      return {
        ...state,
        phase: state.phase === "idle" ? "streaming" : state.phase,
        feed,
        lastSeq: maxSeq(state.lastSeq, event.seq),
      };
    }

    case "tool-use": {
      const existingIdx = state.feed.findIndex(
        (item) => item.kind === "tool-use" && item.id === event.code,
      );
      const row: ToolUseItem = {
        kind: "tool-use",
        id: event.code,
        code: event.code,
        status: event.status,
        label: event.label,
        seq: event.seq,
      };
      const feed =
        existingIdx >= 0
          ? state.feed.map((item, i) => (i === existingIdx ? row : item))
          : [...state.feed, row];
      return {
        ...state,
        phase: state.phase === "idle" ? "streaming" : state.phase,
        feed,
        lastSeq: maxSeq(state.lastSeq, event.seq),
      };
    }

    case "gate": {
      return {
        ...state,
        phase: state.phase === "idle" ? "streaming" : state.phase,
        scorecard: {
          stage: event.stage,
          vetoes: event.vetoes ?? [],
          score: event.score ?? null,
          verdict: event.verdict ?? null,
        },
        lastSeq: maxSeq(state.lastSeq, event.seq),
      };
    }

    case "snapshot": {
      // Reconnect resume (acceptance 5): the persisted row is the truth — replace
      // the body + scorecard with it, keep the live feed (deltas resume after).
      return {
        ...state,
        body: event.piece?.body ?? state.body,
        // Learn the piece id from the persisted truth (drives the in-place edit save).
        pieceId: event.piece?.pieceId ?? state.pieceId,
        scorecard: event.scorecard
          ? {
              // The snapshot scorecard has no single stage; treat a non-null score
              // as Stage-B truth, else Stage-A (vetoes-only) truth.
              stage: event.scorecard.score !== null ? "stageB" : "stageA",
              vetoes: event.scorecard.stageAVetoes,
              score: event.scorecard.score,
              verdict: event.scorecard.verdict,
            }
          : state.scorecard,
      };
    }

    case "heartbeat":
      // Liveness only — no UI change, and heartbeats are not gap-free deltas.
      return state;

    case "error":
      return {
        ...state,
        phase: "error",
        error: { code: String(event.code), message: event.message },
      };

    case "done":
      return { ...state, phase: "done" };

    default: {
      // Exhaustiveness guard: an unknown event type is a contract drift — ignore
      // it rather than corrupt the projection (the relay should never forward one).
      return state;
    }
  }
}

function maxSeq(current: number | null, next: number): number {
  if (typeof next !== "number" || !Number.isFinite(next) || next < 0) {
    return current ?? 0;
  }
  return current === null ? next : Math.max(current, next);
}

// ── Hook-internal reducer (event fold + a reset sentinel for stream re-open) ───

/**
 * A reset action drops the projection to its initial state (a fresh stream). The
 * POST-fetch path (`post-turn-stream.ts`) reuses this SAME action + reducer so both
 * the EventSource path and the composer's POST path fold IDENTICALLY (no taxonomy
 * duplication — `reduceUiMessageStream` is the one fold; this only adds `__reset`).
 */
export type StreamAction = SseEvent | { type: "__reset" };

export function streamReducer(
  state: UiMessageStreamState,
  action: StreamAction,
): UiMessageStreamState {
  if (action.type === "__reset") return INITIAL_STREAM_STATE;
  return reduceUiMessageStream(state, action);
}

// ── The React hook (a thin EventSource wrapper around the reducer) ─────────────

/** The set of taxonomy event-type channels the hook subscribes to on the source. */
const SUBSCRIBED_EVENT_TYPES = [
  "token-delta",
  "tool-use",
  "thinking",
  "gate",
  "snapshot",
  "heartbeat",
  "error",
  "done",
] as const;

export interface UseUiMessageStreamOptions {
  /**
   * The SSE endpoint to connect to (the PR 007 `/api/run` relay body). When
   * undefined the hook stays idle (the canvas mounts before a run is dispatched).
   */
  url?: string | null;
  /**
   * Test / SSR seam: inject an EventSource factory. Defaults to the global
   * `EventSource` in the browser. When neither is available (SSR / node test) the
   * hook no-ops and the state stays at its initial projection.
   */
  eventSourceFactory?: (url: string) => UiEventSource;
}

/**
 * The minimal EventSource surface the hook needs — narrowed so a test double need
 * only implement `addEventListener` + `close` (no full DOM EventSource).
 */
export interface UiEventSource {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

/**
 * Subscribe to a run's SSE stream and project it to render-ready UI state.
 *
 * Returns the live `UiMessageStreamState`. Re-renders only on a state change (the
 * reducer is the single source of truth). On `url` change the previous source is
 * closed and a fresh stream opens with a fresh projection.
 */
export function useUiMessageStream(
  options: UseUiMessageStreamOptions = {},
): UiMessageStreamState {
  const { url, eventSourceFactory } = options;
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM_STATE);

  useEffect(() => {
    if (!url) return;

    // A fresh stream opens a fresh projection (url change => reset, then subscribe).
    dispatch({ type: "__reset" });

    const factory =
      eventSourceFactory ??
      (typeof EventSource !== "undefined"
        ? (u: string) => new EventSource(u) as unknown as UiEventSource
        : null);
    if (!factory) return; // SSR / no EventSource — stay idle.

    const source = factory(url);
    const onEvent = (raw: { data: string }) => {
      let parsed: SseEvent;
      try {
        parsed = JSON.parse(raw.data) as SseEvent;
      } catch {
        return; // a malformed frame never corrupts the projection
      }
      dispatch(parsed);
    };
    for (const type of SUBSCRIBED_EVENT_TYPES) {
      source.addEventListener(type, onEvent);
    }

    return () => {
      source.close();
    };
    // A fresh url opens a fresh stream; the factory identity is stable per caller.
  }, [url, eventSourceFactory]);

  return state;
}
