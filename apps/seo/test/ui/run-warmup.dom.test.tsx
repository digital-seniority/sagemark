// @vitest-environment jsdom

/**
 * S2 — the never-empty run warmup. While a run is live but no stream events have
 * arrived yet (sandbox boot), the agent feed shows the lifecycle warmup instead of
 * a dead "Waiting..." box. Idle (no run) keeps the quiet hint.
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentMessageStream } from "@/app/(studio)/agent/AgentMessageStream";

describe("AgentMessageStream warmup (S2)", () => {
  it("shows the lifecycle warmup while streaming with no events yet", () => {
    render(<AgentMessageStream feed={[]} phase="streaming" />);
    expect(screen.getByTestId("run-warmup")).toBeInTheDocument();
    expect(screen.getByText(/Booting the secure sandbox/)).toBeInTheDocument();
    expect(screen.queryByTestId("agent-feed-empty")).not.toBeInTheDocument();
  });

  it("keeps the quiet waiting hint when idle (no run active)", () => {
    render(<AgentMessageStream feed={[]} phase="idle" />);
    expect(screen.getByTestId("agent-feed-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("run-warmup")).not.toBeInTheDocument();
  });
});
