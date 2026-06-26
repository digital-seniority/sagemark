// @vitest-environment jsdom

/**
 * P1.U.4 / PR 013 — VersionHub + VersionDiff interaction tests (jsdom, DR-029).
 *
 * Asserts the hub's switch/name/compare affordances and the undeletable named
 * sign-off rendering: a sign-off row shows a LOCKED badge and exposes NO name /
 * rename / delete control (its name can never be overwritten). VersionDiff is a
 * pure reads-only line diff.
 */

import "../ui/setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VersionHub, type HubVersion } from "@/app/(studio)/inspector/VersionHub";
import { VersionDiff, diffLines } from "@/app/(studio)/inspector/VersionDiff";

const V1: HubVersion = {
  id: "ver-1",
  version: 1,
  body: "## Costs\n\nStarts at $5,000 a month.\n",
  verdict: "REVISE",
  snapshotAt: "2026-01-01T00:00:00.000Z",
  name: null,
  isActive: false,
  isSignoff: false,
};

const V2_SIGNOFF: HubVersion = {
  id: "ver-2",
  version: 2,
  body: "## Costs\n\nBegins around $5,000 monthly.\n",
  verdict: "PUBLISH",
  snapshotAt: "2026-01-02T00:00:00.000Z",
  name: "client sign-off",
  isActive: true,
  isSignoff: true,
};

describe("VersionHub — list + switch + name", () => {
  it("renders the empty state with no versions", () => {
    render(<VersionHub versions={[]} />);
    expect(screen.getByTestId("version-hub-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("version-list")).not.toBeInTheDocument();
  });

  it("renders one row per version, sorted by version", () => {
    render(<VersionHub versions={[V2_SIGNOFF, V1]} />);
    const rows = screen.getAllByTestId("version-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-version", "1");
    expect(rows[1]).toHaveAttribute("data-version", "2");
  });

  it("SWITCH: clicking 'Switch to this' on a non-active version invokes onSwitch", () => {
    const onSwitch = vi.fn();
    render(<VersionHub versions={[V1, V2_SIGNOFF]} onSwitch={onSwitch} />);
    // V1 is not active -> it has an enabled switch button.
    const v1Row = screen.getAllByTestId("version-row")[0]!;
    const switchBtn = v1Row.querySelector('[data-testid="version-switch"]') as HTMLButtonElement;
    expect(switchBtn).not.toBeDisabled();
    fireEvent.click(switchBtn);
    expect(onSwitch).toHaveBeenCalledWith(1);
  });

  it("the active version's switch button is disabled (already active)", () => {
    render(<VersionHub versions={[V1, V2_SIGNOFF]} />);
    const v2Row = screen.getAllByTestId("version-row")[1]!;
    const switchBtn = v2Row.querySelector('[data-testid="version-switch"]') as HTMLButtonElement;
    expect(switchBtn).toBeDisabled();
  });

  it("NAME: a non-sign-off version exposes a name control that invokes onName", () => {
    const onName = vi.fn();
    render(<VersionHub versions={[V1]} onName={onName} />);
    fireEvent.click(screen.getByTestId("version-name-open"));
    fireEvent.change(screen.getByTestId("version-name-input"), { target: { value: "draft one" } });
    fireEvent.click(screen.getByTestId("version-name-save"));
    expect(onName).toHaveBeenCalledWith(1, "draft one", false);
  });

  it("NAME as sign-off: checking the sign-off box passes asSignoff=true", () => {
    const onName = vi.fn();
    render(<VersionHub versions={[V1]} onName={onName} />);
    fireEvent.click(screen.getByTestId("version-name-open"));
    fireEvent.change(screen.getByTestId("version-name-input"), { target: { value: "client sign-off" } });
    fireEvent.click(screen.getByTestId("version-name-signoff"));
    fireEvent.click(screen.getByTestId("version-name-save"));
    expect(onName).toHaveBeenCalledWith(1, "client sign-off", true);
  });
});

describe("VersionHub — undeletable named sign-off rendering", () => {
  it("a sign-off row shows a LOCKED badge", () => {
    render(<VersionHub versions={[V2_SIGNOFF]} />);
    const row = screen.getByTestId("version-row");
    expect(row).toHaveAttribute("data-signoff", "true");
    expect(screen.getByTestId("version-signoff-badge")).toBeInTheDocument();
  });

  it("a sign-off row exposes NO name/rename control (cannot be overwritten) and NO delete", () => {
    render(<VersionHub versions={[V2_SIGNOFF]} />);
    expect(screen.queryByTestId("version-name-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-name-input")).not.toBeInTheDocument();
    // No delete affordance exists anywhere in the hub.
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });
});

describe("VersionDiff — reads-only line diff", () => {
  it("diffLines is pure: marks added + removed lines", () => {
    const lines = diffLines("a\nb\nc\n", "a\nB\nc\n");
    const removed = lines.filter((l) => l.kind === "removed").map((l) => l.text);
    const added = lines.filter((l) => l.kind === "added").map((l) => l.text);
    expect(removed).toContain("b");
    expect(added).toContain("B");
  });

  it("renders the diff body with add/remove counts", () => {
    render(
      <VersionDiff
        beforeLabel="v1"
        afterLabel="v2 · sign-off"
        before={V1.body}
        after={V2_SIGNOFF.body}
      />,
    );
    expect(screen.getByTestId("version-diff")).toBeInTheDocument();
    expect(screen.getByTestId("version-diff-body")).toBeInTheDocument();
    expect(screen.getAllByTestId("version-diff-line").length).toBeGreaterThan(0);
  });

  it("identical versions render the identical state", () => {
    render(<VersionDiff beforeLabel="v1" afterLabel="v1 copy" before={V1.body} after={V1.body} />);
    expect(screen.getByTestId("version-diff-identical")).toBeInTheDocument();
  });
});
