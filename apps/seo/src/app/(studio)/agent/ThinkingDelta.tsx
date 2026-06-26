/**
 * ThinkingDelta — one agent-thinking row in the left zone (PR 010 / P1.U.1).
 *
 * Renders the coalesced thinking text from a `thinking` SSE event (the taxonomy's
 * muted-italic "the agent is reasoning" beat). The hook
 * (`use-ui-message-stream`) merges consecutive thinking deltas into ONE growing
 * `ThinkingItem`, so this component renders a single calm paragraph, not one row
 * per token.
 *
 * Presentational only. Colour from `currentColor` + opacity (no hardcoded palette,
 * matching VoiceSpecEditor / DraftResult). Clean ASCII / UTF-8.
 */

import type { ThinkingItem } from "@/lib/stream/use-ui-message-stream";

export interface ThinkingDeltaProps {
  item: ThinkingItem;
}

export function ThinkingDelta({ item }: ThinkingDeltaProps) {
  return (
    <p
      data-feed-kind="thinking"
      style={{
        margin: 0,
        fontStyle: "italic",
        fontSize: 13,
        lineHeight: 1.5,
        opacity: 0.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {item.text}
    </p>
  );
}

export default ThinkingDelta;
