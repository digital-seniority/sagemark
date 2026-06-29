/**
 * PR 010 / P1.U.1 — three-zone canvas + component render smoke tests.
 *
 * vitest runs in a `node` environment (no jsdom), so we render the client
 * components to a STATIC HTML string with react-dom/server's `renderToStaticMarkup`
 * — the same pass the PR 015 SSR suites use. This exercises the real component tree
 * (zones, ARIA regions, feed rows, mode tabs, the signal dot) and asserts the shell
 * shape + the SSE projection wiring via the injected-state seam (no live
 * EventSource). Full interaction/visual coverage is Tier-3 (NEEDS-INPUT: no DOM
 * test runner is configured in apps/seo).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SeoStudioCanvas } from "@/app/(studio)/SeoStudioCanvas";
import { ScoreSignalDot } from "@/components/ScoreSignalDot";
import {
  INITIAL_STREAM_STATE,
  reduceUiMessageStream,
  type UiMessageStreamState,
} from "@/lib/stream/use-ui-message-stream";
import type { SseEvent } from "@/lib/stream/event-taxonomy";

const RUN = "run-1";
function project(events: SseEvent[]): UiMessageStreamState {
  return events.reduce(reduceUiMessageStream, INITIAL_STREAM_STATE);
}

describe("SeoStudioCanvas — three-zone shell", () => {
  it("renders all three ARIA region zones (agent | artifact | inspector)", () => {
    const html = renderToStaticMarkup(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);
    expect(html).toContain('data-zone="agent"');
    expect(html).toContain('data-zone="artifact"');
    expect(html).toContain('data-zone="inspector"');
    // Each zone is a focusable ARIA region with a keyboard shortcut hint.
    expect(html).toContain('aria-label="Agent panel"');
    expect(html).toContain('aria-label="Artifact"');
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain('aria-keyshortcuts="Control+2 Meta+2"');
    expect(html).toContain('data-testid="seo-studio-canvas"');
  });

  it("renders the idle empty states before a run streams", () => {
    const html = renderToStaticMarkup(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);
    expect(html).toContain("Waiting for the agent to start the run");
    expect(html).toContain("draft body will appear here");
    expect(html).toContain('data-phase="idle"');
  });

  it("renders the live SSE projection into the zones (feed + body + scorecard)", () => {
    const state = project([
      { type: "thinking", seq: 1, runId: RUN, delta: "Researching the topic." },
      { type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "ok", label: "3 sources" },
      { type: "token-delta", seq: 3, runId: RUN, delta: "# Memory care basics" },
      { type: "gate", seq: 4, runId: RUN, stage: "stageB", score: 88, verdict: "PUBLISH" },
    ]);
    const html = renderToStaticMarkup(<SeoStudioCanvas injectedState={state} />);

    // Agent zone: a coalesced thinking row + a coded tool-use row (by code, not prose).
    expect(html).toContain("Researching the topic.");
    expect(html).toContain('data-tool-code="serpFetch"');
    expect(html).toContain('data-status="ok"');
    expect(html).toContain("Read the latest sources"); // the code -> plain done-phrase map
    expect(html).toContain("3 sources"); // the sanitized label

    // Artifact zone: the accumulated token-delta body, rendered to serif prose
    // (DraftPaper) — the markdown heading becomes an <h1>, not raw "# ..." source.
    expect(html).toContain('data-testid="artifact-body"');
    // The markdown heading renders as an <h1> (now carrying a slug anchor id).
    expect(html).toMatch(/<h1 id="[^"]*">Memory care basics<\/h1>/);

    // Inspector zone: collapsed rail shows verdict badge (scorecard is behind the expand toggle).
    expect(html).toContain('data-testid="inspector-rail"');
    expect(html).toContain('data-testid="rail-verdict-badge"');
    expect(html).toContain('data-verdict="PUBLISH"');
    expect(html).toContain("88"); // score visible in rail badge title attribute
  });

  it("surfaces a terminal error as an explicit row (not a dead spinner)", () => {
    const state = reduceUiMessageStream(INITIAL_STREAM_STATE, {
      type: "error",
      seq: -1,
      runId: RUN,
      code: "HEARTBEAT_TIMEOUT",
      message: "no worker event within the stall ceiling",
    });
    const html = renderToStaticMarkup(<SeoStudioCanvas injectedState={state} />);
    expect(html).toContain('data-testid="agent-error"');
    expect(html).toContain("HEARTBEAT_TIMEOUT");
    expect(html).toContain('data-phase="error"');
  });

  it("renders the resolved brief card when a brief is passed", () => {
    const html = renderToStaticMarkup(
      <SeoStudioCanvas
        injectedState={INITIAL_STREAM_STATE}
        brief={{ title: "What is memory care?", slug: "what-is-memory-care", primaryKeyword: "memory care", funnelStage: "TOFU", isYmyl: true }}
      />,
    );
    expect(html).toContain('data-testid="brief-card"');
    expect(html).toContain("What is memory care?");
    expect(html).toContain("memory care");
    expect(html).toContain("TOFU");
    expect(html).toContain("YMYL");
  });
});

describe("ScoreSignalDot — extracted verdict dot", () => {
  it("renders the verdict band + score tooltip", () => {
    const html = renderToStaticMarkup(<ScoreSignalDot verdict="REVIEW" score={72} />);
    expect(html).toContain('data-verdict="REVIEW"');
    expect(html).toContain("REVIEW");
    expect(html).toContain("72/100");
  });

  it("falls back to PENDING for an unknown / null verdict", () => {
    const html = renderToStaticMarkup(<ScoreSignalDot verdict={null} />);
    expect(html).toContain('data-verdict="PENDING"');
    expect(html).toContain("No verdict yet");
  });
});
