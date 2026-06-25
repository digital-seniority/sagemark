/**
 * lifecycle-fsm tests — the safety proof for the publish gate.
 *
 * Ported from flywheel-main `origin/preview`
 * (`apps/agents/src/lib/content/lifecycle-fsm.test.ts`) into `@sagemark/core`,
 * with the SCHEMA CONTRACT (P0.S.1) delta: the human-release artifact is now a
 * `credentialed_release` (the @sagemark/schema-flywheel `credentialed_releases`
 * shape), and a `client_signoff`-shaped input is asserted to be rejected as
 * NO_HUMAN_RELEASE (criterion 4) — an advisory client approval can never satisfy
 * a publish release.
 *
 * Exhaustive over the transition table: EVERY legal transition is allowed and
 * EVERY illegal transition is rejected, plus the publish-guard predicate truth
 * table. Pure — no I/O, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  canPublish,
  canApprove,
  isLegalEdge,
  requiresSnapshot,
  hasRecordedRelease,
  hasNamedByline,
  IllegalTransitionError,
  LIFECYCLE_STATES,
  type LifecycleState,
  type TransitionContext,
  type CredentialedRelease,
  type ClientSignoff,
} from "./lifecycle-fsm";

// A valid credentialed release — the ONLY shape that satisfies the human-release
// precondition (SCHEMA CONTRACT P0.S.1).
const CREDENTIALED_RELEASE: CredentialedRelease = {
  releaseType: "credentialed_release",
  actorId: "reviewer-uuid",
  credential: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
  authorizationId: "auth-uuid",
  releasedAt: "2026-06-24T00:00:00Z",
};

// An advisory client signoff — structurally CANNOT release (no credential, no
// authorization_id). Must be rejected as NO_HUMAN_RELEASE.
const CLIENT_SIGNOFF: ClientSignoff = {
  releaseType: "client_signoff",
  actorId: "client-contact-uuid",
  releasedAt: "2026-06-24T00:00:00Z",
};

// A maximally-permissive context: PUBLISH verdict, eval ran, credentialed
// release recorded, non-YMYL, publish enabled. Tests narrow individual clauses.
function fullPublishCtx(over: Partial<TransitionContext> = {}): TransitionContext {
  return {
    verdict: "PUBLISH",
    evalRan: true,
    humanRelease: CREDENTIALED_RELEASE,
    isYmyl: false,
    author: null,
    hasCitations: undefined,
    publishEnabled: true,
    ...over,
  };
}

const ALL: LifecycleState[] = [...LIFECYCLE_STATES];

// The structurally-legal edges (before guards), straight from §9.1.
const LEGAL_EDGES: Array<[LifecycleState, LifecycleState]> = [
  ["draft", "review"],
  ["draft", "archived"],
  ["review", "approved"],
  ["review", "draft"],
  ["review", "archived"],
  ["approved", "published"],
  ["approved", "review"],
  ["approved", "archived"],
  ["published", "review"],
  ["published", "archived"],
];

function isLegalPair(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_EDGES.some(([f, t]) => f === from && t === to);
}

describe("structural edge legality (the adjacency table)", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = isLegalPair(from, to);
      it(`${from} -> ${to} is ${legal ? "a legal edge" : "ILLEGAL"}`, () => {
        expect(isLegalEdge(from, to)).toBe(legal);
      });
    }
  }

  it("rejects self-loops", () => {
    for (const s of ALL) expect(isLegalEdge(s, s)).toBe(false);
  });

  it("archived is terminal (no outgoing edges)", () => {
    for (const to of ALL) expect(isLegalEdge("archived", to)).toBe(false);
  });
});

describe("illegal transitions are rejected at the data layer", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      if (isLegalPair(from, to)) continue;
      it(`${from} -> ${to} -> ILLEGAL_EDGE`, () => {
        const d = canTransition(from, to, fullPublishCtx());
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe("ILLEGAL_EDGE");
      });
    }
  }

  it("draft -> published is rejected even with a perfect publish context", () => {
    const d = canTransition("draft", "published", fullPublishCtx());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("ILLEGAL_EDGE");
  });

  it("assertTransition throws IllegalTransitionError on an illegal edge", () => {
    expect(() => assertTransition("draft", "published", fullPublishCtx())).toThrow(
      IllegalTransitionError,
    );
  });
});

describe("draft -> review (audit) is legal regardless of verdict", () => {
  for (const verdict of ["PUBLISH", "REVIEW", "REVISE", "REJECT"] as const) {
    it(`allowed with verdict ${verdict}`, () => {
      const d = canTransition("draft", "review", fullPublishCtx({ verdict }));
      expect(d.allowed).toBe(true);
    });
  }
  it("requires a snapshot", () => {
    expect(requiresSnapshot("draft", "review")).toBe(true);
  });
});

describe("review -> approved (approve guard)", () => {
  it("allowed on PUBLISH + release + eval ran (non-YMYL)", () => {
    expect(canTransition("review", "approved", fullPublishCtx()).allowed).toBe(true);
  });
  it("allowed on REVIEW verdict (review-grade is approvable)", () => {
    expect(
      canTransition("review", "approved", fullPublishCtx({ verdict: "REVIEW" })).allowed,
    ).toBe(true);
  });
  it("REJECTED on REVISE verdict", () => {
    const d = canTransition("review", "approved", fullPublishCtx({ verdict: "REVISE" }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("VERDICT_NOT_APPROVABLE");
  });
  it("REJECTED on REJECT verdict", () => {
    const d = canTransition("review", "approved", fullPublishCtx({ verdict: "REJECT" }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("VERDICT_NOT_APPROVABLE");
  });
  it("REJECTED with no recorded human release", () => {
    const d = canTransition("review", "approved", fullPublishCtx({ humanRelease: null }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
  });
  it("REJECTED with only a client_signoff (advisory, not a release)", () => {
    const d = canTransition("review", "approved", fullPublishCtx({ humanRelease: CLIENT_SIGNOFF }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
  });
  it("REJECTED when the eval did not run", () => {
    const d = canTransition("review", "approved", fullPublishCtx({ evalRan: false }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("EVAL_DID_NOT_RUN");
  });
  it("YMYL: REJECTED with no byline", () => {
    const d = canTransition(
      "review",
      "approved",
      fullPublishCtx({ isYmyl: true, hasCitations: true, author: { name: "", credentials: "" } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("YMYL_NO_BYLINE");
  });
  it("YMYL: REJECTED with byline but no citations", () => {
    const d = canTransition(
      "review",
      "approved",
      fullPublishCtx({
        isYmyl: true,
        author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
        hasCitations: false,
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("YMYL_NO_CITATIONS");
  });
  it("YMYL: allowed with byline + credentials + citations", () => {
    const d = canTransition(
      "review",
      "approved",
      fullPublishCtx({
        isYmyl: true,
        author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
        hasCitations: true,
      }),
    );
    expect(d.allowed).toBe(true);
  });
});

describe("approved -> published (THE fail-closed gate)", () => {
  it("allowed only with PUBLISH + release + eval ran + flag on (non-YMYL)", () => {
    expect(canTransition("approved", "published", fullPublishCtx()).allowed).toBe(true);
  });

  it("BLOCKED when publishEnabled is off (fail-safe default)", () => {
    const d = canTransition("approved", "published", fullPublishCtx({ publishEnabled: false }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("PUBLISH_DISABLED");
  });

  it("BLOCKED when the eval did not run (fail-closed) — even on PUBLISH + release", () => {
    const d = canTransition("approved", "published", fullPublishCtx({ evalRan: false }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("EVAL_DID_NOT_RUN");
  });

  for (const verdict of ["REVIEW", "REVISE", "REJECT"] as const) {
    it(`BLOCKED on a non-PUBLISH verdict (${verdict})`, () => {
      const d = canTransition("approved", "published", fullPublishCtx({ verdict }));
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("NOT_PUBLISH_VERDICT");
    });
  }

  it("BLOCKED with no recorded human release (no autopilot)", () => {
    const d = canTransition("approved", "published", fullPublishCtx({ humanRelease: null }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
  });

  it("BLOCKED with only a client_signoff (advisory can never release — P0.S.1)", () => {
    const d = canTransition("approved", "published", fullPublishCtx({ humanRelease: CLIENT_SIGNOFF }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
  });

  it("BLOCKED with a credentialed release missing its authorization id", () => {
    const d = canTransition(
      "approved",
      "published",
      fullPublishCtx({
        humanRelease: { ...CREDENTIALED_RELEASE, authorizationId: "   " },
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
  });

  it("YMYL: BLOCKED with missing byline", () => {
    const d = canTransition(
      "approved",
      "published",
      fullPublishCtx({ isYmyl: true, hasCitations: true }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("YMYL_NO_BYLINE");
  });

  it("YMYL: BLOCKED with byline but missing credentials", () => {
    const d = canTransition(
      "approved",
      "published",
      fullPublishCtx({
        isYmyl: true,
        author: { name: "Dr. Jane Roe", credentials: "" },
        hasCitations: true,
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("YMYL_NO_BYLINE");
  });

  it("YMYL: BLOCKED with byline + credentials but missing citations", () => {
    const d = canTransition(
      "approved",
      "published",
      fullPublishCtx({
        isYmyl: true,
        author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
        hasCitations: false,
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("YMYL_NO_CITATIONS");
  });

  it("YMYL: allowed with PUBLISH + release + eval ran + byline + credentials + citations + flag on", () => {
    const d = canTransition(
      "approved",
      "published",
      fullPublishCtx({
        isYmyl: true,
        author: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
        hasCitations: true,
      }),
    );
    expect(d.allowed).toBe(true);
  });

  it("requires a snapshot before the move", () => {
    expect(requiresSnapshot("approved", "published")).toBe(true);
  });
});

describe("reversible moves (no gate)", () => {
  it("review -> draft (revise loop) is always legal", () => {
    expect(canTransition("review", "draft", fullPublishCtx({ verdict: "REVISE" })).allowed).toBe(
      true,
    );
  });
  it("published -> review (unpublish) is legal", () => {
    expect(canTransition("published", "review", fullPublishCtx()).allowed).toBe(true);
  });
  it("published -> archived (retire) is legal", () => {
    expect(canTransition("published", "archived", fullPublishCtx()).allowed).toBe(true);
  });
  it("any state -> archived is legal", () => {
    for (const from of ["draft", "review", "approved", "published"] as LifecycleState[]) {
      expect(canTransition(from, "archived", fullPublishCtx()).allowed).toBe(true);
    }
  });
  it("forward moves do not include reversible/archive moves in the snapshot set", () => {
    expect(requiresSnapshot("review", "draft")).toBe(false);
    expect(requiresSnapshot("published", "review")).toBe(false);
    expect(requiresSnapshot("draft", "archived")).toBe(false);
  });
});

describe("canPublish predicate truth table", () => {
  it("true on the full positive case", () => {
    expect(canPublish(fullPublishCtx())).toBe(true);
  });
  it("false when flag off", () => {
    expect(canPublish(fullPublishCtx({ publishEnabled: false }))).toBe(false);
  });
  it("false when verdict !== PUBLISH", () => {
    for (const v of ["REVIEW", "REVISE", "REJECT", null] as const) {
      expect(canPublish(fullPublishCtx({ verdict: v }))).toBe(false);
    }
  });
  it("false when eval did not run", () => {
    expect(canPublish(fullPublishCtx({ evalRan: false }))).toBe(false);
  });
  it("false with no release", () => {
    expect(canPublish(fullPublishCtx({ humanRelease: null }))).toBe(false);
  });
  it("false with only a client_signoff (P0.S.1 — never satisfies the release)", () => {
    expect(canPublish(fullPublishCtx({ humanRelease: CLIENT_SIGNOFF }))).toBe(false);
  });
  it("YMYL requires byline + credentials + citations", () => {
    expect(canPublish(fullPublishCtx({ isYmyl: true }))).toBe(false);
    expect(
      canPublish(
        fullPublishCtx({
          isYmyl: true,
          author: { name: "Dr. Jane Roe", credentials: "RN" },
          hasCitations: true,
        }),
      ),
    ).toBe(true);
  });
});

// ── Criterion 4 — a client_signoff-shaped release is NO_HUMAN_RELEASE ─────────

describe("SCHEMA CONTRACT (P0.S.1) — only a credentialed_release satisfies the release", () => {
  it("a credentialed_release satisfies the human-release precondition", () => {
    expect(hasRecordedRelease(CREDENTIALED_RELEASE)).toBe(true);
  });
  it("a client_signoff-shaped input is rejected (NO_HUMAN_RELEASE) on publish", () => {
    const d = canTransition("approved", "published", fullPublishCtx({ humanRelease: CLIENT_SIGNOFF }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_HUMAN_RELEASE");
    expect(hasRecordedRelease(CLIENT_SIGNOFF)).toBe(false);
  });
  it("a YMYL piece cannot be released by a client_signoff", () => {
    expect(
      canPublish(
        fullPublishCtx({
          humanRelease: CLIENT_SIGNOFF,
          isYmyl: true,
          author: { name: "Dr. Jane Roe", credentials: "RN" },
          hasCitations: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("canApprove predicate", () => {
  it("true on PUBLISH/REVIEW + release + eval ran", () => {
    expect(canApprove(fullPublishCtx())).toBe(true);
    expect(canApprove(fullPublishCtx({ verdict: "REVIEW" }))).toBe(true);
  });
  it("false on REVISE/REJECT", () => {
    expect(canApprove(fullPublishCtx({ verdict: "REVISE" }))).toBe(false);
    expect(canApprove(fullPublishCtx({ verdict: "REJECT" }))).toBe(false);
  });
  it("false with only a client_signoff", () => {
    expect(canApprove(fullPublishCtx({ humanRelease: CLIENT_SIGNOFF }))).toBe(false);
  });
});

describe("guard helpers", () => {
  it("hasRecordedRelease accepts a credentialed_release, rejects everything else", () => {
    expect(hasRecordedRelease(CREDENTIALED_RELEASE)).toBe(true);
    expect(hasRecordedRelease({ ...CREDENTIALED_RELEASE, actorId: "  " })).toBe(false);
    expect(hasRecordedRelease({ ...CREDENTIALED_RELEASE, authorizationId: "" })).toBe(false);
    expect(hasRecordedRelease(CLIENT_SIGNOFF)).toBe(false);
    expect(hasRecordedRelease(null)).toBe(false);
    expect(hasRecordedRelease(undefined)).toBe(false);
  });
  it("hasNamedByline", () => {
    expect(hasNamedByline({ name: "Jane", credentials: "RN" })).toBe(true);
    expect(hasNamedByline({ name: "Jane", credentials: "" })).toBe(false);
    expect(hasNamedByline({ name: "", credentials: "RN" })).toBe(false);
    expect(hasNamedByline(null)).toBe(false);
  });
});
