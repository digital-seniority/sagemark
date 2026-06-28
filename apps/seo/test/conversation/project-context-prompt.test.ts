/**
 * Slice 5 — composeTurnPrompt carries PROJECT CONTEXT (node).
 *
 * Asserts the project context note is injected as a fenced DATA block on both the
 * first-turn (generate) and revision shapes, and is absent when no note is given.
 */

import { describe, it, expect } from "vitest";

import { composeTurnPrompt } from "@/lib/conversation/compose-turn-prompt";

const NOTE = "This article belongs to the project \"Dementia Care Hub\". Keep continuity.";

describe("composeTurnPrompt — project context injection", () => {
  it("injects the note as fenced DATA on a first turn", () => {
    const brief = composeTurnPrompt({
      newMessage: "Draft a spoke on early signs of dementia.",
      transcript: [],
      projectContextNote: NOTE,
    });
    expect(brief).toContain("PROJECT CONTEXT (data):");
    expect(brief).toContain("Dementia Care Hub");
  });

  it("injects the note on a revision turn too", () => {
    const brief = composeTurnPrompt({
      newMessage: "Make the intro warmer.",
      transcript: [{ role: "user", content: "first" }],
      currentDraft: { title: "T", body: "# T\n\nExisting body." },
      projectContextNote: NOTE,
    });
    expect(brief).toContain("PROJECT CONTEXT (data):");
    expect(brief).toContain("Dementia Care Hub");
  });

  it("omits the block when there is no project context", () => {
    const brief = composeTurnPrompt({ newMessage: "Draft something.", transcript: [] });
    expect(brief).not.toContain("PROJECT CONTEXT");
  });
});
