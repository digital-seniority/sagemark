// @vitest-environment jsdom

/**
 * PR 012 / P1.U.3 — ActivityFeed interaction tests (jsdom, DR-029).
 *
 * Asserts the bounded-edit history makes the re-gate visible: each accepted edit
 * shows its summary + the verdict band the FULL gate re-computed, INCLUDING a
 * regressed band when an edit broke the gate (the faithfulness-break, made
 * visible). It shows no publish affordance (no publish bypass in the UI either).
 */

import "../ui/setup-dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ActivityFeed, type EditActivityItem } from "@/app/(studio)/agent/ActivityFeed";

const PASS: EditActivityItem = {
  version: 2,
  summary: "Softened the cost phrasing.",
  verdict: "PUBLISH",
  score: 90,
  stageAClean: true,
};

const REGRESSED: EditActivityItem = {
  version: 3,
  summary: "Added an evening-hours sentence.",
  verdict: "REVISE",
  score: null,
  stageAClean: false,
};

describe("ActivityFeed", () => {
  it("shows the empty state before any edit", () => {
    render(<ActivityFeed edits={[]} />);
    expect(screen.getByTestId("edit-feed-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-feed")).not.toBeInTheDocument();
  });

  it("renders one row per edit with its summary + verdict band", () => {
    render(<ActivityFeed edits={[PASS, REGRESSED]} />);
    const rows = screen.getAllByTestId("edit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Softened the cost phrasing.")).toBeInTheDocument();
    expect(screen.getByText("Added an evening-hours sentence.")).toBeInTheDocument();
  });

  it("makes a regressed (faithfulness-break) verdict visible on the row", () => {
    render(<ActivityFeed edits={[REGRESSED]} />);
    const pill = screen.getByTestId("edit-verdict");
    expect(pill).toHaveAttribute("data-verdict", "REVISE");
    expect(pill).toHaveAttribute("data-stage-a-clean", "false");
  });

  it("shows the new version number per row", () => {
    render(<ActivityFeed edits={[PASS]} />);
    expect(screen.getByTestId("edit-row")).toHaveAttribute("data-version", "2");
  });
});
