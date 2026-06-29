// @vitest-environment jsdom

/**
 * S3 — live self-advancing roadmap + one-click "Author the whole hub".
 *  - PageProgressList re-fetches when its refreshSignal bumps (the count goes live).
 *  - AgentPanel surfaces the author-all status banner + a Stop control while the
 *    loop runs (visible even mid-run, where the composer chips are hidden).
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PageProgressList } from "@/app/(studio)/artifact/PageProgressList";
import { AgentPanel } from "@/app/(studio)/agent/AgentPanel";

const ORCH = {
  projectId: "p",
  strategyStatus: "approved",
  total: 2,
  authoredCount: 1,
  pendingCount: 1,
  pages: [
    { slug: "a", title: "A", clusterRole: "spoke", funnelStage: null, primaryKeyword: null, authored: true },
  ],
};

describe("PageProgressList live refresh (S3)", () => {
  it("re-fetches when refreshSignal changes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ORCH });
    const { rerender } = render(
      <PageProgressList projectId="p" clientId="c" refreshSignal={0} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    );
    await screen.findByTestId("page-progress-list");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    rerender(
      <PageProgressList projectId="p" clientId="c" refreshSignal={1} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});

describe("AgentPanel author-all banner (S3)", () => {
  it("shows the banner + Stop while the loop runs, and Stop fires the handler", () => {
    const onStop = vi.fn();
    render(
      <AgentPanel
        phase="streaming"
        feed={[]}
        chat={{
          conversationId: "x",
          clientId: "c",
          initialTranscript: [
            { id: "1", seq: 1, role: "user", content: "hi", runId: null, pieceVersion: null, verdict: null, createdAt: "" },
          ],
          onSend: vi.fn(),
          inFlight: true,
          autoAuthorAll: true,
          onStopAuthorAll: onStop,
        }}
      />,
    );
    expect(screen.getByTestId("author-all-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("author-all-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
