"use client";

/**
 * ConversationTranscript — the agent zone's "memory": the log of PRIOR turns above
 * the live run (studio-ui, chat-first front door).
 *
 * THE THREAD MADE VISIBLE. A conversation is an ordered turn log (migration 0040,
 * `seq` ascending): user turns + agent turns. This renders that history so the
 * operator sees the running dialogue; the IN-FLIGHT live turn renders BELOW this via
 * the existing `AgentMessageStream` (thinking + tool-use rows) — this component owns
 * only the PERSISTED past, never the live stream.
 *
 *   - USER turn  -> a right-leaning bubble of the operator's prompt.
 *   - AGENT turn -> a left-leaning bubble of the short reply content + (when the turn
 *     spawned a run that produced a draft) a verdict chip + a version badge.
 *
 * SOURCE. The turns come in via `initialTranscript` (server-passed on the first
 * canvas render), OR — when not provided — are loaded once on mount from
 * `GET /api/conversations/[id]?clientId=` (the transcript read route, P-G), which
 * returns `{ conversation, turns }`. Tenancy is the SERVER's: the only field we send
 * is `clientId`; the bound workspace + ownership are enforced route-side (a foreign
 * id 404s). A re-fetch after a completed turn keeps the log fresh (the canvas drives
 * that via the `version` key + a fresh `initialTranscript`).
 *
 * Presentational + a single mount fetch. Colour from `currentColor` + opacity (no
 * hardcoded palette). Clean ASCII / UTF-8.
 */

import { useEffect, useState } from "react";

/** A persisted turn (mirrors the `/api/conversations/[id]` `toTurnWire` projection). */
export interface TranscriptTurn {
  id: string;
  seq: number;
  role: "user" | "agent";
  content: string;
  /** Only an agent turn that spawned a worker run carries a run id. */
  runId: string | null;
  /** The content_piece version this turn produced, if any (drives the version badge). */
  pieceVersion: number | null;
  /** The eval verdict snapshot for this turn, if any (drives the verdict chip). */
  verdict: string | null;
  createdAt: string;
}

export interface ConversationTranscriptProps {
  /** The conversation whose transcript to render (also the mount-fetch [id]). */
  conversationId: string;
  /** The bound client (the only tenancy field sent on the mount fetch). */
  clientId: string;
  /**
   * Server-passed prior turns. When provided the component renders these directly and
   * does NOT fetch on mount. When omitted it loads once from the transcript route.
   */
  initialTranscript?: TranscriptTurn[];
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const SUBTLE: React.CSSProperties = { opacity: 0.55, fontSize: 12 };

/** Verdict band -> opacity weight (publish-grade reads strongest). No hardcoded hue. */
const VERDICT_OPACITY: Record<string, number> = {
  PUBLISH: 0.9,
  REVIEW: 0.75,
  REVISE: 0.6,
  REJECT: 0.45,
};

function VerdictChip({ verdict }: { verdict: string }) {
  return (
    <span
      data-testid="transcript-verdict"
      data-verdict={verdict}
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "1px 7px",
        borderRadius: 999,
        border: "1px solid currentColor",
        opacity: VERDICT_OPACITY[verdict] ?? 0.6,
        whiteSpace: "nowrap",
      }}
    >
      {verdict}
    </span>
  );
}

function TurnBubble({ turn, index = 0 }: { turn: TranscriptTurn; index?: number }) {
  const isUser = turn.role === "user";
  return (
    <li
      data-testid="transcript-turn"
      data-role={turn.role}
      data-seq={turn.seq}
      data-anim="fade-up"
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        animation: `studio-fade-up 0.35s ease ${Math.min(index * 55, 330)}ms both`,
      }}
    >
      <div
        style={{
          maxWidth: "88%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "0.5rem 0.75rem",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
          background: isUser
            ? "color-mix(in srgb, currentColor 9%, transparent)"
            : "color-mix(in srgb, currentColor 4%, transparent)",
        }}
      >
        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{turn.content}</span>
        {/* An agent turn that produced a draft carries a verdict chip + version badge. */}
        {turn.role === "agent" && (turn.verdict || turn.pieceVersion != null) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {turn.verdict && <VerdictChip verdict={turn.verdict} />}
            {turn.pieceVersion != null && (
              <span data-testid="transcript-version" style={SUBTLE}>
                v{turn.pieceVersion}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function ConversationTranscript({
  conversationId,
  clientId,
  initialTranscript,
  fetchImpl,
}: ConversationTranscriptProps) {
  // The fetch-on-mount path holds its own loaded turns; the server-passed path is
  // rendered DIRECTLY from the prop (no mirroring state -> no setState-in-effect).
  const [fetched, setFetched] = useState<{ turns: TranscriptTurn[] } | null>(null);

  useEffect(() => {
    // When the server passes the transcript, render it directly (no fetch, no state).
    if (initialTranscript != null) return;
    let cancelled = false;
    const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) return; // SSR / no fetch — render the loading/empty state.

    (async () => {
      try {
        const res = await doFetch(
          `/api/conversations/${encodeURIComponent(conversationId)}?clientId=${encodeURIComponent(clientId)}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          if (!cancelled) setFetched({ turns: [] });
          return;
        }
        const body = (await res.json()) as { turns?: TranscriptTurn[] };
        if (!cancelled) setFetched({ turns: Array.isArray(body.turns) ? body.turns : [] });
      } catch {
        // A failed transcript load leaves the empty state (the live run still works).
        if (!cancelled) setFetched({ turns: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, clientId, initialTranscript, fetchImpl]);

  // The server-passed prop wins; else the fetched turns; else null (still loading).
  const turns: TranscriptTurn[] | null =
    initialTranscript ?? (fetched ? fetched.turns : null);
  const loaded = initialTranscript != null || fetched != null;

  if (turns == null || turns.length === 0) {
    return (
      <p
        data-testid="transcript-empty"
        style={{ fontSize: 13, opacity: 0.45, margin: 0 }}
      >
        {loaded ? "No turns yet. Start the conversation below." : "Loading the conversation..."}
      </p>
    );
  }

  return (
    <ol
      data-testid="conversation-transcript"
      aria-label="Conversation transcript"
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}
    >
      {turns
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map((turn, i) => (
          <TurnBubble key={turn.id} turn={turn} index={i} />
        ))}
    </ol>
  );
}

export default ConversationTranscript;
