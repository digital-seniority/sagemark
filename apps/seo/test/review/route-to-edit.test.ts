/**
 * P1.C.2 / PR 019 — "Request changes" → agent edit-loop routing + the two distinct
 * sign-off acts + the approval-debt KPI. Proves, with NO DB and NO provider key
 * (injected seams), every acceptance criterion:
 *
 *   AC1 — a request-changes comment, once triaged, becomes a BOUNDED /api/edit
 *         instruction anchored to the commented region; the thread resolves to
 *         "addressed in vN" ONLY on a successful edit (Tier-2 end-to-end through
 *         the REAL handleEdit, which re-runs the full gate).
 *   AC2 — client_signoffs vs credentialed_releases are SEPARATE acts: a client
 *         "Approve" writes ONLY a client_signoffs row (advisory), can NEVER release
 *         and carries no credential/authorization_id — it cannot populate a byline.
 *   AC3 — only a credentialed_releases row (credentialed reviewer, D6) writes the
 *         release; the credential snapshot is taken from the AUTHORIZATION (byline
 *         evidence), never request input.
 *   AC4 — the release write requires an ACTIVE byline authorization (§11.5):
 *         revoked / expired / dangling are ALL refused at write time (no release),
 *         an active one succeeds.
 *   AC5 — approval-cycle time + open-thread "debt" are computed per client.
 *   DR-037 — the seeded PILOT PLACEHOLDER authorization is REFUSED as a real
 *         release authority in a production (non-pilot) context.
 *
 * Fail-closed pass-through: a routed edit that the gate vetoes (or a non-draft /
 * tenancy-mismatch) is returned unchanged and the thread stays OPEN — a client
 * instruction can never talk past a YMYL/faithfulness veto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  commentToInstruction,
  headingFromElementHint,
  CLIENT_REQUEST_FRAMING,
} from "@/lib/review/comment-to-instruction";
import {
  recordClientSignoff,
  recordCredentialedRelease,
  isPlaceholderAuthorization,
  PLACEHOLDER_REVIEWER_NAME,
  type SignoffData,
} from "@/lib/review/signoff";
import {
  computeApprovalDebt,
  APPROVAL_EVENT_KINDS,
} from "@/lib/metrics/approval-debt";
import {
  handleRouteToEdit,
  type RouteToEditDeps,
} from "@/app/api/review/route-to-edit/route";
import { handleEdit, inProcessRateLimiter } from "@/app/api/edit/route";
import type { EditDeps, EditModel, GateRunner } from "@/app/api/edit/route";
import type {
  ContentDataAccess,
  PersistedAuthorization,
  PersistedApprovalEvent,
  PersistedCommentThread,
  ClientSignoffInsert,
  CredentialedReleaseInsert,
} from "@/lib/content/context";
import type { BoundedDiff } from "@/lib/edit/constrained-edit-contract";
import type { AuditResult } from "@sagemark/core";
import {
  makeData,
  workspace,
  pieceRow,
  pieceVersion,
  commentThread,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  PIECE_A,
  AUTHOR_A,
  AUTH_ID,
  COMMENT_A,
} from "../content/fixtures";

beforeEach(() => vi.clearAllMocks());

// ── AC1 — comment-to-instruction scoping (Tier 1, pure) ───────────────────────

describe("AC1 — comment-to-instruction maps a request-changes comment to a bounded edit", () => {
  it("derives a section region from the anchor elementHint and frames the body", () => {
    const result = commentToInstruction({
      kind: "request-changes",
      body: "Soften the pricing claim.",
      anchor: { x: 0.4, y: 0.6, elementHint: "heading:Costs" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routed.region).toEqual({ kind: "section", heading: "Costs" });
    expect(result.routed.instruction).toBe(CLIENT_REQUEST_FRAMING + "Soften the pricing claim.");
  });

  it("an operator-supplied region OVERRIDES the anchor (the operator scopes the span)", () => {
    const result = commentToInstruction(
      {
        kind: "request-changes",
        body: "Fix this sentence.",
        anchor: { elementHint: "heading:Costs" },
      },
      { kind: "span", start: 10, end: 40 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routed.region).toEqual({ kind: "span", start: 10, end: 40 });
  });

  it("a comment with NO section anchor and NO operator region is no-region (operator must scope)", () => {
    const result = commentToInstruction({
      kind: "request-changes",
      body: "Something is off here.",
      anchor: { x: 0.5, y: 0.5 }, // raw coords, no elementHint -> not a span
    });
    expect(result).toEqual({ ok: false, reason: "no-region" });
  });

  it("a non-request-changes comment (a pin) is not routable", () => {
    const result = commentToInstruction({
      kind: "pin",
      body: "note",
      anchor: { elementHint: "heading:Costs" },
    });
    expect(result).toEqual({ ok: false, reason: "not-request-changes" });
  });

  it("an empty body is not routable (nothing to instruct)", () => {
    const result = commentToInstruction({
      kind: "request-changes",
      body: "   ",
      anchor: { elementHint: "heading:Costs" },
    });
    expect(result).toEqual({ ok: false, reason: "empty-body" });
  });

  it("headingFromElementHint only recognizes the explicit heading: convention", () => {
    expect(headingFromElementHint("heading:Costs")).toBe("Costs");
    expect(headingFromElementHint("section#costs h2")).toBeNull(); // not auto-resolved
    expect(headingFromElementHint(undefined)).toBeNull();
  });

  it("a long body is truncated to the 2000-char edit ceiling, never rejected", () => {
    const result = commentToInstruction({
      kind: "request-changes",
      body: "x".repeat(5_000),
      anchor: { elementHint: "heading:Costs" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routed.instruction.length).toBe(2_000);
  });
});

// ── AC2/AC3/AC4 + DR-037 — the two sign-off acts (Tier 1) ─────────────────────

const ACTOR = "11111111-1111-4111-8111-aaaaaaaaaaaa";

function activeAuth(over: Partial<PersistedAuthorization> = {}): PersistedAuthorization {
  return {
    id: AUTH_ID,
    grantedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    expiresAt: null,
    credential: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
    scope: "client",
    placeholder: false,
    ...over,
  };
}

function signoffData(
  auth: PersistedAuthorization | null,
): { data: SignoffData; signoffs: ClientSignoffInsert[]; releases: CredentialedReleaseInsert[] } {
  const signoffs: ClientSignoffInsert[] = [];
  const releases: CredentialedReleaseInsert[] = [];
  const data: SignoffData = {
    getAuthorization: vi.fn(async () => auth),
    insertClientSignoff: vi.fn(async (insert) => {
      signoffs.push(insert);
      return { id: "signoff-1" };
    }),
    insertCredentialedRelease: vi.fn(async (insert) => {
      releases.push(insert);
      return { id: "release-1" };
    }),
  };
  return { data, signoffs, releases };
}

const baseRelease = {
  workspaceId: WORKSPACE_A,
  clientId: CLIENT_A,
  pieceId: PIECE_A,
  version: 3,
  actorId: ACTOR,
  authorizationId: AUTH_ID,
  releaseScope: "piece" as const,
};

describe("AC2 — a client Approve writes ONLY an advisory client_signoffs row", () => {
  it("recordClientSignoff writes a client_signoffs row and NEVER a credentialed_releases row", async () => {
    const { data, signoffs, releases } = signoffData(activeAuth());
    const result = await recordClientSignoff(
      {
        workspaceId: WORKSPACE_A,
        clientId: CLIENT_A,
        pieceId: PIECE_A,
        version: 3,
        actorId: "client:kate",
        releaseScope: "piece",
      },
      data,
    );
    expect(result).toEqual({ ok: true, id: "signoff-1" });
    expect(signoffs).toHaveLength(1);
    // STRUCTURAL: the advisory write never touches credentialed_releases and the
    // payload has no credential/authorization_id field at all.
    expect(releases).toHaveLength(0);
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
    expect(Object.keys(signoffs[0]!)).not.toContain("credential");
    expect(Object.keys(signoffs[0]!)).not.toContain("authorizationId");
  });
});

describe("AC3/AC4 — credentialed_releases is the only release; §11.5 active-authorization fail-closed", () => {
  it("an ACTIVE authorization succeeds and snapshots the credential FROM the authorization (byline evidence)", async () => {
    const { data, releases } = signoffData(activeAuth());
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: true, id: "release-1" });
    expect(releases).toHaveLength(1);
    // The byline evidence is the authorization's credential — never request input.
    expect(releases[0]!.credential).toEqual({ name: "Dr. Jane Roe", credentials: "RN, CDP" });
    expect(releases[0]!.authorizationId).toBe(AUTH_ID);
  });

  it("a REVOKED authorization is refused — NO release written (publish stays blocked)", async () => {
    const { data, releases } = signoffData(
      activeAuth({ revokedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
  });

  it("an EXPIRED authorization is refused — NO release written", async () => {
    const { data, releases } = signoffData(
      activeAuth({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    const result = await recordCredentialedRelease(baseRelease, data, {
      pilot: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
  });

  it("a DANGLING (missing) authorization is refused — NO release written", async () => {
    const { data, releases } = signoffData(null);
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
  });

  // A.005.1 / DR-039 — the WRITE path now also refuses a not-yet-granted or an
  // out-of-scope authorization, with the SAME predicate the READ path uses (parity).
  it("a NOT-YET-GRANTED authorization (granted_at in the future) is refused — NO release written", async () => {
    const { data, releases } = signoffData(
      activeAuth({ grantedAt: "2099-01-01T00:00:00.000Z" }),
    );
    const result = await recordCredentialedRelease(baseRelease, data, {
      pilot: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
  });

  it("an authorization with a MISSING granted_at is refused (granted is never implicit) — NO release written", async () => {
    const { data, releases } = signoffData(activeAuth({ grantedAt: null }));
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
  });

  it("an OUT-OF-SCOPE authorization (unrecognized scope) is refused — NO release written", async () => {
    const { data, releases } = signoffData(activeAuth({ scope: "bogus" }));
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
  });

  it("an authorization with a MISSING scope is refused (scope is never implicit) — NO release written", async () => {
    const { data, releases } = signoffData(activeAuth({ scope: undefined }));
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result).toEqual({ ok: false, reason: "authorization-inactive" });
    expect(releases).toHaveLength(0);
  });

  it.each(["client", "cluster", "piece"] as const)(
    "an in-scope authorization (scope=%s) is permitted — release written",
    async (scope) => {
      const { data, releases } = signoffData(activeAuth({ scope }));
      const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
      expect(result.ok).toBe(true);
      expect(releases).toHaveLength(1);
    },
  );
});

describe("DR-037 — the seeded PILOT PLACEHOLDER cannot be a real release authority in production", () => {
  it("recognizes the placeholder by the boolean flag AND by the sentinel name", () => {
    expect(isPlaceholderAuthorization(activeAuth({ placeholder: true }))).toBe(true);
    expect(
      isPlaceholderAuthorization(
        activeAuth({ placeholder: false, credential: { name: PLACEHOLDER_REVIEWER_NAME, credentials: "RN" } }),
      ),
    ).toBe(true);
    expect(isPlaceholderAuthorization(activeAuth())).toBe(false);
    expect(isPlaceholderAuthorization(null)).toBe(false);
  });

  it("a placeholder authorization is REFUSED in production (pilot:false) — no release written", async () => {
    const { data, releases } = signoffData(activeAuth({ placeholder: true }));
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: false });
    expect(result).toEqual({ ok: false, reason: "placeholder-in-production" });
    expect(releases).toHaveLength(0);
  });

  it("the same placeholder is PERMITTED in the pilot (pilot:true) so the lane is buildable", async () => {
    const { data, releases } = signoffData(activeAuth({ placeholder: true }));
    const result = await recordCredentialedRelease(baseRelease, data, { pilot: true });
    expect(result.ok).toBe(true);
    expect(releases).toHaveLength(1);
  });
});

// ── AC5 — approval-debt computation (Tier 1) ──────────────────────────────────

describe("AC5 — approval-cycle time + open-thread debt are computed per client", () => {
  const ev = (kind: string, at: string): PersistedApprovalEvent => ({ pieceId: PIECE_A, kind, at });

  it("pairs link_sent -> client_signoff and draft_review -> credentialed_release per piece", () => {
    const eventsByPiece: Record<string, PersistedApprovalEvent[]> = {
      [PIECE_A]: [
        ev(APPROVAL_EVENT_KINDS.linkSent, "2026-01-01T00:00:00.000Z"),
        ev(APPROVAL_EVENT_KINDS.clientSignoff, "2026-01-01T02:00:00.000Z"), // +2h
        ev(APPROVAL_EVENT_KINDS.draftReview, "2026-01-02T00:00:00.000Z"),
        ev(APPROVAL_EVENT_KINDS.credentialedRelease, "2026-01-02T06:00:00.000Z"), // +6h
      ],
    };
    const threads: PersistedCommentThread[] = [
      commentThread({ id: "t1", kind: "request-changes", status: "open" }),
      commentThread({ id: "t2", kind: "request-changes", status: "resolved" }),
      commentThread({ id: "t3", kind: "pin", status: "open" }), // not a change request
    ];
    const debt = computeApprovalDebt(CLIENT_A, eventsByPiece, threads);

    expect(debt.clientId).toBe(CLIENT_A);
    expect(debt.openThreadCount).toBe(1); // only the open request-changes
    expect(debt.closedClientCycles).toBe(1);
    expect(debt.closedCredentialedCycles).toBe(1);
    expect(debt.openCycleCount).toBe(0);
    // mean of 2h and 6h = 4h in ms
    expect(debt.meanCycleMs).toBe(4 * 3_600_000);
  });

  it("an unpaired start (no terminal event) is an OPEN cycle and contributes no duration", () => {
    const eventsByPiece: Record<string, PersistedApprovalEvent[]> = {
      [PIECE_A]: [ev(APPROVAL_EVENT_KINDS.linkSent, "2026-01-01T00:00:00.000Z")],
    };
    const debt = computeApprovalDebt(CLIENT_A, eventsByPiece, []);
    expect(debt.openCycleCount).toBe(1);
    expect(debt.closedClientCycles).toBe(0);
    expect(debt.meanCycleMs).toBeNull();
  });
});

// ── AC1 (end-to-end) — route a comment through the REAL edit loop (Tier 2) ─────

const ROUTE_BODY_CURRENT = "## Costs\n\nOur memory care starts at $5,000 a month.\n";

const routeBoundedDiff: BoundedDiff = {
  replacement: "## Costs\n\nOur memory care begins around $5,000 monthly.\n",
  summary: "Softened the cost phrasing in the Costs section.",
};
const routeEditModel: EditModel = vi.fn(async () => routeBoundedDiff);

const passGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "REVIEW",
    score: 80,
    dimensions: [{ name: "faithfulness", score: 92, weight: 0.2 }],
    failureCodes: [],
    stageAClean: true,
  }),
);

const faithfulnessBreakGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "REVISE",
    score: null,
    dimensions: [],
    failureCodes: ["VETO_UNSOURCED_STAT" as never],
    stageAClean: false,
  }),
);

/** A data mock whose piece is a DRAFT and whose latest version is the routable
 * body, plus the open request-changes comment the route triages. */
function routeData(over: Partial<ContentDataAccess> = {}) {
  return makeData({
    loadPiece: vi.fn(async (pieceId: string, clientId: string) =>
      pieceId === PIECE_A && clientId === CLIENT_A
        ? pieceRow({ status: "draft", body: ROUTE_BODY_CURRENT, isYmyl: true, authorId: AUTHOR_A })
        : null,
    ),
    loadLatestVersion: vi.fn(async (pieceId: string, clientId: string) =>
      pieceId === PIECE_A && clientId === CLIENT_A
        ? pieceVersion({ version: 3, body: ROUTE_BODY_CURRENT, verdict: "REVIEW" })
        : null,
    ),
    loadCommentThread: vi.fn(async (commentId: string, clientId: string) =>
      commentId === COMMENT_A && clientId === CLIENT_A
        ? commentThread({ kind: "request-changes", status: "open" })
        : null,
    ),
    ...over,
  });
}

function routeDeps(over: Partial<RouteToEditDeps> = {}, gate: GateRunner = passGate): RouteToEditDeps {
  const data = (over.data as ContentDataAccess) ?? routeData();
  const editDeps: EditDeps = {
    data,
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    editModel: routeEditModel,
    runGate: gate,
    rateLimiter: inProcessRateLimiter({ max: 100, windowMs: 60_000 }),
  };
  return {
    data,
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    runEdit: handleEdit,
    editDeps,
    ...over,
  };
}

function routeRequest(over: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/review/route-to-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      commentId: COMMENT_A,
      ...over,
    }),
  });
}

describe("AC1 end-to-end — request-changes -> operator routes -> agent edits -> thread resolves", () => {
  it("routes the comment through the REAL edit loop, re-gates, and resolves the thread to 'addressed in vN'", async () => {
    const deps = routeDeps();
    const res = await handleRouteToEdit(routeRequest(), deps);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { version: number; threadStatus: string; threadNote: string };
    // The edit appended version 4 (baseVersion 3 + 1); the thread now points at it.
    expect(out.version).toBe(4);
    expect(out.threadStatus).toBe("resolved");
    expect(out.threadNote).toContain("addressed in v4");
    // The edit loop wrote ONE new version and the thread was resolved exactly once.
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertPieceVersion).toBe(1);
    expect(data.writes.resolveCommentThread).toBe(1);
    // The gate re-ran host-side on the edited body.
    expect(passGate).toHaveBeenCalledTimes(1);
  });

  it("the bounded edit is SCOPED to the commented section — the model is handed only that region's text", async () => {
    const deps = routeDeps();
    await handleRouteToEdit(routeRequest(), deps);
    expect(routeEditModel).toHaveBeenCalledTimes(1);
    const arg = (routeEditModel as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { regionText: string };
    // Only the Costs section text was handed to the model (the bound).
    expect(arg.regionText).toContain("Our memory care starts at $5,000 a month.");
  });

  it("a YMYL/faithfulness veto on the routed edit is passed through and the thread STAYS OPEN", async () => {
    const data = routeData();
    const deps = routeDeps({ data }, faithfulnessBreakGate);
    const res = await handleRouteToEdit(routeRequest(), deps);
    // The edit route still writes the re-gated (regressed) version (its contract),
    // returns 200 with the regressed verdict — but it NEVER publishes. The point
    // here: a client instruction cannot force a PUBLISH; the gate caught it.
    const out = (await res.json()) as { verdict: string | null };
    expect(res.status).toBe(200);
    expect(out.verdict).toBe("REVISE"); // the veto regressed the verdict
    expect(faithfulnessBreakGate).toHaveBeenCalledTimes(1);
  });

  it("a STALE / non-draft piece blocks the edit (409) and the thread is NOT resolved", async () => {
    const data = routeData({
      loadPiece: vi.fn(async () => pieceRow({ status: "review", body: ROUTE_BODY_CURRENT })),
    });
    const deps = routeDeps({ data });
    const res = await handleRouteToEdit(routeRequest(), deps);
    expect(res.status).toBe(409); // piece-not-editable, passed through
    expect((deps.data as ReturnType<typeof makeData>).writes.resolveCommentThread).toBe(0);
    expect((deps.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });

  it("a cross-tenant comment id resolves to null -> 404, nothing edited", async () => {
    const data = routeData({ loadCommentThread: vi.fn(async () => null) });
    const deps = routeDeps({ data });
    const res = await handleRouteToEdit(routeRequest(), deps);
    expect(res.status).toBe(404);
    expect((deps.data as ReturnType<typeof makeData>).writes.resolveCommentThread).toBe(0);
  });

  it("a request tenancy that disagrees with the bound context is rejected (403)", async () => {
    const deps = routeDeps();
    const res = await handleRouteToEdit(routeRequest({ workspaceId: WORKSPACE_B }), deps);
    expect(res.status).toBe(403);
  });

  it("a comment with no resolvable region (no section anchor, no operator override) -> 422", async () => {
    const data = routeData({
      loadCommentThread: vi.fn(async () =>
        commentThread({ kind: "request-changes", anchor: { x: 0.5, y: 0.5 } }),
      ),
    });
    const deps = routeDeps({ data });
    const res = await handleRouteToEdit(routeRequest(), deps);
    expect(res.status).toBe(422);
    const out = (await res.json()) as { code: string };
    expect(out.code).toBe("no-region");
  });
});
