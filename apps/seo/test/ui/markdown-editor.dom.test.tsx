// @vitest-environment jsdom

/**
 * PR 011 / P1.U.2 — MarkdownEditor live-streaming interaction tests (jsdom).
 *
 * REAL DOM render via @testing-library/react (jsdom env, opted in per-file). These
 * assert the editor's load-bearing behavior: token deltas APPEND to the editor as
 * the streamed body grows, the live caret shows while streaming, and the editor
 * locks input while the stream owns the body (the edit -> re-gate loop is PR 012).
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MarkdownEditor } from "@/app/(studio)/artifact/MarkdownEditor";

describe("MarkdownEditor — live token streaming", () => {
  it("shows the empty hint before any tokens arrive", () => {
    render(<MarkdownEditor body="" streaming={false} />);
    expect(screen.getByTestId("artifact-body-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("artifact-body")).not.toBeInTheDocument();
  });

  it("appends streamed token deltas into the editor body", () => {
    // Re-render with a growing body the way the reducer accumulates token-deltas.
    const { rerender } = render(<MarkdownEditor body="# Memory" streaming />);
    const editor = screen.getByTestId("artifact-body") as HTMLTextAreaElement;
    expect(editor.value).toBe("# Memory");

    rerender(<MarkdownEditor body="# Memory care" streaming />);
    expect((screen.getByTestId("artifact-body") as HTMLTextAreaElement).value).toBe("# Memory care");

    const full = "# Memory care basics\n\nIntro.";
    rerender(<MarkdownEditor body={full} streaming />);
    expect((screen.getByTestId("artifact-body") as HTMLTextAreaElement).value).toBe(full);
  });

  it("renders the live caret while streaming and removes it once settled", () => {
    const { rerender } = render(<MarkdownEditor body="partial draft" streaming />);
    expect(screen.getByTestId("stream-caret")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-editor")).toHaveAttribute("data-streaming", "true");

    rerender(<MarkdownEditor body="partial draft" streaming={false} />);
    expect(screen.queryByTestId("stream-caret")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-editor")).toHaveAttribute("data-streaming", "false");
  });

  it("is read-only while streaming (the live stream owns the body)", () => {
    render(<MarkdownEditor body="streamed body" streaming />);
    const editor = screen.getByTestId("artifact-body") as HTMLTextAreaElement;
    expect(editor).toHaveAttribute("readonly");
    // A stray keystroke during streaming does not mutate the streamed body.
    fireEvent.change(editor, { target: { value: "operator typed over it" } });
    expect((screen.getByTestId("artifact-body") as HTMLTextAreaElement).value).toBe("streamed body");
  });

  it("allows local scratch edits once the stream has settled (PR 012 wires re-gate)", () => {
    const edits: string[] = [];
    render(
      <MarkdownEditor body="settled body" streaming={false} onLocalEdit={(v) => edits.push(v)} />,
    );
    const editor = screen.getByTestId("artifact-body") as HTMLTextAreaElement;
    expect(editor).not.toHaveAttribute("readonly");
    fireEvent.change(editor, { target: { value: "settled body + edit" } });
    expect((screen.getByTestId("artifact-body") as HTMLTextAreaElement).value).toBe("settled body + edit");
    expect(edits).toContain("settled body + edit");
  });
});
