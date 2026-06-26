/**
 * ToolUseRow — one taxonomy-coded tool-use row in the left zone (PR 010 / P1.U.1).
 *
 * THE INJECTION-SURFACE DISCIPLINE MADE VISIBLE. The worker emits a `tool-use`
 * event keyed on a STABLE code (`serpFetch`, `runFaithfulnessGate`,
 * `runGate.stageB`, ...); the hook upserts it into a single row that transitions
 * `running -> ok | error` (spinner -> check / cross). This component renders that
 * row from the CODE + STATUS — never from free model prose (PRD 2 / acceptance 2).
 * The optional `label` is already sanitized upstream (e.g. "FAITHFUL 91%").
 *
 * The code -> human-readable phrase map lives HERE (the one place a coded beat
 * becomes operator-facing text), so a renamed code surfaces as a compile error,
 * not a silent blank row.
 *
 * Presentational only. Colour from `currentColor` + opacity. Clean ASCII / UTF-8.
 */

import type { ToolUseCode } from "@/lib/stream/event-taxonomy";
import type { ToolUseItem } from "@/lib/stream/use-ui-message-stream";

export interface ToolUseRowProps {
  item: ToolUseItem;
}

/** The one place a stable tool-use code becomes an operator-facing phrase. */
const TOOL_USE_LABELS: Record<ToolUseCode, string> = {
  serpFetch: "Fetching live sources",
  draftBody: "Drafting the body",
  persistPiece: "Saving the draft",
  runFaithfulnessGate: "Checking faithfulness",
  "runGate.stageA": "Stage-A veto pass",
  "runGate.stageB": "Stage-B scoring pass",
};

/** A glyph per lifecycle status (spinner -> check / cross). Text, not colour. */
const STATUS_GLYPH: Record<ToolUseItem["status"], string> = {
  running: "○", // ○ — in progress
  ok: "✓", // ✓ — done
  error: "✗", // ✗ — failed
};

export function ToolUseRow({ item }: ToolUseRowProps) {
  const phrase = TOOL_USE_LABELS[item.code] ?? item.code;
  const glyph = STATUS_GLYPH[item.status];
  const running = item.status === "running";

  return (
    <div
      data-feed-kind="tool-use"
      data-tool-code={item.code}
      data-status={item.status}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        lineHeight: 1.5,
        opacity: item.status === "error" ? 0.85 : 0.9,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 14,
          textAlign: "center",
          opacity: running ? 0.6 : 1,
          // The running glyph gets a gentle pulse; CSS keyframe is defined in
          // globals.css (`@keyframes studio-pulse`) so we avoid inline animation.
          animation: running ? "studio-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      >
        {glyph}
      </span>
      <span style={{ flex: 1 }}>{phrase}</span>
      {item.label && (
        <span
          data-testid="tool-label"
          style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, whiteSpace: "nowrap" }}
        >
          {item.label}
        </span>
      )}
    </div>
  );
}

export default ToolUseRow;
