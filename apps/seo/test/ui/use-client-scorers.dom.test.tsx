// @vitest-environment jsdom

/**
 * PR 011 / P1.U.2 — use-client-scorers live-preview tests (jsdom).
 *
 * Asserts the zero-credit deterministic preview hook recomputes over the live body
 * via @testing-library/react's `renderHook`: the projection moves as the body
 * changes (keyword density rises when the keyword is added, readability/passive/
 * content-score populate), and the numbers MATCH the real @sagemark/core scorers
 * called directly (proving it reuses them rather than re-implementing). No model
 * call, no gate run — pure deterministic memo.
 */

import "./setup-dom";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useClientScorers } from "@/app/(studio)/inspector/use-client-scorers";
import {
  computeFleschKincaid,
  analyzeKeywordDensity,
  detectPassiveVoice,
  scoreContentBreakdown,
} from "@sagemark/core";

const KEYWORD = "memory care";
const BODY_A = "Memory care is a service. It helps families a lot. The text is short.";
const BODY_B =
  "Memory care is a specialized service for families. " +
  "Memory care supports daily living. Memory care staff are trained. " +
  "Many families choose memory care after a diagnosis. ".repeat(4);

describe("useClientScorers — zero-credit deterministic live preview", () => {
  it("recomputes the projection when the body changes", () => {
    const { result, rerender } = renderHook(
      ({ body, kw }) => useClientScorers(body, kw),
      { initialProps: { body: BODY_A, kw: KEYWORD } },
    );

    const first = result.current;
    expect(first.hasBody).toBe(true);
    expect(first.wordCount).toBeGreaterThan(0);

    rerender({ body: BODY_B, kw: KEYWORD });
    const second = result.current;
    // The keyword appears far more often in BODY_B -> density rises.
    expect(second.keyword.occurrences).toBeGreaterThan(first.keyword.occurrences);
    expect(second.wordCount).toBeGreaterThan(first.wordCount);
  });

  it("matches the real @sagemark/core scorers (reuse, not re-implementation)", () => {
    const { result } = renderHook(() => useClientScorers(BODY_B, KEYWORD));
    const c = result.current;

    expect(c.readability).toEqual(computeFleschKincaid(BODY_B));
    expect(c.keyword).toEqual(analyzeKeywordDensity(BODY_B, KEYWORD));
    expect(c.passive).toEqual(detectPassiveVoice(BODY_B));
    expect(c.content).toEqual(scoreContentBreakdown(BODY_B, KEYWORD));
  });

  it("handles an empty body without throwing (hasBody=false)", () => {
    const { result } = renderHook(() => useClientScorers("", KEYWORD));
    expect(result.current.hasBody).toBe(false);
    expect(result.current.wordCount).toBe(0);
    // Still returns real scorer shapes (never null).
    expect(result.current.content.dimensions.length).toBeGreaterThan(0);
  });

  it("tolerates a missing keyword (null) for density", () => {
    const { result } = renderHook(() => useClientScorers(BODY_A, null));
    expect(result.current.keyword.occurrences).toBe(0);
  });
});
