/**
 * PR 002 acceptance criterion 4:
 *   A thrown scorer surfaces as a fail-closed error, never a silent pass
 *   (inject a throw and assert the gate composer would veto).
 *
 * The composition primitive {@link runScorersFailClosed} is the host-side
 * backstop that turns "a scorer threw" into a hard VETO rather than letting the
 * missing score default to a pass. These tests inject a throwing scorer and
 * prove the composer vetoes (and that a clean run still passes).
 */

import { describe, expect, it } from "vitest";

import {
  runScorersFailClosed,
  VETO_SCORER_THREW,
  type NamedScorer,
} from "./compose";
import { scoreContent } from "./content-score";

describe("runScorersFailClosed — fail-closed scorer composition", () => {
  it("passes when every scorer runs without throwing", () => {
    const scorers: NamedScorer[] = [
      { name: "content-score", run: () => scoreContent("## A\n\nBody.", "a") },
      { name: "trivial", run: () => 42 },
    ];

    const result = runScorersFailClosed(scorers);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.results).toHaveLength(2);
      expect(result.results[1]?.result).toBe(42);
    }
  });

  it("VETOES (does not silently pass) when a scorer throws", () => {
    const scorers: NamedScorer[] = [
      { name: "ok-scorer", run: () => 1 },
      {
        name: "exploding-scorer",
        run: () => {
          throw new Error("scorer blew up");
        },
      },
      {
        name: "never-reached",
        run: () => {
          throw new Error("should not run after the veto");
        },
      },
    ];

    const result = runScorersFailClosed(scorers);

    // The critical assertion: a throw is a VETO, never a silent pass.
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failureCode).toBe(VETO_SCORER_THREW);
      expect(result.scorer).toBe("exploding-scorer");
      expect(result.reason).toContain("scorer blew up");
    }
  });

  it("short-circuits on the FIRST throw and never reports passed:true with a thrown scorer present", () => {
    let secondRan = false;
    const scorers: NamedScorer[] = [
      {
        name: "first-throws",
        run: () => {
          throw new Error("boom");
        },
      },
      {
        name: "second",
        run: () => {
          secondRan = true;
          return "value";
        },
      },
    ];

    const result = runScorersFailClosed(scorers);

    expect(result.passed).toBe(false);
    // Fail-closed short-circuit: nothing after the throw runs.
    expect(secondRan).toBe(false);
  });

  it("handles a non-Error throw (string) without crashing — still a veto", () => {
    const result = runScorersFailClosed([
      {
        name: "string-thrower",
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        run: () => {
          throw "raw string failure";
        },
      },
    ]);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failureCode).toBe(VETO_SCORER_THREW);
      expect(result.reason).toContain("raw string failure");
    }
  });
});
