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
}

export function AgentMessageStream({ feed, phase = "idle" }: AgentMessageStreamProps) {
  if (feed.length === 0) {
    // A run is live but no events have arrived yet (sandbox boot) — show the
    // lifecycle warmup instead of a dead box. Idle (no run) keeps the quiet hint.
    if (phase === "streaming") {
      return <RunWarmup />;
    }
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
        <li key={item.kind === "tool-use" ? `tool:${item.id}` : `think:${item.id}`}>
          {item.kind === "thinking" ? (
            <ThinkingDelta item={item} />
          ) : (
            <ToolUseRow item={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

export default AgentMessageStream;
