"use client";

/**
 * SeoStudioCanvas — the three-zone operator canvas SHELL (PR 010 / P1.U.1).
 *
 * ADAPTED from videogen's `StudioCanvas` (DR-001): we keep the three-zone grid
 * shape (Agent | Artifact | Inspector), the responsive stack, the per-zone ARIA
 * `region` + `Cmd/Ctrl+1/2/3` focus jump, and the `data-zone` testing hooks — but
 * we STRIP every video coupling (scene selection, Remotion preview, version/render
 * polling, audit-finding navigation, ChatEdit) and re-point the canvas at a
 * markdown content_piece driven by the PR 007 SSE stream.
 *
 *   +------------------------------------------------------------------+
 *   |  Agent        |            Artifact                | Inspector    |
 *   |  (left)       |            (center)                | (right)      |
 *   |  live feed:   |   brief card · mode tabs · live    | gate         |
 *   |  thinking +   |   markdown editor (token-delta     | scorecard    |
 *   |  tool-use     |   stream / snapshot)               | (PR 011)     |
 *   +------------------------------------------------------------------+
 *
 * SSE WIRING (the load-bearing point). The canvas calls `useUiMessageStream({ url })`
 * which subscribes to the `/api/run` relay body and folds the STABLE taxonomy
 * events (`event-taxonomy.ts`: `token-delta` -> artifact body, `thinking` +
 * `tool-use` -> agent feed, `gate`/`snapshot` -> scorecard, `done`/`error` ->
 * phase). Every zone renders from that single projected state — never from raw
 * model prose (PRD 2 / acceptance 2).
 *
 * SCOPE. The P1.U.1 shell stubs are now FILLED (PR 011 / P1.U.2):
 *   - INSPECTOR internals — the real `InspectorPanel` gate scorecard (Stage-A
 *     vetoes + Stage-B bars + verdict band + piece-status; authoritative server
 *     gate vs. zero-credit client live preview).
 *   - Tokens streaming INTO an editor — the artifact's `MarkdownEditor` (the body
 *     types in live from the `token-delta` stream).
 *   Still ahead: the edit -> re-gate loop (PR 012), the version hub (PR 013).
 *
 * Colour from `currentColor` + opacity (no hardcoded palette, matching
 * VoiceSpecEditor / DraftResult). Clean ASCII / UTF-8.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useUiMessageStream,
  type UiMessageStreamState,
  type UseUiMessageStreamOptions,
} from "@/lib/stream/use-ui-message-stream";
import {
  useTurnStream,
  snapshotFromPersisted,
  type FetchLike,
  type PersistedDraft,
} from "@/lib/stream/post-turn-stream";
import { AgentPanel } from "./agent/AgentPanel";
import { ArtifactZone } from "./artifact/ArtifactZone";
import { InspectorPanel } from "./inspector/InspectorPanel";
import { InspectorRail } from "./inspector/InspectorRail";
import type { ContentBrief } from "./artifact/BriefCard";
import type { TranscriptTurn } from "./agent/ConversationTranscript";

/** localStorage key for the operator's collapsed/expanded Inspector preference. */
const INSPECTOR_COLLAPSED_KEY = "seo.inspectorCollapsed";
/** The narrow rail width (px) the inspector column shrinks to when collapsed. */
const INSPECTOR_RAIL_WIDTH = "48px";
/** The left agent column track (the mock's 322px). */
const AGENT_TRACK = "322px";
/** The docked-open inspector column track (the mock's 300px). */
const INSPECTOR_OPEN_TRACK = "300px";

/** The top-bar status dot colour per run phase (idle/streaming/done/error). */
const PHASE_DOT: Record<string, string> = {
  idle: "var(--muted)",
  streaming: "var(--accent-blue)",
  done: "var(--accent-green)",
  error: "var(--accent-red)",
};

/** The short top-bar phase caption. */
const PHASE_CAPTION: Record<string, string> = {
  idle: "Idle",
  streaming: "Drafting…",
  done: "Ready",
  error: "Error",
};

/** A small top-bar pill (client / phase). */
const TOPBAR_PILL: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 999,
  padding: "3px 9px",
  whiteSpace: "nowrap",
};

export interface SeoStudioCanvasProps {
  /**
   * The SSE endpoint for the active run (the `/api/run` relay). Null/undefined when
   * the canvas mounts before a run is dispatched — the canvas renders idle.
   *
   * LEGACY / one-shot GET path: when a `conversationId` + `clientId` are provided the
   * canvas drives the run via the chat composer (POST `/api/run`) instead, and this
   * EventSource URL is ignored.
   */
  streamUrl?: string | null;
  /** The resolved content brief for the run (server-passed), or null. */
  brief?: ContentBrief | null;
  /**
   * The CHAT-DRIVEN front door (studio-ui). When BOTH are present the composer owns
   * the run: it POSTs `/api/run` with `{ conversationId, clientId, prompt }` and the
   * canvas folds the streamed taxonomy into its projected state (the POST-fetch-stream
   * sibling of the EventSource path). Tenancy is the SERVER's: only these two ids +
   * the prompt are sent; the workspace + run-id are bound server-side.
   */
  conversationId?: string | null;
  clientId?: string | null;
  /** Server-passed prior turns for the transcript (omitted => transcript fetches on mount). */
  initialTranscript?: TranscriptTurn[];
  /** The client display name for the top bar (omitted => the pill is hidden). */
  clientName?: string | null;
  /** The signed-in operator's display name/email for the top bar (omitted => hidden). */
  operatorName?: string | null;
  /**
   * The linked piece id at mount (null before a draft exists). The canvas also
   * learns/refreshes it after each completed turn (the transcript read carries the
   * conversation's current pieceId). Drives the in-place edit save (Slice 3).
   */
  pieceId?: string | null;
  /**
   * The ON-DONE reconcile read (chat path). After a turn completes cleanly the canvas
   * calls this to read the conversation's PERSISTED current draft (body + scorecard) —
   * the persisted row is the truth, not the stream accumulation — and folds it back in
   * as a synthetic `snapshot` so the next turn's baseline is correct. Omitted => the
   * canvas only refreshes the transcript (no body re-fold). Injectable for tests.
   */
  reconcileDraft?: (info: {
    conversationId: string;
    clientId: string;
  }) => Promise<PersistedDraft | null>;
  /**
   * Test seam: inject a pre-projected stream state to render the canvas
   * deterministically with NO live EventSource (the SSR render smoke test uses
   * this). When provided it overrides the live hook's state.
   */
  injectedState?: UiMessageStreamState;
  /** Test seam: inject an EventSource factory forwarded to the legacy GET hook. */
  eventSourceFactory?: UseUiMessageStreamOptions["eventSourceFactory"];
  /** Test seam: inject the fetch used by the composer POST + transcript reads. */
  fetchImpl?: FetchLike;
}

const ZONE: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  outline: "none",
};

export function SeoStudioCanvas(props: SeoStudioCanvasProps) {
  const {
    streamUrl,
    brief = null,
    conversationId = null,
    clientId = null,
    initialTranscript,
    clientName = null,
    operatorName = null,
    pieceId: initialPieceId = null,
    reconcileDraft,
    injectedState,
    eventSourceFactory,
    fetchImpl,
  } = props;

  // CHAT-DRIVEN when both ids are present (and no explicit injected state overrides).
  const chatActive = Boolean(conversationId && clientId) && injectedState == null;

  // The current linked piece id. Seeded from the page (the conversation's pieceId at
  // mount) and refreshed after each completed turn from the transcript read — so an
  // in-place edit always targets the live draft, even one just created this session.
  const [pieceId, setPieceId] = useState<string | null>(initialPieceId);

  // The transcript the agent zone renders. The canvas re-reads it on each clean turn
  // completion (the persisted log is the truth); until then the server-passed
  // `initialTranscript` is shown. `refreshed` is null until the first on-done refresh,
  // so we never mirror the prop in state (no setState-in-effect).
  const [refreshed, setRefreshed] = useState<TranscriptTurn[] | null>(null);
  const transcript = refreshed ?? initialTranscript;

  // Refs that let the (memoized) reconcile callback read the LATEST projection +
  // dispatch without re-creating itself each render (avoids a stale closure on the
  // `turn` binding declared below). `dispatch` from useReducer is already stable, but
  // `lastSeq` changes every delta — the ref keeps it fresh.
  const lastSeqRef = useRef<number | null>(null);
  const dispatchRef = useRef<ReturnType<typeof useTurnStream>["dispatch"] | null>(null);

  // The ON-DONE reconcile: re-read the persisted transcript + draft, fold the draft
  // back as a synthetic snapshot so the next turn's baseline is the persisted truth.
  const onTurnComplete = useCallback(
    async (info: { conversationId: string; clientId: string }) => {
      // 1. Refresh the persisted transcript (the recorded agent turn now appears with
      //    its verdict + version) — the conversation/turn log is the truth.
      const doFetch =
        (fetchImpl as unknown as typeof fetch | undefined) ??
        (typeof fetch !== "undefined" ? fetch : null);
      if (doFetch) {
        try {
          const res = await doFetch(
            `/api/conversations/${encodeURIComponent(info.conversationId)}?clientId=${encodeURIComponent(info.clientId)}`,
            { headers: { accept: "application/json" } },
          );
          if (res.ok) {
            const body = (await res.json()) as {
              turns?: TranscriptTurn[];
              conversation?: { pieceId?: string | null };
            };
            if (Array.isArray(body.turns)) setRefreshed(body.turns);
            // Learn the (possibly newly-created) draft's piece id so an in-place
            // edit can target it without a page reload.
            const pid = body.conversation?.pieceId;
            if (typeof pid === "string" && pid) setPieceId(pid);
          }
        } catch {
          // A failed transcript refresh leaves the prior transcript in place.
        }
      }
      // 2. Reconcile the artifact body + scorecard to the PERSISTED draft (the row is
      //    truth, not the stream accumulation). Optional — only when a reader is wired.
      if (reconcileDraft) {
        try {
          const draft = await reconcileDraft(info);
          if (draft) {
            dispatchRef.current?.(
              snapshotFromPersisted(info.conversationId, lastSeqRef.current, draft),
            );
          }
        } catch {
          // A failed draft reconcile leaves the stream-accumulated body in place.
        }
      }
    },
    [fetchImpl, reconcileDraft],
  );

  // The POST-fetch projected state (chat path). Called unconditionally (rules of
  // hooks); inert when chat is not active (no `sendTurn` is ever invoked).
  const turn = useTurnStream({
    conversationId: conversationId ?? "",
    clientId: clientId ?? "",
    fetchImpl,
    onTurnComplete,
  });
  // Keep the reconcile-callback refs pointed at the latest projection + dispatch
  // (written in an effect, never during render — `dispatch` is stable, `lastSeq`
  // advances per delta; the reconcile reads them at on-done time).
  useEffect(() => {
    lastSeqRef.current = turn.state.lastSeq;
    dispatchRef.current = turn.dispatch;
  }, [turn.state.lastSeq, turn.dispatch]);

  // The legacy EventSource (GET) projected state — back-compat for the one-shot path.
  const live = useUiMessageStream({ url: streamUrl, eventSourceFactory });

  // Precedence: an injected test state wins; else the chat path; else the legacy GET.
  const state = injectedState ?? (chatActive ? turn.state : live);

  // Collapsible Inspector (agent-ui). DEFAULT FALSE — docked open while drafting.
  // The operator's choice persists to localStorage; we read it on mount in an
  // effect (NOT during render) so the SSR/first-paint markup is deterministic and
  // touching `localStorage` is guarded to the browser.
  //
  // NOTE: collapsing the Inspector is PURELY VISUAL. The publish gate is always
  // enforced server-side (`@sagemark/core` seo-gate via `/api/publish`); hiding
  // the scorecard never disables or bypasses the gate.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard.
    // SSR-safe hydration of a browser-only preference: the server (and the first
    // client render) use the docked-open default, then this mount effect syncs the
    // persisted choice in from localStorage. This IS the legitimate "synchronize
    // React state from an external system" case; we update only when the stored
    // value differs (so React bails out when it already matches), but the lint rule
    // flags any setState in an effect body, so we disable it narrowly here.
    try {
      const stored = window.localStorage.getItem(INSPECTOR_COLLAPSED_KEY);
      if (stored !== null) {
        const next = stored === "true";
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration (see comment above)
        setInspectorCollapsed((prev) => (prev === next ? prev : next));
      }
    } catch {
      // Private mode / disabled storage — fall back to the docked-open default.
    }
  }, []);

  function setCollapsed(next: boolean) {
    setInspectorCollapsed(next);
    if (typeof window === "undefined") return; // SSR guard.
    try {
      window.localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(next));
    } catch {
      // Persistence is best-effort; the in-memory state still updates.
    }
  }

  // Per-zone programmatic focus targets (Cmd/Ctrl + 1/2/3), ported from videogen.
  const agentRef = useRef<HTMLElement>(null);
  const artifactRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      let target: HTMLElement | null = null;
      if (e.key === "1") target = agentRef.current;
      else if (e.key === "2") target = artifactRef.current;
      else if (e.key === "3") target = inspectorRef.current;
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      data-testid="seo-studio-canvas"
      data-inspector-collapsed={inspectorCollapsed}
      style={{
        display: "grid",
        // Row 1 = the top bar (spans all columns); row 2 = the three zones. When
        // collapsed the inspector track shrinks to a narrow rail so the center
        // artifact (`1fr`) widens for reading. Purely a layout change.
        gridTemplateRows: "auto 1fr",
        gridTemplateColumns: `${AGENT_TRACK} 1fr ${
          inspectorCollapsed ? INSPECTOR_RAIL_WIDTH : INSPECTOR_OPEN_TRACK
        }`,
        height: "100dvh",
        width: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/*
        Top bar (the mock): a live status dot keyed on the run phase, the studio
        wordmark, the client + phase pills, and the signed-in operator. Client +
        operator pills render only when the page supplies them (the SSR smoke /
        injected-state path passes neither, so the bar degrades cleanly).
      */}
      <header
        data-testid="studio-topbar"
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <span
          aria-hidden="true"
          data-testid="studio-status-dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: PHASE_DOT[state.phase] ?? "var(--muted)",
            boxShadow: `0 0 8px ${PHASE_DOT[state.phase] ?? "transparent"}`,
          }}
        />
        <strong style={{ fontWeight: 600, fontSize: 13 }}>Sagemark Studio</strong>
        {clientName && <span style={TOPBAR_PILL}>{clientName}</span>}
        <span data-testid="studio-phase" data-phase={state.phase} style={{ ...TOPBAR_PILL, opacity: 0.9 }}>
          {PHASE_CAPTION[state.phase] ?? state.phase}
        </span>
        <span style={{ flex: 1 }} />
        {operatorName && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{operatorName} · operator</span>
        )}
      </header>

      <section
        ref={agentRef}
        tabIndex={-1}
        role="region"
        aria-label="Agent panel"
        aria-keyshortcuts="Control+1 Meta+1"
        data-zone="agent"
        style={{ ...ZONE, background: "var(--panel)", borderRight: "1px solid var(--line)", overflowY: "auto" }}
      >
        <AgentPanel
          phase={state.phase}
          feed={state.feed}
          error={state.error}
          chat={
            chatActive && conversationId && clientId
              ? {
                  conversationId,
                  clientId,
                  initialTranscript: transcript,
                  onSend: turn.sendTurn,
                  inFlight: turn.inFlight,
                  fetchImpl: fetchImpl as unknown as typeof fetch | undefined,
                }
              : null
          }
        />
      </section>

      <section
        ref={artifactRef}
        tabIndex={-1}
        role="region"
        aria-label="Artifact"
        aria-keyshortcuts="Control+2 Meta+2"
        data-zone="artifact"
        style={ZONE}
      >
        <ArtifactZone
          brief={brief}
          body={state.body}
          streaming={state.phase === "streaming"}
          scorecard={state.scorecard}
          clientId={clientId}
          pieceId={state.pieceId ?? pieceId}
          fetchImpl={fetchImpl as unknown as typeof fetch | undefined}
          onApplyEdit={
            chatActive
              ? (result) =>
                  // Fold the re-gated edit back as the persisted truth: the snapshot
                  // rule swaps the body + scorecard so the inspector verdict updates
                  // and the next edit re-bases on this body.
                  turn.dispatch(
                    snapshotFromPersisted(conversationId ?? "", lastSeqRef.current, {
                      piece: {
                        pieceId: state.pieceId ?? pieceId ?? "",
                        slug: brief?.slug ?? "",
                        title: brief?.title ?? "",
                        body: result.body,
                        status: "draft",
                      },
                      scorecard: {
                        stageAVetoes: result.vetoes,
                        score: result.score,
                        verdict: result.verdict,
                      },
                    }),
                  )
              : undefined
          }
        />
      </section>

      {/*
        The Inspector zone keeps its `data-zone="inspector"` + ARIA region + the
        Cmd/Ctrl+3 focus jump WHETHER COLLAPSED OR EXPANDED (the ref lives on this
        section, so the shortcut still focuses the region in either state). When
        collapsed it renders the narrow `InspectorRail`; expanded, the full panel
        with a collapse control. Collapsing is purely visual — the gate is always
        enforced server-side.
      */}
      <section
        ref={inspectorRef}
        tabIndex={-1}
        role="region"
        aria-label="Inspector"
        aria-keyshortcuts="Control+3 Meta+3"
        data-zone="inspector"
        data-collapsed={inspectorCollapsed}
        style={{
          ...ZONE,
          background: "var(--panel)",
          borderLeft: "1px solid var(--line)",
          overflowY: inspectorCollapsed ? "hidden" : "auto",
        }}
      >
        {inspectorCollapsed ? (
          <InspectorRail scorecard={state.scorecard} onExpand={() => setCollapsed(false)} />
        ) : (
          <InspectorPanel
            state={state}
            keyword={brief?.primaryKeyword ?? null}
            onCollapse={() => setCollapsed(true)}
          />
        )}
      </section>
    </div>
  );
}

export default SeoStudioCanvas;
