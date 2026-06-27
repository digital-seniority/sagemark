// @vitest-environment jsdom

/**
 * Slice 4 — ExportMenu interaction (jsdom).
 *
 * Asserts the export dropdown: disabled with no body; opens to the full format set;
 * copy routes the rendered output to the clipboard; and a download action mints a
 * blob URL (the browser download hop). The pure format builders are covered in
 * test/export/article-html.test.ts + zip.test.ts.
 */

import "./setup-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ExportMenu } from "@/app/(studio)/artifact/ExportMenu";

const BRIEF = { title: "Early signs", slug: "early-signs", primaryKeyword: "dementia", funnelStage: null, isYmyl: true };
const BODY = "# Early signs\n\nReal prose here.";

beforeEach(() => {
  // jsdom lacks these; stub for the copy + download hops.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  // Stub the anchor click so the blob "download" doesn't trip jsdom navigation.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("ExportMenu", () => {
  it("is disabled until there is a body", () => {
    render(<ExportMenu brief={BRIEF} body="" />);
    expect(screen.getByTestId("export-button")).toBeDisabled();
    expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
  });

  it("opens to the full format set", () => {
    render(<ExportMenu brief={BRIEF} body={BODY} />);
    fireEvent.click(screen.getByTestId("export-button"));
    const menu = screen.getByTestId("export-menu");
    expect(menu).toBeInTheDocument();
    for (const id of [
      "export-copy-md",
      "export-copy-html",
      "export-dl-md",
      "export-dl-html",
      "export-dl-fragment",
      "export-dl-zip",
      "export-print",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("copies rendered markdown to the clipboard", async () => {
    render(<ExportMenu brief={BRIEF} body={BODY} />);
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-copy-md"));

    await waitFor(() =>
      expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1),
    );
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(copied).toContain("# Early signs");
    expect(copied).toContain("Real prose here.");
  });

  it("mints a blob download for the ZIP bundle", () => {
    render(<ExportMenu brief={BRIEF} body={BODY} />);
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-dl-zip"));
    expect(URL.createObjectURL as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});
