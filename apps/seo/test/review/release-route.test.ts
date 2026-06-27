/**
 * POST /api/review/release — the CREDENTIALED-REVIEWER release authorization
 * (audit-006 H1). Proves, with NO DB and NO env (injected seams), the seam that was
 * previously UNCALLABLE (recordCredentialedRelease had zero non-test callers):
 *
 *   (a) a credentialed reviewer's authorization PERSISTS exactly ONE
 *       `credentialed_releases` row, with tenancy + the byline credential bound
 *       SERVER-side (the credential snapshot comes from the AUTHORIZATION, never
 *       request input) and the version read from the PERSISTED piece;
 *   (b) DR-037: in production (`isPilot()` false) a release backed by the seeded
 *       PILOT PLACEHOLDER reviewer is REFUSED (`placeholder-in-production`, 422) —
 *       NO release written;
 *   (c) §11.5: a revoked authorization is REFUSED (`authorization-inactive`, 422) —
 *       NO release written;
 *   (d) DR-037 separation: the CLIENT sign-off path (recordClientSignoff) does NOT
 *       create a credentialed release — it writes only the advisory client_signoffs
 *       row and never touches credentialed_releases.
 *
 * No DB / network: the route's `ContentDataAccess` is the shared spying mock and the
 * `isPilot` flag is injected.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  handleReviewRelease,
  type ReviewReleaseDeps,
} from "@/app/api/review/release/route";
import { recordClientSignoff } from "@/lib/review/signoff";
import { PLACEHOLDER_REVIEWER_NAME } from "@/lib/review/signoff";
import type {
  PersistedAuthorization,
  ClientSignoffInsert,
} from "@/lib/content/context";
import {
  makeData,
  workspace,
  WORKSPACE_A,
  CLIENT_A,
  PIECE_A,
  AUTH_ID,
} from "../content/fixtures";

const NOW = new Date("2026-06-26T00:00:00.000Z");
const ACTOR = "reviewer:dr-jane-roe";

/** A REAL, ACTIVE authorization (granted, in-scope, not revoked/expired). */
function realAuth(over: Partial<PersistedAuthorization> = {}): PersistedAuthorization {
  const past = new Date(NOW.getTime() - 60_000).toISOString();
  return {
    id: AUTH_ID,
    grantedAt: past,
    revokedAt: null,
    expiresAt: null,
    scope: "client",
    placeholder: false,
    credential: { name: "Dr. Jane Roe", credentials: "RN, CDP" },
    ...over,
  };
}

/** The seeded PILOT PLACEHOLDER authorization (DR-037 sentinel). */
function placeholderAuth(): PersistedAuthorization {
  return realAuth({
    placeholder: true,
    credential: { name: PLACEHOLDER_REVIEWER_NAME, credentials: "RN" },
  });
}

function body(over: Record<string, unknown> = {}): unknown {
  return {
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    pieceId: PIECE_A,
    authorizationId: AUTH_ID,
    actorId: ACTOR,
    ...over,
  };
}

function req(b: unknown): Request {
  return new Request("http://localhost/api/review/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });
}

/** Deps with the shared mock + an injected authorization + pilot flag. */
function makeDeps(opts: {
  auth: PersistedAuthorization | null;
  pilot: boolean;
}): ReviewReleaseDeps {
  const data = makeData({
    getAuthorization: vi.fn(async () => opts.auth),
  });
  return {
    data,
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    isPilot: () => opts.pilot,
    now: () => NOW,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("(a) a credentialed reviewer's authorization PERSISTS the release", () => {
  it("writes exactly ONE credentialed_releases row with the byline + tenancy bound server-side", async () => {
    const deps = makeDeps({ auth: realAuth(), pilot: false });
    const res = await handleReviewRelease(req(body()), deps);

    expect(res.status).toBe(201);
    const json = (await res.json()) as { released: boolean; version: number; releaseId: string };
    expect(json.released).toBe(true);
    // version is read from the PERSISTED piece (fixture piece is version 1).
    expect(json.version).toBe(1);

    // The load-bearing proof: the credentialed-release write fired exactly once.
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(1);
    // ...and the advisory client-signoff path was NOT touched.
    expect(data.writes.insertClientSignoff).toBe(0);

    // The credential byline is snapshot from the AUTHORIZATION (never request input),
    // and tenancy is the bound context.
    const insert = (data.insertCredentialedRelease as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insert.workspaceId).toBe(WORKSPACE_A);
    expect(insert.clientId).toBe(CLIENT_A);
    expect(insert.version).toBe(1);
    expect(insert.authorizationId).toBe(AUTH_ID);
    expect(insert.credential).toEqual({ name: "Dr. Jane Roe", credentials: "RN, CDP" });
  });
});

describe("(b) DR-037 — production refuses the placeholder reviewer (no write)", () => {
  it("placeholder + isPilot()=false → 422 release-refused/placeholder-in-production, NO release", async () => {
    const deps = makeDeps({ auth: placeholderAuth(), pilot: false });
    const res = await handleReviewRelease(req(body()), deps);

    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string; reason: string };
    expect(json.code).toBe("release-refused");
    expect(json.reason).toBe("placeholder-in-production");

    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(0);
  });

  it("placeholder + isPilot()=true (pilot context) → permitted (build authority)", async () => {
    const deps = makeDeps({ auth: placeholderAuth(), pilot: true });
    const res = await handleReviewRelease(req(body()), deps);

    expect(res.status).toBe(201);
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(1);
  });
});

describe("(c) §11.5 — a revoked authorization is refused (no write)", () => {
  it("revoked authorization → 422 authorization-inactive, NO release", async () => {
    const revoked = realAuth({ revokedAt: new Date(NOW.getTime() - 1000).toISOString() });
    const deps = makeDeps({ auth: revoked, pilot: false });
    const res = await handleReviewRelease(req(body()), deps);

    expect(res.status).toBe(422);
    const json = (await res.json()) as { reason: string };
    expect(json.reason).toBe("authorization-inactive");

    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(0);
  });

  it("a dangling (missing) authorization → 422 authorization-inactive, NO release", async () => {
    const deps = makeDeps({ auth: null, pilot: false });
    const res = await handleReviewRelease(req(body()), deps);

    expect(res.status).toBe(422);
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(0);
  });
});

describe("tenancy fail-closed", () => {
  it("unauthenticated operator (no workspace) → 401, NO release", async () => {
    const deps = makeDeps({ auth: realAuth(), pilot: false });
    deps.resolveWorkspace = async () => null;
    const res = await handleReviewRelease(req(body()), deps);
    expect(res.status).toBe(401);
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(0);
  });

  it("a request tenancy that disagrees with the bound context → 403, NO release", async () => {
    const deps = makeDeps({ auth: realAuth(), pilot: false });
    // Bound workspace is WORKSPACE_A; the body claims a different workspace.
    const res = await handleReviewRelease(
      req(body({ workspaceId: "99999999-9999-4999-8999-999999999999" })),
      deps,
    );
    expect(res.status).toBe(403);
    const data = deps.data as ReturnType<typeof makeData>;
    expect(data.writes.insertCredentialedRelease).toBe(0);
  });
});

describe("(d) DR-037 separation — a CLIENT sign-off never creates a credentialed release", () => {
  it("recordClientSignoff writes ONLY the advisory client_signoffs row (no credentialed_releases)", async () => {
    const data = makeData();
    const signoff: ClientSignoffInsert = {
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      version: 1,
      actorId: "client:kate",
      releaseScope: "piece",
    };
    const result = await recordClientSignoff(signoff, data);

    expect(result.ok).toBe(true);
    // The advisory client-signoff row was written...
    expect(data.writes.insertClientSignoff).toBe(1);
    // ...and the credentialed-release table was NEVER touched (the client path can
    // structurally never satisfy a credentialed release — DR-037).
    expect(data.writes.insertCredentialedRelease).toBe(0);
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
  });
});
