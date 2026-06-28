"use client";

/**
 * StartConversationButton — "Start a new piece" (Slice 5 / P-I, lane studio-ui).
 *
 * THE NEW-THREAD AFFORDANCE on the studio home. It POSTs `/api/conversations` with
 * EXACTLY `{ clientId }` (the server binds the workspace + creates the row; the
 * button cannot widen tenancy), then on `{ conversationId }` navigates to
 * `/canvas?conversation=<id>` where the canvas mounts chat-first.
 *
 * The `clientId` is the SERVER-RESOLVED client the home page passed in (resolved from
 * the operator's workspace, never request input) — the button only forwards it.
 *
 * Single-flight: the button disables while the POST is in flight so a double-click
 * can't open two threads. A failed create surfaces a terse inline error and
 * re-enables the button. Colour from `currentColor` + globals.css tokens (no
 * hardcoded palette). `fetchImpl`/`onNavigate` are injectable for the jsdom test.
 * Clean ASCII / UTF-8.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface StartConversationButtonProps {
  /** The SERVER-RESOLVED client id (from the operator's workspace; never user input). */
  clientId: string;
  /** Optional project to open the new thread inside (Slice 5b). */
  projectId?: string | null;
  /** Button label (default "Start a new piece"). */
  label?: string;
  /** Compact styling for in-list use (e.g. inside a project card). */
  compact?: boolean;
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable navigation (tests). Defaults to the App Router `router.push`. */
  onNavigate?: (href: string) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "error"; message: string };

export function StartConversationButton({
  clientId,
  projectId = null,
  label = "Start a new piece",
  compact = false,
  fetchImpl,
  onNavigate,
}: StartConversationButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const starting = status.kind === "starting";

  async function start() {
    if (starting) return; // single-flight
    setStatus({ kind: "starting" });
    const doFetch = fetchImpl ?? fetch;
    try {
      const res = await doFetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The bound client id (+ optional project) — the server binds workspace + creates the row.
        body: JSON.stringify(projectId ? { clientId, projectId } : { clientId }),
      });
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: "Could not start a new piece. Please try again.",
        });
        return;
      }
      const body = (await res.json()) as { conversationId?: unknown };
      const conversationId =
        typeof body.conversationId === "string" ? body.conversationId : "";
      if (!conversationId) {
        setStatus({
          kind: "error",
          message: "Could not start a new piece. Please try again.",
        });
        return;
      }
      const href = `/canvas?conversation=${encodeURIComponent(conversationId)}`;
      if (onNavigate) onNavigate(href);
      else router.push(href);
      // Leave the button in `starting` while the route transition runs (it unmounts).
    } catch {
      setStatus({
        kind: "error",
        message: "Could not start a new piece. Please try again.",
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        data-testid="start-conversation"
        onClick={start}
        disabled={starting}
        aria-disabled={starting}
        style={{
          alignSelf: "flex-start",
          fontSize: compact ? 12 : 15,
          fontWeight: 600,
          letterSpacing: "0.01em",
          padding: compact ? "5px 11px" : "0.6rem 1.1rem",
          borderRadius: 999,
          color: compact ? "var(--foreground)" : "var(--background)",
          background: compact ? "transparent" : "var(--foreground)",
          border: compact ? "1px solid var(--line)" : "1px solid currentColor",
          cursor: starting ? "default" : "pointer",
          opacity: starting ? 0.6 : 1,
        }}
      >
        {starting ? "Starting…" : label}
      </button>
      {status.kind === "error" ? (
        <p role="alert" data-testid="start-error" style={{ fontSize: 13, opacity: 0.85, margin: 0 }}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

export default StartConversationButton;
