// @vitest-environment jsdom

/**
 * Slice 4 — PreviewFrame (jsdom).
 *
 * Asserts the Preview tab: an empty hint with no body, and — once the body fills —
 * a SERP snippet plus a sandboxed iframe whose srcdoc carries the rendered article
 * built from the live body (the same exporter the download uses).
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PreviewFrame } from "@/app/(studio)/artifact/PreviewFrame";

const BRIEF = { title: "Early signs", slug: "early-signs", primaryKeyword: "dementia", funnelStage: null, isYmyl: true };

describe("PreviewFrame", () => {
  it("shows the empty hint before the draft has a body", () => {
    render(<PreviewFrame brief={BRIEF} body="" />);
    expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("renders a SERP snippet + a sandboxed iframe of the rendered body", () => {
    render(<PreviewFrame brief={BRIEF} body={"# Early signs\n\nReal prose here."} />);

    expect(screen.getByTestId("serp-preview")).toBeInTheDocument();
    const frame = screen.getByTestId("preview-frame") as HTMLIFrameElement;
    expect(frame).toBeInTheDocument();
    // Sandboxed + same-origin srcdoc carrying the rendered (not raw) body.
    expect(frame.getAttribute("sandbox")).toBe("");
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toMatch(/<h1 id="[^"]*">Early signs<\/h1>/);
    expect(doc).toContain("Real prose here.");
  });
});
