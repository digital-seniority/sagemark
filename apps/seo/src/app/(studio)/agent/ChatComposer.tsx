"use client";

/**
 * ChatComposer — the agent zone's "mouth": the textarea + send affordance that
 * dispatches one conversation TURN (studio-ui, chat-first front door).
 *
 * THIS IS WHAT MAKES THE CANVAS CHAT-DRIVEN. On submit it hands the prompt to the
 * lifted `sendTurn` (the canvas owns the projected-state ownership via `useTurnStream`
 * — the POST-fetch-stream sibling of the EventSource hook). `sendTurn` POSTs
 * `/api/run` with EXACTLY `{ conversationId, clientId, prompt }` (the server binds
 * workspace + run-id + everything else — the composer cannot widen tenancy), streams
 * the relay response body, and folds the SAME taxonomy events into the SAME canvas
 * state every zone already renders from.
 *
 * INTERACTION (mirrors the house chat conventions):
 *   - Enter sends; Shift+Enter inserts a newline.
 *   - The textarea + button are DISABLED while a turn is in flight (the run is
 *     single-flight — one turn streams at a time), so a second submit can't race a
 *     live run. The send button shows the in-flight beat ("Running...").
 *   - Empty / whitespace-only prompts are a no-op (no dispatch).
 *
 * Presentational + a single callback — no stream/wire logic here (that is the hook).
 * Colour from `currentColor` + globals.css tokens (no hardcoded palette). Clean
 * ASCII / UTF-8.
 */

import { useRef, useState, type KeyboardEvent } from "react";

/** A next-best-action suggestion shown as a chip under the composer. */
export interface ComposerSuggestion {
  /** The chip label the operator sees. */
  label: string;
  /** The prompt the chip carries. */
  prompt: string;
  /**
   * When true the chip FILLS the textarea (and focuses it) so the operator can
   * finish the thought; otherwise it dispatches the turn immediately.
   */
  fill?: boolean;
}

export interface ChatComposerProps {
  /** Dispatch one turn with the composed prompt (the lifted `useTurnStream.sendTurn`). */
  onSend: (prompt: string) => void | Promise<void>;
  /** True while a turn streams — disables input + the send button (single-flight). */
  inFlight: boolean;
  /** Optional placeholder override (e.g. first turn vs a follow-up revision). */
  placeholder?: string;
  /**
   * Context-aware next-best-action chips (S1). Shown under the textarea while idle
   * so the operator always knows what to do next; empty/absent => no chips.
   */
  suggestions?: ComposerSuggestion[];
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

const CHIP: React.CSSProperties = {
  appearance: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  color: "inherit",
  background: "color-mix(in srgb, currentColor 7%, transparent)",
  border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
  borderRadius: 999,
  padding: "4px 10px",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export function ChatComposer({ onSend, inFlight, placeholder, suggestions = [] }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !inFlight;

  function pick(s: ComposerSuggestion) {
    if (inFlight) return;
    if (s.fill) {
      setValue(s.prompt);
      // Focus + place the cursor at the end so the operator can finish the thought.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
      return;
    }
    setValue("");
    void onSend(s.prompt);
  }

  function submit() {
    if (!canSend) return;
    // Optimistically clear the composer (the turn is now the live transcript beat).
    const prompt = trimmed;
    setValue("");
    void onSend(prompt);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter (or any modifier) inserts a newline / does nothing.
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      data-testid="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <textarea
        data-testid="chat-composer-input"
        ref={textareaRef}
        aria-label="Message the agent"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={inFlight}
        rows={3}
        placeholder={
          placeholder ??
          (inFlight
            ? "Agent is working..."
            : "Describe a page to write — or pick a suggestion below.")
        }
        style={{
          width: "100%",
          resize: "vertical",
          minHeight: 64,
          padding: "0.625rem 0.75rem",
          font: "inherit",
          fontSize: 14,
          lineHeight: 1.5,
          color: "inherit",
          background: "color-mix(in srgb, currentColor 4%, transparent)",
          border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
          borderRadius: 10,
          outlineColor: "currentColor",
          opacity: inFlight ? 0.6 : 1,
        }}
      />

      {/* Next-best-action chips (S1) — always-on guidance while idle. */}
      {!inFlight && suggestions.length > 0 && (
        <div data-testid="composer-suggestions" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              data-testid="composer-suggestion"
              title={s.fill ? "Fill the message — finish the thought, then send" : "Run this now"}
              onClick={() => pick(s)}
              style={CHIP}
            >
              <span aria-hidden="true" style={{ opacity: 0.7 }}>
                {s.fill ? "✎" : "→"}
              </span>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={SUBTLE} aria-hidden="true">
          Enter to send · Shift+Enter for a new line
        </span>
        <button
          type="submit"
          data-testid="chat-composer-send"
          disabled={!canSend}
          aria-disabled={!canSend}
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            padding: "0.5rem 1rem",
            borderRadius: 999,
            color: "inherit",
            background: "color-mix(in srgb, currentColor 10%, transparent)",
            border: "1px solid currentColor",
            cursor: canSend ? "pointer" : "not-allowed",
            opacity: canSend ? 1 : 0.4,
          }}
        >
          {inFlight ? "Running..." : "Send"}
        </button>
      </div>
    </form>
  );
}

export default ChatComposer;
