// @vitest-environment jsdom

/**
 * Slice 3 — in-place editing in the ArtifactZone (jsdom).
 *
 * Asserts the direct-edit loop: an Edit affordance appears only when a save can
 * target a piece (clientId + pieceId + body); editing swaps in the markdown editor;
 * Save POSTs /api/revise with the edited body, folds the re-gated result via
 * onApplyEdit, records the edit, and a frozen-piece error surfaces a plain reason.
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { ArtifactZone, type ApplyEditResult } from "@/app/(studio)/artifact/ArtifactZone";

const BRIEF = { title: "Memory care", slug: "memory-care", primaryKeyword: "memory care", funnelStage: null, isYmyl: true };
const BODY = "# Memory care\n\nOriginal prose.";
const EDITED = "# Memory care\n\nWarmer, reassuring prose.";

function okReviseFetch(result: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/revise")) {
      return { ok: true, status: 200, json: async () => result } as unknown as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("ArtifactZone — in-place editing", () => {
  it("offers no Edit affordance without a pieceId (a save has no target)", () => {
    render(<ArtifactZone brief={BRIEF} body={BODY} clientId="c1" pieceId={null} onApplyEdit={() => {}} />);
    expect(screen.queryByTestId("artifact-edit-toggle")).not.toBeInTheDocument();
  });

  it("edits in place, saves to /api/revise, folds the re-gated result, records the edit", async () => {
    const applied: ApplyEditResult[] = [];
    const fetchImpl = okReviseFetch({
      version: 4,
      verdict: "REVIEW",
      score: 76,
      stageAClean: true,
      failureCodes: [],
      newHash: "abc",
    });
    render(
      <ArtifactZone
        brief={BRIEF}
        body={BODY}
        clientId="c1"
        pieceId="p1"
        onApplyEdit={(r) => applied.push(r)}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByTestId("artifact-edit-toggle"));
    const editor = screen.getByTestId("artifact-body") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: EDITED } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("artifact-save-edit"));
    });

    // onApplyEdit folded the re-gated result with the edited body.
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ body: EDITED, verdict: "REVIEW", score: 76, vetoes: [] });

    // The POST carried the tenancy-minimal body + the edited markdown.
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/revise");
    const sent = JSON.parse((call[1] as { body: string }).body);
    expect(sent).toMatchObject({ clientId: "c1", pieceId: "p1", body: EDITED });
    expect(sent).not.toHaveProperty("workspaceId");

    // The accepted edit is recorded in the history (after exiting edit mode).
    expect(screen.getByTestId("edit-row")).toBeInTheDocument();
    expect(screen.getByTestId("edit-verdict")).toHaveAttribute("data-verdict", "REVIEW");
  });

  it("surfaces a plain reason when the piece is frozen (409)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: "piece-not-editable" }),
    }) as unknown as Response);
    render(
      <ArtifactZone
        brief={BRIEF}
        body={BODY}
        clientId="c1"
        pieceId="p1"
        onApplyEdit={() => {}}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.click(screen.getByTestId("artifact-edit-toggle"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("artifact-save-edit"));
    });
    await waitFor(() => expect(screen.getByTestId("artifact-save-error")).toBeInTheDocument());
    expect(screen.getByTestId("artifact-save-error").textContent).toMatch(/no longer a draft/i);
  });
});
