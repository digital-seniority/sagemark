// @vitest-environment jsdom

/**
 * Slice 2 — StudioWelcome first-run guidance (jsdom).
 *
 * Asserts the warm empty-state behaviour: the guidance + example briefs render,
 * clicking an example dispatches that brief as a first turn (onPick), and the
 * voice-spec hard stop replaces the examples with the fail-closed reason (no
 * "generate anyway" affordance). The AgentPanel gating (welcome only on a
 * KNOWN-empty transcript) is covered by the chat-composer suite.
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StudioWelcome } from "@/app/(studio)/agent/StudioWelcome";
import { AgentPanel } from "@/app/(studio)/agent/AgentPanel";

describe("StudioWelcome — first-run guidance", () => {
  it("renders the guidance and three example briefs", () => {
    render(<StudioWelcome onPick={() => {}} />);
    expect(screen.getByTestId("studio-welcome")).toBeInTheDocument();
    expect(screen.getAllByTestId("studio-welcome-example")).toHaveLength(3);
    expect(screen.queryByTestId("studio-welcome-blocked")).not.toBeInTheDocument();
  });

  it("dispatches the picked example's full prompt via onPick", () => {
    const picks: string[] = [];
    render(<StudioWelcome onPick={(p) => picks.push(p)} />);

    fireEvent.click(screen.getAllByTestId("studio-welcome-example")[0]!);
    expect(picks).toHaveLength(1);
    // The click sends the FULL brief prompt, not the short chip label.
    expect(picks[0]!.length).toBeGreaterThan(20);
    expect(picks[0]).toMatch(/dementia/i);
  });

  it("AgentPanel hides welcome and shows RunWarmup the moment inFlight=true", () => {
    // Dogfood bug: with an empty transcript and no feed items, the welcome stayed
    // visible for the entire ~50s sandbox boot window because showWelcome didn't
    // check inFlight. Now it should flip to RunWarmup as soon as the POST opens.
    const fetchImpl = () =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    render(
      <AgentPanel
        phase="streaming"
        feed={[]}
        chat={{
          conversationId: "conv-1",
          clientId: "client-1",
          initialTranscript: [],
          onSend: () => {},
          inFlight: true,
          fetchImpl: fetchImpl as typeof fetch,
        }}
      />,
    );
    expect(screen.queryByTestId("studio-welcome")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-warmup")).toBeInTheDocument();
  });

  it("shows the voice-spec hard stop instead of examples when blocked", () => {
    const onPick = vi.fn();
    render(
      <StudioWelcome
        onPick={onPick}
        blockedReason="This client has no approved voice spec; generation is blocked."
      />,
    );
    expect(screen.getByTestId("studio-welcome-blocked")).toBeInTheDocument();
    expect(screen.getByText(/no approved voice spec/i)).toBeInTheDocument();
    // No example affordance in the blocked state.
    expect(screen.queryByTestId("studio-welcome-example")).not.toBeInTheDocument();
  });
});
