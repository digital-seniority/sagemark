/**
 * /content/api/publish — the host-enforced canPublish() moat. Proves the gate is
 * enforced HOST-SIDE (never delegated): a client_signoff can NEVER release; a
 * credentialed_release with an inactive authorization is fail-closed-blocked;
 * request tenancy is rejected (403); + criterion 7.
 */

import { describe, it, expect, vi } from "vitest";
import { handlePublish } from "@/app/content/api/publish/route";
import {
  makeData,
  workspace,
  pieceRow,
  jsonRequest,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
  AUTHOR_A,
  AUTH_ID,
} from "./fixtures";
import type {
  PersistedRelease,
  PersistedAuthorization,
} from "@/lib/content/context";

const flagOn = () => true;

/** An approved, PUBLISH-verdict, non-YMYL piece ready to publish. */
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

const activeAuth: PersistedAuthorization = { id: AUTH_ID, revokedAt: null, expiresAt: null };

function pubBody(over: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    pieceId: PIECE_A,
    action: "publish",
    ...over,
  };
}

describe("publish — host-enforced canPublish (the moat)", () => {
  it("publishes when verdict=PUBLISH + eval ran + an ACTIVE credentialed release", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("published");
    expect(data.writes.transitionPieceStatus).toBe(1);
  });

  it("a client_signoff can NEVER release → 422 NO_HUMAN_RELEASE, no write", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => clientSignoff),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
    expect(data.writes.transitionPieceStatus).toBe(0);
  });

  it.each([
    ["revoked", { id: AUTH_ID, revokedAt: "2026-01-01T00:00:00Z", expiresAt: null }],
    ["expired", { id: AUTH_ID, revokedAt: null, expiresAt: "2020-01-01T00:00:00Z" }],
  ])(
    "a credentialed release with a %s authorization is fail-closed-blocked (422)",
    async (_label, auth) => {
      const data = makeData({
        loadPiece: vi.fn(async () => publishablePiece()),
        getRelease: vi.fn(async () => credentialedRelease),
        getAuthorization: vi.fn(async () => auth as PersistedAuthorization),
      });
      const res = await handlePublish(jsonRequest(pubBody()), {
        data,
        resolveWorkspace: async () => workspace(WORKSPACE_A),
        publishEnabled: flagOn,
      });
      expect(res.status).toBe(422);
      expect((await res.json()).reason).toBe("NO_HUMAN_RELEASE");
      expect(data.writes.transitionPieceStatus).toBe(0);
    },
  );

  it("a dangling authorization (missing row) is fail-closed-blocked (422)", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece()),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => null),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(422);
    expect(data.writes.transitionPieceStatus).toBe(0);
  });

  it("a non-PUBLISH verdict cannot publish even with a valid release (422)", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece({ verdict: "REVISE" })),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("NOT_PUBLISH_VERDICT");
  });

  it("the global publish flag OFF refuses publish up front (403)", async () => {
    const data = makeData({ loadPiece: vi.fn(async () => publishablePiece()) });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: () => false,
    });
    expect(res.status).toBe(403);
    expect(data.writes.transitionPieceStatus).toBe(0);
  });

  it("a YMYL piece requires a named byline — release with credentials publishes", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece({ isYmyl: true })),
      getRelease: vi.fn(async () => credentialedRelease),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(200); // byline resolved from the credential snapshot
  });

  it("a YMYL piece with a credential snapshot lacking credentials is blocked (422)", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => publishablePiece({ isYmyl: true })),
      getRelease: vi.fn(async () => ({
        ...credentialedRelease,
        credential: { name: "Someone", credentials: "" }, // no credentials
      })),
      getAuthorization: vi.fn(async () => activeAuth),
    });
    const res = await handlePublish(jsonRequest(pubBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      publishEnabled: flagOn,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("YMYL_NO_BYLINE");
  });
});

describe("publish — tenancy (criteria 2/7)", () => {
  it("request workspace mismatching the bound context → 403", async () => {
    const data = makeData({ loadPiece: vi.fn(async () => publishablePiece()) });
    const res = await handlePublish(
      jsonRequest(pubBody({ workspaceId: WORKSPACE_B })),
      { data, resolveWorkspace: async () => workspace(WORKSPACE_A), publishEnabled: flagOn },
    );
    expect(res.status).toBe(403);
    expect(data.writes.transitionPieceStatus).toBe(0);
  });

  it("cross-tenant clientId → 404", async () => {
    const data = makeData();
    const res = await handlePublish(
      jsonRequest(pubBody({ clientId: CLIENT_B })),
      { data, resolveWorkspace: async () => workspace(WORKSPACE_A), publishEnabled: flagOn },
    );
    expect(res.status).toBe(404);
  });
});

// AUTHOR_A is referenced indirectly via the fixture byline; keep the import used.
void AUTHOR_A;
