// @vitest-environment jsdom

/**
 * agent-ui — the chat composer + transcript interaction suite (jsdom).
 *
 * The left zone is now chat-driven: a transcript of PRIOR turns, the live in-flight
 * feed, and a composer that dispatches the next turn. These assert, via a REAL DOM
 * render (@testing-library/react) + user events + a SCRIPTED streaming fetch double:
 *
 *   - The COMPOSER POST-dispatches a turn (POST /api/run) and folds the streamed
 *     taxonomy events into the canvas state (phase->streaming->done, body, feed,
 *     scorecard) — the same projection the EventSource path produces.
 *   - The TENANCY-MINIMAL body: exactly { conversationId, clientId, prompt }.
 *   - The composer is DISABLED while a turn is in flight (single-flight), re-enabled
 *     on completion.
 *   - The TRANSCRIPT renders prior turns (user bubbles + agent turns with a verdict
 *     chip + version badge), and the live feed still renders below it.
 *   - ON DONE the artifact body reconciles to the PERSISTED draft (the injected
 *     reconcile reader's body replaces the stream accumulation).
 *
 * The pure wire-parse + fold plumbing is covered node-side in
 * test/stream/post-turn-stream.test.ts; here we prove the wired component behavior.
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { SeoStudioCanvas } from "@/app/(studio)/SeoStudioCanvas";
import { serializeSseEvent, type SseEvent } from "@/lib/stream/event-taxonomy";
import type { TranscriptTurn } from "@/app/(studio)/agent/ConversationTranscript";
import type { PersistedDraft } from "@/lib/stream/post-turn-stream";

const CONV = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const RUN = "run-1";

/** A streaming Response whose body yields the supplied SSE frames as one chunk. */
function streamResponse(events: SseEvent[]) {
  const wire = events.map(serializeSseEvent).join("");
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (!sent) {
              sent = true;
              return { done: false, value: wire };
            }
            return { done: true };
          },
          cancel() {},
        };
      },
    },
  };
}

/** A JSON Response (the transcript GET). */
function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    body: null,
    json: async () => payload,
  };
}

const DONE_RUN: SseEvent[] = [
  { type: "thinking", seq: 1, runId: RUN, delta: "Researching the topic." },
  { type: "tool-use", seq: 2, runId: RUN, code: "serpFetch", status: "ok", label: "3 sources" },
  { type: "token-delta", seq: 3, runId: RUN, delta: "# Memory care basics" },
  { type: "gate", seq: 4, runId: RUN, stage: "stageB", score: 88, verdict: "PUBLISH" },
  { type: "done", seq: 5, runId: RUN },
];

/**
 * Build a fetch double that routes POST /api/run -> a scripted stream, and
 * GET /api/conversations/[id] -> a JSON transcript. Records the run POST body.
 */
function makeFetch(opts: {
  runEvents?: SseEvent[];
  transcriptTurns?: TranscriptTurn[];
  onRunBody?: (body: Record<string, unknown>) => void;
}) {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith("/api/run")) {
      if (init?.body) opts.onRunBody?.(JSON.parse(init.body) as Record<string, unknown>);
      return streamResponse(opts.runEvents ?? DONE_RUN) as unknown as Response;
    }
    if (url.startsWith("/api/conversations/")) {
      return jsonResponse({
        conversation: { id: CONV, pieceId: "p1" },
        turns: opts.transcriptTurns ?? [],
      }) as unknown as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("SeoStudioCanvas — chat composer dispatches a turn", () => {
  it("POSTs the tenancy-minimal body and folds the streamed run into the canvas", async () => {
    let runBody: Record<string, unknown> | null = null;
    const fetchImpl = makeFetch({ onRunBody: (b) => (runBody = b) });

    render(
      <SeoStudioCanvas
        conversationId={CONV}
        clientId={CLIENT}
        initialTranscript={[]}
        fetchImpl={fetchImpl as never}
      />,
    );

    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Write a memory-care intro" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-composer-send"));
    });

    // The run POST carried EXACTLY the three tenancy-minimal fields.
    await waitFor(() => expect(runBody).not.toBeNull());
    expect(Object.keys(runBody!).sort()).toEqual(["clientId", "conversationId", "prompt"]);
    expect(runBody).toMatchObject({
      conversationId: CONV,
      clientId: CLIENT,
      prompt: "Write a memory-care intro",
    });
    expect(runBody).not.toHaveProperty("workspaceId");

    // The streamed taxonomy folded into every zone.
    await waitFor(() => {
      expect(screen.getByTestId("run-phase")).toHaveAttribute("data-phase", "done");
    });
    expect(screen.getByText("Researching the topic.")).toBeInTheDocument(); // feed: thinking
    expect(document.querySelector('[data-tool-code="serpFetch"]')).toBeInTheDocument(); // feed: tool-use
    expect(screen.getByTestId("artifact-body").textContent).toContain("Memory care basics"); // artifact body (rendered serif prose, not raw markdown)
    // Inspector starts collapsed; expand it to verify the scorecard rendered.
    fireEvent.click(screen.getByTestId("inspector-rail"));
    expect(screen.getByTestId("gate-scorecard")).toBeInTheDocument(); // inspector scorecard
    expect(document.querySelector('[data-verdict="PUBLISH"]')).toBeInTheDocument();
  });

  it("disables the composer while a turn is in flight, re-enables on completion", async () => {
    // A run that streams a token but NEVER terminates (no done) until we release it.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("/api/run")) {
        let phase = 0;
        return {
          ok: true,
          status: 200,
          body: {
            getReader() {
              return {
                async read() {
                  if (phase === 0) {
                    phase = 1;
                    return {
                      done: false,
                      value: serializeSseEvent({ type: "token-delta", seq: 1, runId: RUN, delta: "x" }),
                    };
                  }
                  // Block until the test releases, then emit done + close.
                  await gate;
                  if (phase === 1) {
                    phase = 2;
                    return { done: false, value: serializeSseEvent({ type: "done", seq: 2, runId: RUN }) };
                  }
                  return { done: true };
                },
                cancel() {},
              };
            },
          },
        } as unknown as Response;
      }
      return jsonResponse({ conversation: { id: CONV }, turns: [] }) as unknown as Response;
    });

    render(
      <SeoStudioCanvas conversationId={CONV} clientId={CLIENT} initialTranscript={[]} fetchImpl={fetchImpl as never} />,
    );

    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "go" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-composer-send"));
    });

    // In flight: the composer is disabled and shows the running beat.
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-input")).toBeDisabled();
    });
    expect(screen.getByTestId("chat-composer-send")).toBeDisabled();
    expect(screen.getByTestId("chat-composer-send").textContent).toContain("Running");

    // Release the stream -> done -> re-enabled.
    await act(async () => {
      release?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-input")).not.toBeDisabled();
    });
    expect(screen.getByTestId("run-phase")).toHaveAttribute("data-phase", "done");
  });

  it("Enter sends; Shift+Enter does NOT send (newline)", async () => {
    let runCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("/api/run")) {
        runCalls++;
        return streamResponse([{ type: "done", seq: 1, runId: RUN }]) as unknown as Response;
      }
      return jsonResponse({ conversation: { id: CONV }, turns: [] }) as unknown as Response;
    });

    render(
      <SeoStudioCanvas conversationId={CONV} clientId={CLIENT} initialTranscript={[]} fetchImpl={fetchImpl as never} />,
    );
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });

    // Shift+Enter: no dispatch.
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(runCalls).toBe(0);

    // Plain Enter: dispatch.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => expect(runCalls).toBe(1));
  });
});

describe("ConversationTranscript — prior turns render", () => {
  const PRIOR: TranscriptTurn[] = [
    { id: "t1", seq: 1, role: "user", content: "Write me an intro", runId: null, pieceVersion: null, verdict: null, createdAt: "2026-06-27T00:00:00Z" },
    { id: "t2", seq: 2, role: "agent", content: "Here is your draft.", runId: RUN, pieceVersion: 1, verdict: "REVIEW", createdAt: "2026-06-27T00:00:01Z" },
  ];

  it("renders server-passed prior turns: user bubble + agent verdict chip + version badge", () => {
    const fetchImpl = makeFetch({});
    render(
      <SeoStudioCanvas conversationId={CONV} clientId={CLIENT} initialTranscript={PRIOR} fetchImpl={fetchImpl as never} />,
    );

    const turns = screen.getAllByTestId("transcript-turn");
    expect(turns).toHaveLength(2);
    expect(screen.getByText("Write me an intro")).toBeInTheDocument();
    expect(screen.getByText("Here is your draft.")).toBeInTheDocument();
    // The agent turn carries the verdict chip + version badge.
    expect(screen.getByTestId("transcript-verdict")).toHaveAttribute("data-verdict", "REVIEW");
    expect(screen.getByTestId("transcript-version").textContent).toContain("v1");
    // The live feed still renders (empty state below the transcript).
    expect(screen.getByTestId("agent-feed-empty")).toBeInTheDocument();
    // With server-passed transcript, no mount fetch of the transcript route fires.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("loads the transcript from GET /api/conversations/[id] when not server-passed", async () => {
    const fetchImpl = makeFetch({ transcriptTurns: PRIOR });
    render(
      <SeoStudioCanvas conversationId={CONV} clientId={CLIENT} fetchImpl={fetchImpl as never} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("transcript-turn")).toHaveLength(2));
    // The mount fetch hit the transcript route with the bound clientId (tenancy).
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] ?? "") as string;
    expect(calledUrl).toContain(`/api/conversations/${CONV}`);
    expect(calledUrl).toContain(`clientId=${CLIENT}`);
  });
});

describe("SeoStudioCanvas — on-done reconcile to the persisted draft", () => {
  it("replaces the stream-accumulated body with the persisted draft on completion", async () => {
    const fetchImpl = makeFetch({
      // The stream emits a PARTIAL body; the persisted truth differs.
      runEvents: [
        { type: "token-delta", seq: 1, runId: RUN, delta: "stale stream partial" },
        { type: "gate", seq: 2, runId: RUN, stage: "stageB", score: 70, verdict: "REVISE" },
        { type: "done", seq: 3, runId: RUN },
      ],
    });
    const reconcileDraft = vi.fn(
      async (): Promise<PersistedDraft> => ({
        piece: { pieceId: "p1", slug: "s", title: "T", body: "PERSISTED CANONICAL BODY", status: "draft" },
        scorecard: { stageAVetoes: [], score: 91, verdict: "PUBLISH" },
      }),
    );

    render(
      <SeoStudioCanvas
        conversationId={CONV}
        clientId={CLIENT}
        initialTranscript={[]}
        fetchImpl={fetchImpl as never}
        reconcileDraft={reconcileDraft}
      />,
    );

    fireEvent.change(screen.getByTestId("chat-composer-input"), { target: { value: "go" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-composer-send"));
    });

    // After done, the reconcile read ran and the persisted body + scorecard won.
    await waitFor(() => expect(reconcileDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("artifact-body").textContent).toContain("PERSISTED CANONICAL BODY");
    });
    expect(screen.getByTestId("artifact-body").textContent).not.toContain("stale stream partial");
    expect(document.querySelector('[data-verdict="PUBLISH"]')).toBeInTheDocument();
  });
});
