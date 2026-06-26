/**
 * /api/versions/[id] — the version hub's invariants + guards (P1.U.4 / PR 013).
 * Proves, with NO DB and NO provider key (injected seams):
 *
 *   - UNDELETABLE NAMED SIGN-OFF: a named sign-off version can NEVER be deleted or
 *     overwritten. There is NO delete path on the route at all (no DELETE handler);
 *     a name/overwrite of a sign-off version is rejected (409 signoff-immutable),
 *     nothing applied. The version history stays append-only.
 *   - SWITCH:  selects the active version (a pointer/metadata update via
 *     setActiveVersion) — never destroys other versions; no version row removed.
 *   - NAME:    attaches a name (append-only metadata via nameVersion) — not a new
 *     content version, not a body mutation.
 *   - COMPARE: the list read is reads-only (no write counter moves) and the diff is
 *     a pure function (asserted in the DOM suite).
 *   - TENANCY: every read/write is scoped by the BOUND client (auth->bind->work):
 *     a request workspace mismatch -> 403, a cross-tenant client -> 404. Request
 *     tenancy is never trusted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as route from "@/app/api/versions/[id]/route";
import {
  handleVersionsList,
  handleVersionsAction,
  type VersionDeps,
} from "@/app/api/versions/[id]/route";
import {
  makeData,
  workspace,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
} from "../content/fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

function deps(over: Partial<VersionDeps> = {}): VersionDeps {
  return {
    data: makeData(),
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    ...over,
  };
}

function listRequest(query: Record<string, string>): Request {
  const url = new URL("http://localhost/api/versions/" + PIECE_A);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

const tenancy = { workspaceId: WORKSPACE_A, clientId: CLIENT_A };

function actionRequest(body: Record<string, unknown>): Request {
  // Default to the owned tenancy; a test can override workspaceId/clientId to
  // exercise the 403/404 guards.
  return new Request("http://localhost/api/versions/" + PIECE_A, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tenancy, ...body }),
  });
}

// ── The undeletable named sign-off ────────────────────────────────────────────

describe("undeletable named sign-off", () => {
  it("exposes NO delete path — the route has no DELETE handler", () => {
    // Structural proof: switch/name/compare are reads + a name write only. There is
    // no destructive delete of a version anywhere in this PR.
    expect((route as Record<string, unknown>).DELETE).toBeUndefined();
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
  });

  it("rejects re-naming / overwriting a NAMED sign-off version -> 409, nothing applied", async () => {
    // Version 2 is the existing (immutable) sign-off marker in the fixture.
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "name", version: 2, name: "tampered name" }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("signoff-immutable");
    // No metadata write was committed (the immutable guard threw before counting).
    expect((d.data as ReturnType<typeof makeData>).writes.nameVersion).toBe(0);
  });

  it("rejects marking-over a sign-off even with asSignoff -> 409", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "name", version: 2, name: "re-signoff", asSignoff: true }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("signoff-immutable");
  });
});

// ── switch / name / compare (reads + a name metadata write only) ───────────────

describe("switch — select the active version (pointer update, never destroys)", () => {
  it("op=switch updates the active pointer via setActiveVersion only", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "switch", version: 1 }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.op).toBe("switch");
    expect(out.version.version).toBe(1);
    expect(out.version.isActive).toBe(true);
    const w = (d.data as ReturnType<typeof makeData>).writes;
    // ONLY the active pointer moved — no insert, no status transition, no delete.
    expect(w.setActiveVersion).toBe(1);
    expect(w.insertPieceVersion).toBe(0);
    expect(w.transitionPieceStatus).toBe(0);
    expect(w.insertDraftPiece).toBe(0);
  });
});

describe("name — append-only metadata (not a new content version)", () => {
  it("op=name attaches a name to a non-sign-off version via nameVersion only", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "name", version: 1, name: "first draft" }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.op).toBe("name");
    expect(out.version.name).toBe("first draft");
    const w = (d.data as ReturnType<typeof makeData>).writes;
    expect(w.nameVersion).toBe(1);
    // A name is metadata — it never inserts a new content version.
    expect(w.insertPieceVersion).toBe(0);
  });

  it("op=name with asSignoff records the sign-off marker (then it is locked)", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "name", version: 1, name: "client sign-off", asSignoff: true }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version.isSignoff).toBe(true);
    // Naming it AGAIN is now rejected — the freshly-created sign-off is immutable.
    const again = await handleVersionsAction(
      actionRequest({ op: "name", version: 1, name: "changed" }),
      PIECE_A,
      d,
    );
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("signoff-immutable");
  });
});

describe("compare — list the append-only history (reads only)", () => {
  it("GET lists all versions sorted, with no write", async () => {
    const d = deps();
    const res = await handleVersionsList(listRequest(tenancy), PIECE_A, d);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    const w = (d.data as ReturnType<typeof makeData>).writes;
    expect(w.nameVersion).toBe(0);
    expect(w.setActiveVersion).toBe(0);
    expect(w.insertPieceVersion).toBe(0);
  });
});

// ── tenancy scoping (bound client, never requested) ────────────────────────────

describe("tenancy — bound, never requested; cross-tenant 403/404", () => {
  it("a request workspace mismatching the bound context -> 403 (switch)", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "switch", version: 1, workspaceId: WORKSPACE_B, clientId: CLIENT_A }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("tenancy-mismatch");
    expect((d.data as ReturnType<typeof makeData>).writes.setActiveVersion).toBe(0);
  });

  it("a cross-tenant clientId not owned by the workspace -> 404 (list)", async () => {
    const d = deps();
    const res = await handleVersionsList(
      listRequest({ workspaceId: WORKSPACE_A, clientId: CLIENT_B }),
      PIECE_A,
      d,
    );
    // CLIENT_B is not owned by WORKSPACE_A -> bind fails 404 (no existence leak).
    expect(res.status).toBe(404);
  });

  it("a cross-tenant clientId -> 404 (name); no metadata write", async () => {
    const d = deps();
    const res = await handleVersionsAction(
      actionRequest({ op: "name", version: 1, name: "x", workspaceId: WORKSPACE_A, clientId: CLIENT_B }),
      PIECE_A,
      d,
    );
    expect(res.status).toBe(404);
    expect((d.data as ReturnType<typeof makeData>).writes.nameVersion).toBe(0);
  });

  it("the list read is scoped by the BOUND clientId (passed through, never the URL's widening)", async () => {
    const d = deps();
    const spy = (d.data as ReturnType<typeof makeData>).listPieceVersions as ReturnType<typeof vi.fn>;
    await handleVersionsList(listRequest(tenancy), PIECE_A, d);
    expect(spy).toHaveBeenCalledWith(PIECE_A, CLIENT_A);
  });
});

// ── request hygiene ────────────────────────────────────────────────────────────

describe("request hygiene", () => {
  it("a malformed body -> 400", async () => {
    const d = deps();
    const res = await handleVersionsAction(actionRequest({ op: "nope" }), PIECE_A, d);
    expect(res.status).toBe(400);
  });

  it("missing tenancy on GET -> 400", async () => {
    const d = deps();
    const res = await handleVersionsList(listRequest({}), PIECE_A, d);
    expect(res.status).toBe(400);
  });
});
