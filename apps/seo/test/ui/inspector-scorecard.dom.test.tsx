// @vitest-environment jsdom

/**
 * PR 011 / P1.U.2 — Inspector gate scorecard interaction tests (jsdom).
 *
 * REAL DOM render via @testing-library/react. These assert the scorecard renders
 * from the AUTHORITATIVE `gate` SSE event projection (verdict band + Stage-A
 * vetoes), that the verdict bands match the @sagemark/core thresholds, that a
 * Stage-A veto suppresses the composite, and that the piece-status row tracks the
 * run phase. The zero-credit live-preview distinction is asserted too.
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { InspectorPanel } from "@/app/(studio)/inspector/InspectorPanel";
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

describe("InspectorPanel — gate scorecard from the gate SSE event", () => {
  it("renders a PUBLISH verdict band + composite from a Stage-B gate event", () => {
    const state = project([
      { type: "token-delta", seq: 1, runId: RUN, delta: "# Memory care\n\nA full body of text. ".repeat(20) },
      { type: "gate", seq: 2, runId: RUN, stage: "stageB", score: 88, verdict: "PUBLISH" },
    ]);
    render(<InspectorPanel state={state} keyword="memory care" />);

    const band = screen.getByTestId("verdict-band");
    expect(band).toHaveAttribute("data-verdict", "PUBLISH");
    expect(screen.getByTestId("verdict-score")).toHaveTextContent("88");
    // Stage-A clean (no vetoes fired).
    expect(screen.getByTestId("stage-a-clean")).toBeInTheDocument();
  });

  it("renders the @sagemark/core verdict-band thresholds in the legend", () => {
    render(<InspectorPanel state={INITIAL_STREAM_STATE} keyword="x" />);
    const legend = screen.getByTestId("verdict-band-legend");
    // PUBLISH >= 85 / REVIEW 70-84 / REVISE 50-69 / REJECT < 50.
    expect(legend).toHaveTextContent(">= 85");
    expect(legend).toHaveTextContent("70-84");
    expect(legend).toHaveTextContent("50-69");
    expect(legend).toHaveTextContent("< 50");
  });

  it("renders Stage-A veto codes (with captions) and suppresses the composite", () => {
    const state = project([
      { type: "token-delta", seq: 1, runId: RUN, delta: "some body" },
      {
        type: "gate",
        seq: 2,
        runId: RUN,
        stage: "stageA",
        vetoes: ["VETO_UNSOURCED_STAT", "VETO_KEYWORD_STUFF"],
        score: null,
        verdict: "REVISE",
      },
    ]);
    render(<InspectorPanel state={state} keyword="memory care" />);

    const vetoes = screen.getAllByTestId("stage-a-veto");
    expect(vetoes).toHaveLength(2);
    expect(screen.getByText("VETO_UNSOURCED_STAT")).toBeInTheDocument();
    // The fixed caption gloss for the code (never raw model prose).
    expect(screen.getByText(/not traced to a source/i)).toBeInTheDocument();

    // A vetoed draft never shows a fabricated composite number.
    expect(screen.getByTestId("verdict-score")).toHaveTextContent("—");
    expect(screen.getByTestId("verdict-band")).toHaveAttribute("data-verdict", "REVISE");
  });

  it("shows 'not run yet' for Stage A before any gate event", () => {
    render(<InspectorPanel state={INITIAL_STREAM_STATE} keyword="x" />);
    expect(screen.getByTestId("stage-a-pending")).toBeInTheDocument();
  });

  it("tracks the run phase in the piece-status row", () => {
    const streaming = project([{ type: "token-delta", seq: 1, runId: RUN, delta: "hi" }]);
    const { rerender } = render(<InspectorPanel state={streaming} keyword="x" />);
    expect(screen.getByTestId("piece-status-row")).toHaveAttribute("data-phase", "streaming");

    const done = reduceUiMessageStream(streaming, { type: "done", seq: 2, runId: RUN });
    rerender(<InspectorPanel state={done} keyword="x" />);
    expect(screen.getByTestId("piece-status-row")).toHaveAttribute("data-phase", "done");
  });

  it("labels the Stage-B dimension bars as a zero-credit client preview", () => {
    // Body only arrives via snapshot (reconcile after persistPiece).
    // Populate state.body via a snapshot event to simulate a completed run.
    const articleBody = "# Heading\n\n" + "word ".repeat(120);
    const state = reduceUiMessageStream(INITIAL_STREAM_STATE, {
      type: "snapshot",
      seq: 5,
      runId: RUN,
      piece: { pieceId: "p1", slug: "heading", title: "Heading", body: articleBody, status: "draft" },
      scorecard: null,
    });
    render(<InspectorPanel state={state} keyword="word" />);
    expect(screen.getByTestId("stage-b-preview-label")).toHaveTextContent(/live preview/i);
    expect(screen.getByTestId("inspector-source-note")).toHaveTextContent(/authoritative server gate/i);
    // The deterministic dimension bars render (from @sagemark/core content-score).
    expect(screen.getAllByTestId("stage-b-bar").length).toBeGreaterThan(0);
  });
});
