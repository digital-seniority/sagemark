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

import { useEffect, useRef } from "react";
import {
  useUiMessageStream,
  type UiMessageStreamState,
  type UseUiMessageStreamOptions,
} from "@/lib/stream/use-ui-message-stream";
import { AgentPanel } from "./agent/AgentPanel";
import { ArtifactZone } from "./artifact/ArtifactZone";
import { InspectorPanel } from "./inspector/InspectorPanel";
import type { ContentBrief } from "./artifact/BriefCard";

export interface SeoStudioCanvasProps {
  /**
   * The SSE endpoint for the active run (the `/api/run` relay). Null/undefined when
   * the canvas mounts before a run is dispatched — the canvas renders idle.
   */
  streamUrl?: string | null;
  /** The resolved content brief for the run (server-passed), or null. */
  brief?: ContentBrief | null;
  /**
   * Test seam: inject a pre-projected stream state to render the canvas
   * deterministically with NO live EventSource (the SSR render smoke test uses
   * this). When provided it overrides the live hook's state.
   */
  injectedState?: UiMessageStreamState;
  /** Test seam: inject an EventSource factory forwarded to the hook. */
  eventSourceFactory?: UseUiMessageStreamOptions["eventSourceFactory"];
}

const ZONE: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  outline: "none",
};

export function SeoStudioCanvas(props: SeoStudioCanvasProps) {
  const { streamUrl, brief = null, injectedState, eventSourceFactory } = props;

  const live = useUiMessageStream({ url: streamUrl, eventSourceFactory });
  const state = injectedState ?? live;

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
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(260px, 320px) 1fr minmax(260px, 320px)",
        height: "100dvh",
        width: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <section
        ref={agentRef}
        tabIndex={-1}
        role="region"
        aria-label="Agent panel"
        aria-keyshortcuts="Control+1 Meta+1"
        data-zone="agent"
        style={{ ...ZONE, borderRight: "1px solid color-mix(in srgb, currentColor 12%, transparent)", overflowY: "auto" }}
      >
        <AgentPanel phase={state.phase} feed={state.feed} error={state.error} />
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
        />
      </section>

      <section
        ref={inspectorRef}
        tabIndex={-1}
        role="region"
        aria-label="Inspector"
        aria-keyshortcuts="Control+3 Meta+3"
        data-zone="inspector"
        style={{ ...ZONE, borderLeft: "1px solid color-mix(in srgb, currentColor 12%, transparent)", overflowY: "auto" }}
      >
        <InspectorPanel state={state} keyword={brief?.primaryKeyword ?? null} />
      </section>
    </div>
  );
}

export default SeoStudioCanvas;
