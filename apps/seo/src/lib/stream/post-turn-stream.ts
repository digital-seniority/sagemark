"use client";

/**
 * post-turn-stream — the POST-fetch-stream consumer half for the chat composer
 * (studio-ui, chat-first front door).
 *
 * THE STREAM RECONCILIATION. The relay (`sse-relay.ts`) is a `text/event-stream`,
 * but the run entrypoint (`POST /api/run`, P-F) is a POST that RETURNS that stream
 * body — so the browser cannot use `EventSource` (GET-only). The composer therefore
 * POSTs `/api/run` with `{ conversationId, clientId, prompt }`, reads the streaming
 * response BODY via `fetch` + a `ReadableStream` reader, parses the SSE wire frames,
 * and folds each taxonomy event into the SAME projected state shape
 * `use-ui-message-stream` produces.
 *
 * NO TAXONOMY DUPLICATION. This module owns ONLY the wire-frame parsing (the
 * `text/event-stream` framing the `EventSource` path gets for free from the browser).
 * The actual EVENT FOLD is the SHARED, already-unit-tested pure reducer
 * `reduceUiMessageStream` + the hook-internal `streamReducer` (which adds the
 * `__reset` sentinel), both imported from `use-ui-message-stream.ts`. So the
 * EventSource path and this POST-fetch path fold IDENTICALLY; there is ONE
 * taxonomy fold in the codebase — here we add only the bytes->events parser + the
 * POST transport.
 *
 * ON-DONE RECONCILE-TO-PERSISTED. The stream is a convenience; the persisted row is
 * the truth (sse-relay header / acceptance 5). When a turn completes cleanly
 * (terminal `done`), the hook invokes the caller's `onTurnComplete` so the canvas
 * re-reads the persisted transcript + draft and folds the persisted body+scorecard
 * back in as a synthetic `snapshot` event — so the NEXT turn's "current draft"
 * baseline is the persisted truth, not the stream accumulation. The reducer's
 * existing `snapshot` rule does the body+scorecard swap.
 *
 * Clean ASCII / UTF-8.
 */

import { useCallback, useReducer, useRef, useState } from "react";
import {
  INITIAL_STREAM_STATE,
  streamReducer,
  type StreamAction,
  type UiMessageStreamState,
} from "./use-ui-message-stream";
import type { SnapshotEvent, SseEvent } from "./event-taxonomy";

// ── SSE wire-frame parsing (the bytes the EventSource path gets for free) ──────

/**
 * Parse the `data:` payloads out of a chunk of raw `text/event-stream` text into a
 * list of taxonomy events, returning any trailing partial frame so the caller can
 * prepend it to the next chunk.
 *
 * The wire format (one frame, see `serializeSseEvent`):
 *   id: <seq>\nevent: <type>\ndata: <json>\n\n
 * We key on the `data:` line only — the JSON payload already carries the `type`
 * discriminant the reducer dispatches on (so the `event:`/`id:` lines are redundant
 * projection input). A frame is terminated by a blank line (`\n\n`); a chunk may
 * split a frame, so we hold the remainder for the next read.
 *
 * PURE: no fetch, no DOM — unit-tested directly with fixture wire text.
 */
export function parseSseFrames(buffer: string): { events: SseEvent[]; rest: string } {
  // Normalize CRLF (defensive — some proxies rewrite line endings) then split on the
  // blank-line frame terminator. The LAST segment is a (possibly empty) partial.
  const normalized = buffer.replace(/\r\n/g, "\n");
  const segments = normalized.split("\n\n");
  const rest = segments.pop() ?? "";

  const events: SseEvent[] = [];
  for (const segment of segments) {
    if (segment.trim() === "") continue; // a stray blank frame (e.g. a leading \n\n)
    // Per the SSE spec a `data:` value MAY span multiple `data:` lines; our
    // serializer emits exactly one, but we concatenate defensively.
    const dataLines = segment
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""));
    if (dataLines.length === 0) continue; // a comment-only / id-only frame (no data)
    try {
      events.push(JSON.parse(dataLines.join("\n")) as SseEvent);
    } catch {
      // A malformed frame never corrupts the projection (mirrors the EventSource path).
    }
  }
  return { events, rest };
}

// ── The POST-fetch-stream driver (consume the relay body, fold via the reducer) ─

/** The minimal fetch surface the driver needs (injectable for tests). */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<ResponseLike>;

/** The minimal Response surface the driver reads (a body byte-stream reader). */
export interface ResponseLike {
  ok: boolean;
  status: number;
  body: { getReader(): StreamReaderLike } | null;
}

/** The minimal ReadableStream reader surface (chunk-by-chunk). */
export interface StreamReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array | string }>;
  cancel?(): void;
}

/** What the composer hands the driver to open one turn. */
export interface TurnRequest {
  conversationId: string;
  clientId: string;
  prompt: string;
}

/** Side-effect callbacks the driver fires as the stream folds. */
export interface TurnStreamCallbacks {
  /** Fold one parsed taxonomy event into the projected state. */
  onEvent: (event: SseEvent) => void;
  /** A transport failure BEFORE/DURING the stream (no SSE error frame arrived). */
  onTransportError: (message: string) => void;
}

/**
 * POST `/api/run` with the turn body, then stream the response body and fold each
 * parsed taxonomy event via `onEvent` (the caller wires it to the shared reducer).
 * Resolves when the stream closes (the `done`/`error` frame already folded, or the
 * body ended). A non-OK HTTP response (auth/tenancy/cost JSON error) is surfaced as
 * a transport error since it carries no SSE frame.
 *
 * Tenancy: the body is EXACTLY `{ conversationId, clientId, prompt }` — the server
 * binds workspace + run-id + everything else (route contract). We never send a
 * workspace id; the composer cannot widen tenancy by argument.
 */
export async function runTurnStream(
  request: TurnRequest,
  callbacks: TurnStreamCallbacks,
  options: { fetchImpl?: FetchLike; endpoint?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    callbacks.onTransportError("no fetch available in this environment");
    return;
  }
  const endpoint = options.endpoint ?? "/api/run";

  let response: ResponseLike;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      // The tenancy-minimal body — the server binds workspace + run-id + everything.
      body: JSON.stringify({
        conversationId: request.conversationId,
        clientId: request.clientId,
        prompt: request.prompt,
      }),
      signal: options.signal,
    });
  } catch (err) {
    callbacks.onTransportError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!response.ok) {
    callbacks.onTransportError(`run request failed (HTTP ${response.status})`);
    return;
  }
  if (!response.body) {
    callbacks.onTransportError("run response had no stream body");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // `value` is a Uint8Array in the browser; a test double may hand a string.
      buffer +=
        typeof value === "string"
          ? value
          : value
            ? decoder.decode(value, { stream: true })
            : "";
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) callbacks.onEvent(event);
    }
    // Flush any trailing complete frame the loop left buffered (no trailing \n\n).
    const tail = parseSseFrames(buffer + "\n\n");
    for (const event of tail.events) callbacks.onEvent(event);
  } catch (err) {
    callbacks.onTransportError(err instanceof Error ? err.message : String(err));
  } finally {
    reader.cancel?.();
  }
}

// ── The persisted-truth reconcile (on-done) ───────────────────────────────────

/** The persisted draft truth the canvas folds back in as a synthetic snapshot. */
export interface PersistedDraft {
  piece: SnapshotEvent["piece"];
  scorecard: SnapshotEvent["scorecard"];
}

/** Build a synthetic `snapshot` event from the persisted draft (reducer folds it). */
export function snapshotFromPersisted(
  runId: string,
  lastSeq: number | null,
  draft: PersistedDraft,
): SnapshotEvent {
  return {
    type: "snapshot",
    // A snapshot is cursor-aligned, never a NEW delta (see sse-relay): use the
    // highest seq the projection already saw so it can't be mistaken for a missed
    // delta if the reducer ever advances on it (it does not — snapshots are not deltas).
    seq: lastSeq ?? 0,
    runId,
    piece: draft.piece,
    scorecard: draft.scorecard,
  };
}

// ── The React hook the canvas/composer use ────────────────────────────────────

/** The chat-turn lifecycle the composer reads to disable/enable the send button. */
export interface UseTurnStreamResult {
  /** The projected stream state the three zones render (same shape as the EventSource hook). */
  state: UiMessageStreamState;
  /** True while a turn is in flight (POST open, stream not yet terminal). */
  inFlight: boolean;
  /** Dispatch one turn: reset the projection, POST, stream, fold, then reconcile. */
  sendTurn: (prompt: string) => Promise<void>;
  /** Fold one event into the projection directly (the canvas uses this for reconcile). */
  dispatch: (action: StreamAction) => void;
}

export interface UseTurnStreamOptions {
  conversationId: string;
  clientId: string;
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Injectable run endpoint (tests). Defaults to `/api/run`. */
  endpoint?: string;
  /**
   * Called after a turn completes CLEANLY (terminal `done`, not error). The canvas
   * re-reads the persisted transcript + draft here and folds the persisted body +
   * scorecard back via the returned `dispatch` — so the next turn's baseline is the
   * persisted truth. Receives the conversationId + clientId; the canvas owns the read.
   */
  onTurnComplete?: (info: { conversationId: string; clientId: string }) => void | Promise<void>;
}

/**
 * Own the projected state for a chat-driven run and expose `sendTurn`. This is the
 * POST-fetch sibling of `useUiMessageStream` (which is EventSource/GET): it folds the
 * SAME taxonomy via the SAME `streamReducer`, but the wire is a POST response body.
 */
export function useTurnStream(options: UseTurnStreamOptions): UseTurnStreamResult {
  const { conversationId, clientId, fetchImpl, endpoint, onTurnComplete } = options;
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM_STATE);
  const [inFlight, setInFlight] = useState(false);
  // A ref guards a double submit racing the async state flip.
  const inFlightRef = useRef(false);

  const sendTurn = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || inFlightRef.current) return;
      inFlightRef.current = true;
      setInFlight(true);

      // A fresh turn opens a fresh projection (the SAME reset the EventSource hook
      // uses on url change — we reuse the hook-internal `__reset` sentinel).
      dispatch({ type: "__reset" });

      let endedClean = false;
      await runTurnStream(
        { conversationId, clientId, prompt: trimmed },
        {
          onEvent: (event) => {
            if (event.type === "done") endedClean = true;
            if (event.type === "error") endedClean = false;
            dispatch(event);
          },
          onTransportError: (message) => {
            // Surface a transport failure as the SAME terminal error row the relay
            // would emit (a failed POST is never a dead spinner — acceptance 4).
            dispatch({
              type: "error",
              seq: -1,
              runId: conversationId,
              code: "RELAY_FAILED",
              message,
            });
            endedClean = false;
          },
        },
        { fetchImpl, endpoint },
      );

      inFlightRef.current = false;
      setInFlight(false);

      // ON-DONE RECONCILE: only on a CLEAN completion (a failed turn keeps its error
      // row + partial body so the operator sees what happened).
      if (endedClean) {
        await onTurnComplete?.({ conversationId, clientId });
      }
    },
    [conversationId, clientId, fetchImpl, endpoint, onTurnComplete],
  );

  return { state, inFlight, sendTurn, dispatch };
}
