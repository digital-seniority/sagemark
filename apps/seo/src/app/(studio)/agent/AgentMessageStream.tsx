"use client";

/**
 * AgentMessageStream — the ordered live agent feed (PR 010 / P1.U.1).
 *
 * Renders the hook's projected `feed` (an interleaved list of coalesced thinking
 * rows + taxonomy-coded tool-use rows) top-to-bottom in arrival order, so the
 * operator watches the run think and act in real time. It reads ONLY the
 * already-projected `AgentFeedItem[]` (the SSE fold happened in
 * `use-ui-message-stream`) — it never touches the wire or raw prose.
 *
 * SCOPE (shell): this renders the rows that arrive. It does NOT stream tokens into
 * the editor (PR 011) — body `token-delta`s land in the artifact zone, not here.
 *
 * Presentational. Colour from `currentColor` + opacity. Clean ASCII / UTF-8.
 */

import type { AgentFeedItem, StreamPhase } from "@/lib/stream/use-ui-message-stream";
import { ThinkingDelta } from "./ThinkingDelta";
import { ToolUseRow } from "./ToolUseRow";
import { RunWarmup } from "./RunWarmup";

export interface AgentMessageStreamProps {
  feed: AgentFeedItem[];
  /** The run phase — drives the never-empty warmup while a run is starting (S2). */
  phase?: StreamPhase;
  /**
   * True while the turn POST is open (request-gated). Used as the primary warmup
   * trigger so RunWarmup shows from the moment the request is sent — not only once
   * the first SSE event flips phase to "streaming" (which happens 30-80s later,
   * after sandbox boot + strategy check).
   */
  inFlight?: boolean;
}

export function AgentMessageStream({ feed, phase = "idle", inFlight = false }: AgentMessageStreamProps) {
  const streaming = phase === "streaming" || inFlight;
  // The last narration item is the one actively receiving tokens — it gets the cursor.
  const lastNarrationId = feed.reduce<number | null>(
    (last, item) => (item.kind === "narration" ? item.id : last),
    null,
  );
  if (feed.length === 0) {
    // A run is live but no events have arrived yet (sandbox boot) — show the
    // lifecycle warmup instead of a dead box. Gate on inFlight (request-open)
    // so we cover the silent boot window; phase === "streaming" catches the
    // rare edge where a non-feed event (e.g. gate) arrives before any feed items.
    if (inFlight || phase === "streaming") {
      return <RunWarmup />;
    }
    // Post-run empty feed: the run completed (or errored) without producing
    // any agent activity visible in this feed.
    // - "error" is handled by AgentPanel's agent-error banner — return null here
    //   to avoid duplicating the message.
    // - "done" with no feed items means the run gated or exited silently. The
    //   inspector panel has the gate verdict, but it is collapsed by default so
    //   the user needs a visible nudge to look there.
    if (phase === "done") {
      return (
        <p
          data-testid="agent-done-no-output"
          style={{ fontSize: 13, opacity: 0.55, margin: 0, fontStyle: "italic" }}
        >
          Run finished with no activity — open the Gate panel (›› on the right) to
          see the result.
        </p>
      );
    }
    if (phase !== "idle") return null;
    return (
      <p
        data-testid="agent-feed-empty"
        style={{ fontSize: 13, opacity: 0.45, margin: 0 }}
      >
        Waiting for the agent to start the run...
      </p>
    );
  }

  return (
    <ol
      data-testid="agent-feed"
      aria-label="Agent activity"
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}
    >
      {feed.map((item) => (
        <li
          key={
            item.kind === "tool-use"
              ? `tool:${item.id}`
              : item.kind === "narration"
                ? `narr:${item.id}`
                : `think:${item.id}`
          }
        >
          {item.kind === "thinking" ? (
            <ThinkingDelta item={item} />
          ) : item.kind === "narration" ? (
            <p
              data-testid="agent-narration"
              data-anim="fade-up"
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.55,
                color: "currentColor",
                opacity: 0.85,
                whiteSpace: "pre-wrap",
                animation: "studio-fade-up 0.35s ease both",
                borderLeft: `2px solid ${streaming && item.id === lastNarrationId ? "var(--accent-blue)" : "transparent"}`,
                paddingLeft: 8,
                transition: "border-color 0.4s ease",
              }}
            >
              {item.text}
              {streaming && item.id === lastNarrationId && (
                <span
                  data-testid="stream-caret"
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: "1em",
                    verticalAlign: "text-bottom",
                    marginLeft: 2,
                    borderRadius: 1,
                    background: "var(--accent-blue)",
                    animation: "studio-blink 1s step-end infinite",
                  }}
                />
              )}
            </p>
          ) : (
            <ToolUseRow item={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

export default AgentMessageStream;
