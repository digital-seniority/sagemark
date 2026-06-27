/**
 * /api/publish (studio) — the fail-closed publish TRUTH TABLE (PR 009 / P0.S.2).
 *
 * Proves the operator-console publish endpoint drives the SAME `@sagemark/core`
 * `canPublish()` gate as the worker kernel route (it delegates to the shared
 * `handlePublish`), and enforces every fail-closed precondition HOST-SIDE:
 *
 *   - a `client_signoff` can NEVER satisfy a release  → NO_HUMAN_RELEASE
 *   - a `credentialed_release` with an ACTIVE authorization → permitted, byline
 *     resolved from the credential snapshot
 *   - a revoked / expired / inactive / dangling authorization → fail-closed block
 *   - a non-PUBLISH verdict → VERDICT_NOT_PUBLISH (no autopilot)
 *   - the global flag off → 403 (fail-safe)
 *   - a forged `request.author` is IGNORED — the byline is server-resolved
 *   - evalRan is bound to the persisted gate_results.eval_ran row (A.011.7): a
 *     Stage-A veto (verdict set, eval_score null, eval_ran false) BLOCKS.
 *
 * Reuses the content-route fixtures (the spying ContentDataAccess) so the truth is
 * the same one the kernel route is held to.
 */

import { describe, it, expect, vi } from "vitest";
import { handleStudioPublish } from "@/app/api/publish/route";
import {
  makeData,
  workspace,
  pieceRow,
  gateResult,
  jsonRequest,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
  AUTH_ID,
} from "../content/fixtures";
import type {
  PersistedRelease,
  PersistedAuthorization,
} from "@/lib/content/context";

const flagOn = () => true;

/** An approved, PUBLISH-verdict piece ready to publish (graded source present). */
function publishablePiece(over = {}) {
  return pieceRow({
    status: "approved",
    verdict: "PUBLISH",
    evalScore: 90,
    isYmyl: false,
    briefSnapshot: {
      keyword: "k",
      isYmyl: false,
      sources: [
        {
          url: "https://nia.nih.gov/x",
          domain: "nia.nih.gov",
          title: "t",
          snippet: "s",
          fetchedAt: "t",
          authorityClass: "medical-authority",
        },
      ],
    },
    ...over,
  });
}

const credentialedRelease: PersistedRelease = {
  releaseType: "credentialed_release",
  actorId: "reviewer-1",
  credential: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
  authorizationId: AUTH_ID,
};

const clientSignoff: PersistedRelease = {
  releaseType: "client_signoff",
  actorId: "client-contact-1",
};

const activeAuth: PersistedAuthorization = {
  id: AUTH_ID,
  grantedAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
  expiresAt: null,
  scope: "client",
};

function pubBody(over: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    pieceId: PIECE_A,
    action: "publish",
    ...over,
  };
}

function deps(over = {}) {
  return {
    data: makeData(over),
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    publishEnabled: flagOn,
  };
}

// ── The truth table ───────────────────────────────────────────────────────────

describe("/api/publish truth table — fail-closed canPublish", () => {
  it("PERMITTED: PUBLISH + evalRan + ACTIVE credentialed release → 200 published", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => gateResult()),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("published");
    expect(d.data.writes.transitionPieceStatus).toBe(1);
  });

  it("BLOCKED: a client_signoff can NEVER release → 422 NO_HUMAN_RELEASE, no write", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => clientSignoff),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });

  it("BLOCKED: no recorded release at all → 422 NO_HUMAN_RELEASE", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => null),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });

  it.each([
    // Each inactive case carries an otherwise-valid grant + scope so the ONLY
    // failing condition is the one under test (non-vacuous: proves revoked /
    // expired specifically block, not just an incidentally-missing field).
    ["revoked", { id: AUTH_ID, grantedAt: "2025-01-01T00:00:00Z", revokedAt: "2026-01-01T00:00:00Z", expiresAt: null, scope: "client" }],
    ["expired", { id: AUTH_ID, grantedAt: "2019-01-01T00:00:00Z", revokedAt: null, expiresAt: "2020-01-01T00:00:00Z", scope: "client" }],
    ["not-yet-granted (future grant)", { id: AUTH_ID, grantedAt: "2099-01-01T00:00:00Z", revokedAt: null, expiresAt: null, scope: "client" }],
    ["out-of-scope (unrecognized scope)", { id: AUTH_ID, grantedAt: "2025-01-01T00:00:00Z", revokedAt: null, expiresAt: null, scope: "bogus" }],
    ["out-of-scope (missing scope)", { id: AUTH_ID, grantedAt: "2025-01-01T00:00:00Z", revokedAt: null, expiresAt: null, scope: undefined }],
    ["dangling (missing)", null],
  ])(
    "BLOCKED: a credentialed release with a %s authorization → 422, no write, byline never resolved",
    async (_label, auth) => {
      const d = deps({
        loadPiece: vi.fn(async () => publishablePiece({ isYmyl: true })),
        getRelease: vi.fn(async () => credentialedRelease),
        getAuthorization: vi.fn(async () => auth as PersistedAuthorization | null),
        getGateResult: vi.fn(async () => gateResult()),
      });
      const res = await handleStudioPublish(jsonRequest(pubBody()), d);
      expect(res.status).toBe(422);
      // YMYL piece: a downgraded release leaves no byline → the FSM blocks before
      // it would publish. The reason is a stable FSM code (NO_HUMAN_RELEASE, since
      // a null release fails the human-release clause first).
      expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
      expect(d.data.writes.transitionPieceStatus).toBe(0);
    },
  );

  it("BLOCKED: a non-PUBLISH verdict cannot publish even with a valid release → 422 VERDICT_NOT_PUBLISH", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece({ verdict: "REVISE" })),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => gateResult({ verdict: "REVISE" })),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("VERDICT_NOT_PUBLISH");
  });

  it("BLOCKED (fail-safe): the global publish flag OFF refuses up front → 403", async () => {
    const d = {
      data: makeData({ loadPiece: vi.fn(async () => publishablePiece()) }),
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: () => false,
    };
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(403);
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });
});

// ── A.011.7 — evalRan bound to the persisted gate_results.eval_ran ─────────────

describe("/api/publish — evalRan from gate_results (A.011.7)", () => {
  it("BLOCKED: a Stage-A veto (verdict set, eval_score null, eval_ran=false) → 422 EVAL_DID_NOT_RUN", async () => {
    const d = deps({
      // The loose heuristic would read evalRan=true here (verdict != null), wrongly
      // permitting. The persisted gate_results.eval_ran=false is the truth.
      loadPiece: vi.fn(async () => publishablePiece({ verdict: "PUBLISH", evalScore: null })),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => gateResult({ evalRan: false, stageBScore: null })),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("EVAL_DID_NOT_RUN");
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });

  it("BLOCKED: no gate_results row at all → evalRan false → 422 EVAL_DID_NOT_RUN", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => null),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("EVAL_DID_NOT_RUN");
  });
});

// ── Criterion 2 — byline server-resolved, request.author never trusted ────────

describe("/api/publish — byline is server-resolved (forged request.author ignored)", () => {
  it("a forged `author` field in the body is rejected by the strict contract (400)", async () => {
    const d = deps({ loadPiece: vi.fn(async () => publishablePiece()) });
    const res = await handleStudioPublish(
      jsonRequest(pubBody({ author: { name: "Imposter", credentials: "PhD" } })),
      d,
    );
    // The contract is .strict() — there is no request seam through which a caller
    // could inject a byline. The route never reads request.author.
    expect(res.status).toBe(400);
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });

  it("the published byline comes from the credential snapshot, not any request input (YMYL)", async () => {
    // YMYL forces the byline check; the credential snapshot {name, credentials} is
    // what unlocks publish. A body free of any author still publishes because the
    // byline is resolved SERVER-side from the credentialed release.
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece({ isYmyl: true })),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => gateResult()),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(200);
    expect(d.data.writes.transitionPieceStatus).toBe(1);
  });

  it("a YMYL release whose credential snapshot lacks credentials is blocked → 422 YMYL_NO_BYLINE", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece({ isYmyl: true })),
      getRelease: vi.fn(async () => ({
        ...credentialedRelease,
        credential: { name: "Someone", credentials: "" },
      })),
      getAuthorization: vi.fn(async () => activeAuth),
      getGateResult: vi.fn(async () => gateResult()),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("YMYL_NO_BYLINE");
  });
});

// ── Criterion 5 — a PUBLISH verdict alone does NOT publish (no autopilot) ──────

describe("/api/publish — no autopilot (PUBLISH verdict alone leaves the piece unpublished)", () => {
  it("PUBLISH verdict + evalRan but NO release → blocked, piece not advanced", async () => {
    const d = deps({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => null), // no recorded release
      getGateResult: vi.fn(async () => gateResult()),
    });
    const res = await handleStudioPublish(jsonRequest(pubBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
    expect(d.data.writes.transitionPieceStatus).toBe(0); // stays where it was
  });
});

// ── Criterion 7 / 2 — tenancy is server-bound, request tenancy never widens ───

describe("/api/publish — tenancy", () => {
  it("request workspace mismatching the bound context → 403", async () => {
    const d = deps({ loadPiece: vi.fn(async () => publishablePiece()) });
    const res = await handleStudioPublish(
      jsonRequest(pubBody({ workspaceId: WORKSPACE_B })),
      d,
    );
    expect(res.status).toBe(403);
    expect(d.data.writes.transitionPieceStatus).toBe(0);
  });

  it("cross-tenant clientId → 404 (no existence leak)", async () => {
    const d = deps();
    const res = await handleStudioPublish(jsonRequest(pubBody({ clientId: CLIENT_B })), d);
    expect(res.status).toBe(404);
  });
});
