// @vitest-environment jsdom

/**
 * agent-ui — collapsible Inspector interaction tests (jsdom).
 *
 * The right-hand Inspector (gate scorecard) TOGGLES collapsed so the center
 * artifact gets a wider reading view. These assert, via a REAL DOM render
 * (@testing-library/react) + user clicks:
 *
 *   - DEFAULT is docked-open (full panel, not the rail) when no persisted choice.
 *   - Collapsing replaces the full panel with the narrow rail AND narrows the
 *     inspector grid column (so the `1fr` artifact widens).
 *   - The toggle is a real <button> whose aria-expanded flips, and the
 *     data-zone="inspector" region survives in both states (the Cmd/Ctrl+3 focus
 *     jump still has a target).
 *   - The collapsed rail's compact verdict badge reflects the PROJECTED
 *     scorecard verdict (publish-eligible ⇒ check), never a recompute.
 *   - The choice persists to localStorage and is read back on mount.
 */

import "./setup-dom";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SeoStudioCanvas } from "@/app/(studio)/SeoStudioCanvas";
import {
  INITIAL_STREAM_STATE,
  reduceUiMessageStream,
  type UiMessageStreamState,
} from "@/lib/stream/use-ui-message-stream";
import type { SseEvent } from "@/lib/stream/event-taxonomy";

const RUN = "run-1";
const STORAGE_KEY = "seo.inspectorCollapsed";

function project(events: SseEvent[]): UiMessageStreamState {
  return events.reduce(reduceUiMessageStream, INITIAL_STREAM_STATE);
}

/** The grid column width for the inspector track (the 3rd `gridTemplateColumns` value). */
function inspectorTrack(): string {
  const canvas = screen.getByTestId("seo-studio-canvas") as HTMLElement;
  // e.g. "minmax(260px, 320px) 1fr 48px" — the inline style string.
  const cols = canvas.style.gridTemplateColumns;
  return cols.slice(cols.lastIndexOf(" ") + 1);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("SeoStudioCanvas — collapsible Inspector", () => {
  it("defaults to docked-open: full panel renders, rail does not", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);

    expect(screen.getByTestId("inspector-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-rail")).not.toBeInTheDocument();

    // The inspector region is present and not collapsed.
    const zone = document.querySelector('[data-zone="inspector"]') as HTMLElement;
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("seo-studio-canvas")).toHaveAttribute(
      "data-inspector-collapsed",
      "false",
    );

    // Open ⇒ the inspector track matches the agent track (not the 48px rail).
    expect(inspectorTrack()).not.toBe("48px");
  });

  it("collapses to the narrow rail and widens the artifact (grid column → 48px)", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);

    const collapse = screen.getByTestId("inspector-collapse");
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse.tagName).toBe("BUTTON");

    fireEvent.click(collapse);

    // The full panel is replaced by the rail.
    expect(screen.queryByTestId("inspector-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-rail")).toBeInTheDocument();

    // The grid column narrowed to the rail width (so the 1fr artifact widens).
    expect(inspectorTrack()).toBe("48px");

    const zone = document.querySelector('[data-zone="inspector"]') as HTMLElement;
    expect(zone).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("seo-studio-canvas")).toHaveAttribute(
      "data-inspector-collapsed",
      "true",
    );
  });

  it("expands back from the rail to the full panel (toggle + aria-expanded flip)", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);

    fireEvent.click(screen.getByTestId("inspector-collapse"));

    const rail = screen.getByTestId("inspector-rail");
    // The whole rail is the expand affordance: a real button, aria-expanded=false.
    expect(rail.tagName).toBe("BUTTON");
    expect(rail).toHaveAttribute("aria-expanded", "false");
    expect(rail).toHaveAttribute("aria-label", expect.stringMatching(/expand inspector/i));

    fireEvent.click(rail);

    expect(screen.getByTestId("inspector-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-collapse")).toHaveAttribute("aria-expanded", "true");
    expect(inspectorTrack()).not.toBe("48px");
  });

  it("keeps the data-zone=inspector region (Cmd/Ctrl+3 focus target) in BOTH states", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);

    // Expanded: region present + focusable.
    let zone = document.querySelector('[data-zone="inspector"]') as HTMLElement;
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveAttribute("tabindex", "-1");
    expect(zone).toHaveAttribute("aria-keyshortcuts", "Control+3 Meta+3");

    fireEvent.click(screen.getByTestId("inspector-collapse"));

    // Collapsed: the SAME region (and its focus target) survives.
    zone = document.querySelector('[data-zone="inspector"]') as HTMLElement;
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveAttribute("tabindex", "-1");
    expect(zone).toHaveAttribute("aria-keyshortcuts", "Control+3 Meta+3");
    zone.focus();
    expect(document.activeElement).toBe(zone);
  });

  it("rail badge shows a publish-eligible check from the PROJECTED PUBLISH verdict", () => {
    const state = project([
      { type: "token-delta", seq: 1, runId: RUN, delta: "# body" },
      { type: "gate", seq: 2, runId: RUN, stage: "stageB", score: 91, verdict: "PUBLISH" },
    ]);
    render(<SeoStudioCanvas injectedState={state} />);

    fireEvent.click(screen.getByTestId("inspector-collapse"));

    const badge = screen.getByTestId("rail-verdict-badge");
    expect(badge).toHaveAttribute("data-verdict", "PUBLISH");
    // The check glyph marks publish-eligible (derived from state.scorecard, no recompute).
    expect(badge.textContent).toContain("✓");
  });

  it("rail badge stays PENDING (no check) before any gate event", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);
    fireEvent.click(screen.getByTestId("inspector-collapse"));

    const badge = screen.getByTestId("rail-verdict-badge");
    expect(badge).toHaveAttribute("data-verdict", "PENDING");
    expect(badge.textContent).not.toContain("✓");
  });

  it("persists the collapsed choice to localStorage", () => {
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe("true");

    fireEvent.click(screen.getByTestId("inspector-collapse"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    fireEvent.click(screen.getByTestId("inspector-rail"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("reads a persisted collapsed=true preference on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    render(<SeoStudioCanvas injectedState={INITIAL_STREAM_STATE} />);

    // Mounted already collapsed (the mount effect read the stored choice).
    expect(screen.getByTestId("inspector-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-panel")).not.toBeInTheDocument();
    expect(inspectorTrack()).toBe("48px");
  });
});
