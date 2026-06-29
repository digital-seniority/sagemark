"use client";

/**
 * AgentPanel — the LEFT zone of the three-zone studio canvas. RECOMPOSED for the
 * chat-first front door (studio-ui): the rail is now a full conversational surface.
 *
 * The body, top-to-bottom:
 *   1. a HEADER (run phase badge),
 *   2. the CONVERSATION TRANSCRIPT (prior turns — user bubbles + agent turns with a
 *      verdict chip + version badge),
 *   3. the live `AgentMessageStream` (the IN-FLIGHT turn's thinking + tool-use rows),
 *      reused VERBATIM — the SSE fold lives in the stream hooks, this only renders,
 *   4. a terminal-ERROR row when the stream ends in error (acceptance 4 made visible:
 *      a wedged/failed run surfaces an explicit row, never a dead spinner),
 *   5. the `ChatComposer` (the textarea + send that dispatches the next turn).
 *
 * BACK-COMPAT. The chat surface (transcript + composer) renders ONLY when the canvas
 * passes a `chat` handle (`conversationId` + `clientId` + the lifted `onSend`/`inFlight`).
 * The SSR render-smoke + injected-state paths (`canvas-render.test.tsx`) pass no chat
 * handle, so the panel renders exactly as before (header + feed + error row) — the
 * shell shape is preserved.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

import type {
  AgentFeedItem,
  StreamPhase,
} from "@/lib/stream/use-ui-message-stream";
import { AgentMessageStream } from "./AgentMessageStream";
import {
  ConversationTranscript,
  type TranscriptTurn,
} from "./ConversationTranscript";
import { ChatComposer, type ComposerSuggestion } from "./ChatComposer";
import { StudioWelcome } from "./StudioWelcome";

/** The chat handle the canvas lifts down so the composer drives the run. */
export interface AgentChatHandle {
  conversationId: string;
  clientId: string;
  /** Server-passed prior turns; omitted => the transcript fetches on mount. */
  initialTranscript?: TranscriptTurn[];
  /** Dispatch one turn (the lifted `useTurnStream.sendTurn`). */
  onSend: (prompt: string) => void | Promise<void>;
  /** True while a turn streams (disables the composer — single-flight). */
  inFlight: boolean;
  /** Context-aware next-best-action chips for the composer (S1). */
  suggestions?: ComposerSuggestion[];
  /** True while the one-click "Author the whole hub" loop is running (S3). */
  autoAuthorAll?: boolean;
  /** Stop the author-all loop (S3) — shown in the banner, works mid-run. */
  onStopAuthorAll?: () => void;
  /** Injectable fetch forwarded to the transcript's mount load (tests). */
  fetchImpl?: typeof fetch;
}

export interface AgentPanelProps {
  /** The run's lifecycle phase (idle | streaming | done | error). */
  phase: StreamPhase;
  /** The ordered agent feed (thinking + tool-use rows) from the hook. */
  feed: AgentFeedItem[];
  /** The terminal error (code + message) when `phase === "error"`, else null. */
  error?: { code: string; message: string } | null;
  /**
   * The chat surface handle. PRESENT => render the transcript + composer (the
   * chat-driven canvas). ABSENT => the feed-only shell (SSR smoke / injected state).
   */
  chat?: AgentChatHandle | null;
}

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle: "Idle",
  streaming: "Running",
  done: "Done",
  error: "Error",
};

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export function AgentPanel({ phase, feed, error, chat = null }: AgentPanelProps) {
  // First-run: a chat-driven canvas whose transcript is KNOWN-empty (a server-passed
  // empty array, not the undefined fetch-on-mount case) AND no live feed yet -> show
  // the warm guidance instead of the bare empty strings. When initialTranscript is
  // undefined the transcript must still mount to fetch, so the welcome stays hidden.
  const showWelcome =
    chat != null &&
    chat.initialTranscript != null &&
    chat.initialTranscript.length === 0 &&
    feed.length === 0;

  return (
    <div
      data-zone-body="agent"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: "1rem", height: "100%" }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
          Agent
        </p>
        <span
          data-testid="run-phase"
          data-phase={phase}
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid currentColor",
            opacity: phase === "idle" ? 0.4 : 0.8,
          }}
        >
          {PHASE_LABEL[phase]}
        </span>
      </header>

      {/* The scrollable thread: prior turns (transcript) then the live turn (feed),
          or the first-run welcome when the conversation is brand new. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {showWelcome && chat ? (
          <StudioWelcome onPick={chat.onSend} />
        ) : (
          <>
            {chat && (
              <ConversationTranscript
                conversationId={chat.conversationId}
                clientId={chat.clientId}
                initialTranscript={chat.initialTranscript}
                fetchImpl={chat.fetchImpl}
              />
            )}
            {/* The IN-FLIGHT live turn — reused verbatim (thinking + tool-use rows). */}
            <AgentMessageStream feed={feed} phase={phase} />
          </>
        )}
      </div>

      {phase === "error" && error && (
        <div
          role="alert"
          data-testid="agent-error"
          style={{
            fontSize: 12,
            padding: "0.625rem 0.75rem",
            border: "1px solid currentColor",
            borderRadius: 8,
            background: "color-mix(in srgb, currentColor 8%, transparent)",
          }}
        >
          <strong>{error.code}</strong>
          <span style={{ ...SUBTLE, display: "block", marginTop: 2 }}>{error.message}</span>
        </div>
      )}

      {/* One-click author-all status + stop (S3) — visible even while a run is in
          flight (the composer chips are hidden mid-run, so Stop lives here). */}
      {chat?.autoAuthorAll && (
        <div
          data-testid="author-all-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 12,
            padding: "0.5rem 0.7rem",
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--accent-blue) 40%, var(--line))",
            background: "color-mix(in srgb, var(--accent-blue) 10%, transparent)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent-blue)",
                animation: "studio-pulse 1.2s ease-in-out infinite",
              }}
            />
            Authoring the whole hub…
          </span>
          <button
            type="button"
            data-testid="author-all-stop"
            onClick={chat.onStopAuthorAll}
            style={{
              appearance: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 11.5,
              fontWeight: 600,
              color: "inherit",
              background: "transparent",
              border: "1px solid currentColor",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            Stop
          </button>
        </div>
      )}

      {/* The composer — the mouth. Only on the chat-driven canvas. */}
      {chat && (
        <ChatComposer onSend={chat.onSend} inFlight={chat.inFlight} suggestions={chat.suggestions} />
      )}
    </div>
  );
}

export default AgentPanel;
