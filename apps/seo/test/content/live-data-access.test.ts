/**
 * live-data-access.test.ts — the LIVE ContentDataAccess READ adapter (DR-026).
 *
 * Exercises `LiveContentReadAccess` against an IN-MEMORY FAKE Supabase service-
 * role client (no network, no live DB). The fake is a chainable PostgREST query
 * spy: `.from(table).select(cols).eq(col,val).eq(...).in(...).order(...).limit(n)`
 * is awaitable to `{ data, error }` and supports `.maybeSingle()`. The fake
 * RECORDS every applied filter so each test can prove the EXACT tenancy filter.
 *
 * The load-bearing proofs (DR-026 tenancy + fail-closed), per method:
 *   (a) the correct TABLE is hit, with the EXPLICIT workspace_id / client_id
 *       filter applied (service-role bypasses RLS — the app filter IS the
 *       boundary);
 *   (b) a CROSS-TENANT / foreign id resolves to null / empty (no leak);
 *   (c) PUBLISHED reads filter `status='published'` (no draft/archived leak);
 *   (d) the return shape maps correctly (incl. getAuthorization carrying
 *       granted_at + scope; getGateResult projecting off the piece row).
 *
 * Tier-2 (live pg / Supabase) is NEEDS-INPUT — no psql / live DB in this env.
 */
import { describe, it, expect } from "vitest";
import {
  LiveContentReadAccess,
  type ReaderSupabase,
} from "@/lib/content/live-data-access";

// ── fixtures (valid RFC-4122 v4 UUIDs) ──────────────────────────────
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMMENT_A = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ── In-memory fake chainable PostgREST client ───────────────────────

interface AppliedFilter {
  table: string;
  eq: Array<[string, string | number]>;
  in: Array<[string, string[]]>;
  order: Array<[string, boolean]>;
  limit: number | null;
}

/**
 * Build a fake `ReaderSupabase`. `tables` maps a table name to its rows; the fake
 * applies the recorded `.eq()` / `.in()` filters in-memory (so a wrong tenancy
 * filter produces a different — usually empty — result, exactly like the DB). The
 * `filters` array records every query so a test can assert the precise filter set.
 */
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const filters: AppliedFilter[] = [];

  function makeQuery(table: string) {
    const f: AppliedFilter = { table, eq: [], in: [], order: [], limit: null };
    filters.push(f);

    function resolveRows(): Record<string, unknown>[] {
      let rows = (tables[table] ?? []).slice();
      for (const [col, val] of f.eq) {
        rows = rows.filter((r) => r[col] === val);
      }
      for (const [col, vals] of f.in) {
        rows = rows.filter((r) => typeof r[col] === "string" && vals.includes(r[col] as string));
      }
      for (const [col, asc] of f.order) {
        rows.sort((a, b) => {
          const av = a[col] as number | string;
          const bv = b[col] as number | string;
          if (av === bv) return 0;
          const cmp = av < bv ? -1 : 1;
          return asc ? cmp : -cmp;
        });
      }
      if (f.limit !== null) rows = rows.slice(0, f.limit);
      return rows;
    }

    const builder = {
      eq(col: string, val: string | number) {
        f.eq.push([col, val]);
        return builder;
      },
      in(col: string, vals: string[]) {
        f.in.push([col, vals]);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        f.order.push([col, opts?.ascending !== false]);
        return builder;
      },
      limit(n: number) {
        f.limit = n;
        return builder;
      },
      async maybeSingle() {
        const rows = resolveRows();
        return { data: rows[0] ?? null, error: null };
      },
      // Awaitable: resolves to the row array.
      then<R>(
        onfulfilled?: (v: { data: Record<string, unknown>[]; error: null }) => R,
      ) {
        const result = { data: resolveRows(), error: null as null };
        return Promise.resolve(result).then(onfulfilled);
      },
    };
    return builder;
  }

  const supabase: ReaderSupabase = {
    from(table: string) {
      return { select: () => makeQuery(table) };
    },
  };
  return { supabase, filters };
}

/** Assert a recorded query hit `table` and applied the given eq filters (subset). */
function assertEqFilters(
  filters: AppliedFilter[],
  table: string,
  expected: Array<[string, string | number]>,
) {
  const q = filters.find((x) => x.table === table);
  expect(q, `expected a query against ${table}`).toBeDefined();
  for (const [col, val] of expected) {
    expect(q!.eq).toContainEqual([col, val]);
  }
}

// ── clientBelongsToWorkspace ────────────────────────────────────────

describe("live-data-access: clientBelongsToWorkspace (tenancy bridge)", () => {
  it("filters by BOTH id AND workspace_id; true only for the owning workspace", async () => {
    const { supabase, filters } = makeFakeSupabase({
      content_clients: [{ id: CLIENT_A, workspace_id: WS_A }],
    });
    const data = new LiveContentReadAccess(supabase);

    expect(await data.clientBelongsToWorkspace(CLIENT_A, WS_A)).toBe(true);
    assertEqFilters(filters, "content_clients", [
      ["id", CLIENT_A],
      ["workspace_id", WS_A],
    ]);
  });

  it("cross-workspace pairing resolves to false (no leak)", async () => {
    const { supabase } = makeFakeSupabase({
      content_clients: [{ id: CLIENT_A, workspace_id: WS_A }],
    });
    const data = new LiveContentReadAccess(supabase);
    // CLIENT_A under WS_B does not exist → false.
    expect(await data.clientBelongsToWorkspace(CLIENT_A, WS_B)).toBe(false);
  });
});

// ── getApprovedVoiceSpec ────────────────────────────────────────────

describe("live-data-access: getApprovedVoiceSpec (fail-closed on unapproved)", () => {
  it("returns the approved spec, scoped by client_id, with the mapped shape", async () => {
    const spec = { tone: ["warm"], authors: [] };
    const { supabase, filters } = makeFakeSupabase({
      voice_specs: [
        { id: "spec-1", client_id: CLIENT_A, spec, approved_at: "2026-01-01T00:00:00.000Z", version: 1 },
      ],
    });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.getApprovedVoiceSpec(CLIENT_A);
    expect(got).toEqual({
      id: "spec-1",
      clientId: CLIENT_A,
      spec,
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    assertEqFilters(filters, "voice_specs", [["client_id", CLIENT_A]]);
  });

  it("returns null when the spec is NOT approved (approved_at null) — fail-closed", async () => {
    const { supabase } = makeFakeSupabase({
      voice_specs: [
        { id: "spec-1", client_id: CLIENT_A, spec: {}, approved_at: null, version: 1 },
      ],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getApprovedVoiceSpec(CLIENT_A)).toBeNull();
  });

  it("foreign client resolves to null", async () => {
    const { supabase } = makeFakeSupabase({
      voice_specs: [
        { id: "spec-1", client_id: CLIENT_A, spec: {}, approved_at: "2026-01-01T00:00:00.000Z", version: 1 },
      ],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getApprovedVoiceSpec(CLIENT_B)).toBeNull();
  });
});

// ── loadPiece ───────────────────────────────────────────────────────

describe("live-data-access: loadPiece (id + client_id filter)", () => {
  const pieceRow = {
    id: PIECE_A,
    client_id: CLIENT_A,
    slug: "test-piece",
    title: "Test Piece",
    body: "Body",
    status: "draft",
    version: 2,
    is_ymyl: true,
    author_id: null,
    verdict: "REVIEW",
    eval_score: 88,
    faq_data: null,
    brief_snapshot: { keyword: "k", isYmyl: true, sources: [] },
  };

  it("loads + maps a piece scoped by (id, client_id)", async () => {
    const { supabase, filters } = makeFakeSupabase({ content_pieces: [pieceRow] });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.loadPiece(PIECE_A, CLIENT_A);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(PIECE_A);
    expect(got!.clientId).toBe(CLIENT_A);
    expect(got!.version).toBe(2);
    expect(got!.isYmyl).toBe(true);
    expect(got!.verdict).toBe("REVIEW");
    expect(got!.evalScore).toBe(88);
    assertEqFilters(filters, "content_pieces", [
      ["id", PIECE_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("cross-tenant client resolves to null (no leak)", async () => {
    const { supabase } = makeFakeSupabase({ content_pieces: [pieceRow] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.loadPiece(PIECE_A, CLIENT_B)).toBeNull();
  });

  it("an unmappable row (missing required title) resolves to null — fail-closed", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [{ ...pieceRow, title: undefined }],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.loadPiece(PIECE_A, CLIENT_A)).toBeNull();
  });
});

// ── loadLatestVersion / listPieceVersions ───────────────────────────

describe("live-data-access: version reads (piece_id + client_id filter)", () => {
  const v = (version: number) => ({
    id: `ver-${version}`,
    piece_id: PIECE_A,
    client_id: CLIENT_A,
    version,
    body: `body-${version}`,
    verdict: "REVIEW",
    snapshot_at: "2026-01-01T00:00:00.000Z",
  });

  it("loadLatestVersion returns the HIGHEST version, scoped by (piece_id, client_id)", async () => {
    const { supabase, filters } = makeFakeSupabase({
      content_piece_versions: [v(1), v(3), v(2)],
    });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.loadLatestVersion(PIECE_A, CLIENT_A);
    expect(got!.version).toBe(3);
    assertEqFilters(filters, "content_piece_versions", [
      ["piece_id", PIECE_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("listPieceVersions returns all versions for the bound client; cross-tenant → []", async () => {
    const { supabase } = makeFakeSupabase({
      content_piece_versions: [v(1), v(2)],
    });
    const data = new LiveContentReadAccess(supabase);

    expect(await data.listPieceVersions(PIECE_A, CLIENT_A)).toHaveLength(2);
    expect(await data.listPieceVersions(PIECE_A, CLIENT_B)).toHaveLength(0);
  });

  it("omits an unmappable version row (missing body) — fail-closed", async () => {
    const { supabase } = makeFakeSupabase({
      content_piece_versions: [v(1), { ...v(2), body: undefined }],
    });
    const data = new LiveContentReadAccess(supabase);
    const got = await data.listPieceVersions(PIECE_A, CLIENT_A);
    expect(got).toHaveLength(1);
    expect(got[0].version).toBe(1);
  });
});

// ── getAuthorization (A.005.1 widened projection) ───────────────────

describe("live-data-access: getAuthorization (carries granted_at + scope)", () => {
  const authRow = {
    id: AUTH_A,
    client_id: CLIENT_A,
    granted_at: "2026-01-01T00:00:00.000Z",
    revoked_at: null,
    expires_at: null,
    credential: { name: "Dr. Roe", credentials: "RN" },
    scope: "client",
    placeholder: false,
  };

  it("maps the full A.005.1 shape, scoped by (id, client_id)", async () => {
    const { supabase, filters } = makeFakeSupabase({ byline_authorizations: [authRow] });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.getAuthorization(AUTH_A, CLIENT_A);
    expect(got).toEqual({
      id: AUTH_A,
      grantedAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
      expiresAt: null,
      credential: { name: "Dr. Roe", credentials: "RN" },
      scope: "client",
      placeholder: false,
    });
    assertEqFilters(filters, "byline_authorizations", [
      ["id", AUTH_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("cross-tenant authorization id resolves to null", async () => {
    const { supabase } = makeFakeSupabase({ byline_authorizations: [authRow] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getAuthorization(AUTH_A, CLIENT_B)).toBeNull();
  });
});

// ── getRelease ──────────────────────────────────────────────────────

describe("live-data-access: getRelease (credentialed precedence, tenancy-scoped)", () => {
  it("returns a credentialed_release (scoped by client_id+piece_id+version)", async () => {
    const { supabase, filters } = makeFakeSupabase({
      credentialed_releases: [
        {
          client_id: CLIENT_A,
          piece_id: PIECE_A,
          version: 1,
          actor_id: "actor-1",
          credential: { name: "Dr. Roe", credentials: "RN" },
          authorization_id: AUTH_A,
        },
      ],
    });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.getRelease(PIECE_A, CLIENT_A, 1);
    expect(got).toEqual({
      releaseType: "credentialed_release",
      actorId: "actor-1",
      credential: { name: "Dr. Roe", credentials: "RN" },
      authorizationId: AUTH_A,
    });
    assertEqFilters(filters, "credentialed_releases", [
      ["client_id", CLIENT_A],
      ["piece_id", PIECE_A],
      ["version", 1],
    ]);
  });

  it("falls back to an advisory client_signoff when no credentialed release exists", async () => {
    const { supabase } = makeFakeSupabase({
      credentialed_releases: [],
      client_signoffs: [
        { client_id: CLIENT_A, piece_id: PIECE_A, version: 1, actor_id: "client-kate" },
      ],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getRelease(PIECE_A, CLIENT_A, 1)).toEqual({
      releaseType: "client_signoff",
      actorId: "client-kate",
    });
  });

  it("cross-tenant piece resolves to null (no release leak)", async () => {
    const { supabase } = makeFakeSupabase({
      credentialed_releases: [
        { client_id: CLIENT_A, piece_id: PIECE_A, version: 1, actor_id: "a", authorization_id: AUTH_A },
      ],
      client_signoffs: [],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getRelease(PIECE_A, CLIENT_B, 1)).toBeNull();
  });
});

// ── getGateResult (DR-039 seam projection off the piece row) ─────────

describe("live-data-access: getGateResult (projection, not a table)", () => {
  it("projects evalRan / stageBScore / verdict / sourcingBlocked off content_pieces", async () => {
    const { supabase, filters } = makeFakeSupabase({
      content_pieces: [
        {
          id: PIECE_A,
          client_id: CLIENT_A,
          verdict: "PUBLISH",
          eval_score: 90,
          dimensions: { failureCodes: [] },
        },
      ],
    });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.getGateResult(PIECE_A, CLIENT_A, 1);
    expect(got).toEqual({
      evalRan: true,
      stageBScore: 90,
      verdict: "PUBLISH",
      sourcingBlocked: false,
    });
    assertEqFilters(filters, "content_pieces", [
      ["id", PIECE_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("a Stage-A veto (eval_score null) → evalRan false, sourcingBlocked from dimensions", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [
        {
          id: PIECE_A,
          client_id: CLIENT_A,
          verdict: "REVISE",
          eval_score: null,
          dimensions: { failureCodes: ["VETO_UNSOURCED_STAT"] },
        },
      ],
    });
    const data = new LiveContentReadAccess(supabase);
    const got = await data.getGateResult(PIECE_A, CLIENT_A, 1);
    expect(got).toEqual({
      evalRan: false,
      stageBScore: null,
      verdict: "REVISE",
      sourcingBlocked: true,
    });
  });

  it("returns null when no gate has run (no score, no verdict)", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [{ id: PIECE_A, client_id: CLIENT_A, verdict: null, eval_score: null, dimensions: null }],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getGateResult(PIECE_A, CLIENT_A, 1)).toBeNull();
  });

  it("cross-tenant piece resolves to null", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [{ id: PIECE_A, client_id: CLIENT_A, verdict: "PUBLISH", eval_score: 90, dimensions: null }],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.getGateResult(PIECE_A, CLIENT_B, 1)).toBeNull();
  });
});

// ── comment threads ─────────────────────────────────────────────────

describe("live-data-access: comment thread reads (tenancy-scoped)", () => {
  const thread = {
    id: COMMENT_A,
    piece_id: PIECE_A,
    client_id: CLIENT_A,
    version: 3,
    kind: "request-changes",
    anchor: { x: 0.4, y: 0.6, elementHint: "heading:Costs" },
    body: "soften this",
    author: "client:kate",
    status: "open",
    created_at: "2026-01-04T00:00:00.000Z",
  };

  it("loadCommentThread maps + scopes by (id, client_id)", async () => {
    const { supabase, filters } = makeFakeSupabase({ comment_threads: [thread] });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.loadCommentThread(COMMENT_A, CLIENT_A);
    expect(got!.id).toBe(COMMENT_A);
    expect(got!.kind).toBe("request-changes");
    expect(got!.anchor).toEqual({ x: 0.4, y: 0.6, elementHint: "heading:Costs" });
    assertEqFilters(filters, "comment_threads", [
      ["id", COMMENT_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("cross-tenant comment id resolves to null", async () => {
    const { supabase } = makeFakeSupabase({ comment_threads: [thread] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.loadCommentThread(COMMENT_A, CLIENT_B)).toBeNull();
  });

  it("listCommentThreads scopes by (piece_id, client_id); cross-tenant → []", async () => {
    const { supabase, filters } = makeFakeSupabase({ comment_threads: [thread] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.listCommentThreads(PIECE_A, CLIENT_A)).toHaveLength(1);
    expect(await data.listCommentThreads(PIECE_A, CLIENT_B)).toHaveLength(0);
    assertEqFilters(filters, "comment_threads", [
      ["piece_id", PIECE_A],
      ["client_id", CLIENT_A],
    ]);
  });
});

// ── listApprovalEvents ──────────────────────────────────────────────

describe("live-data-access: listApprovalEvents (derived, tenancy-scoped)", () => {
  it("derives credentialed_release + client_signoff milestones for the bound client", async () => {
    const { supabase, filters } = makeFakeSupabase({
      credentialed_releases: [
        { client_id: CLIENT_A, piece_id: PIECE_A, released_at: "2026-01-02T00:00:00.000Z" },
      ],
      client_signoffs: [
        { client_id: CLIENT_A, piece_id: PIECE_A, released_at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const data = new LiveContentReadAccess(supabase);

    const events = await data.listApprovalEvents(PIECE_A, CLIENT_A);
    expect(events).toContainEqual({ pieceId: PIECE_A, kind: "credentialed_release", at: "2026-01-02T00:00:00.000Z" });
    expect(events).toContainEqual({ pieceId: PIECE_A, kind: "client_signoff", at: "2026-01-01T00:00:00.000Z" });
    assertEqFilters(filters, "credentialed_releases", [
      ["client_id", CLIENT_A],
      ["piece_id", PIECE_A],
    ]);
  });

  it("cross-tenant piece yields no events", async () => {
    const { supabase } = makeFakeSupabase({
      credentialed_releases: [
        { client_id: CLIENT_A, piece_id: PIECE_A, released_at: "2026-01-02T00:00:00.000Z" },
      ],
      client_signoffs: [],
    });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.listApprovalEvents(PIECE_A, CLIENT_B)).toHaveLength(0);
  });
});

// ── public reads (published-only) ───────────────────────────────────

describe("live-data-access: public reads filter status='published'", () => {
  const published = {
    client_id: CLIENT_A,
    slug: "pub",
    title: "Published",
    body: "B",
    excerpt: null,
    meta_description: null,
    faq_data: null,
    published_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
    cluster_role: "pillar",
    funnel_stage: "awareness",
    status: "published",
  };
  const draft = { ...published, slug: "draft-slug", status: "draft" };

  it("resolveClientByBlogSlug maps a public client by blog_slug", async () => {
    const { supabase, filters } = makeFakeSupabase({
      content_clients: [{ id: CLIENT_A, blog_slug: "acme", name: "Acme" }],
    });
    const data = new LiveContentReadAccess(supabase);
    const got = await data.resolveClientByBlogSlug("acme");
    expect(got).toEqual({ id: CLIENT_A, blogSlug: "acme", name: "Acme" });
    assertEqFilters(filters, "content_clients", [["blog_slug", "acme"]]);
  });

  it("loadPublishedPiece returns a published row + carries clusterRole/funnelStage", async () => {
    const { supabase, filters } = makeFakeSupabase({ content_pieces: [published, draft] });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.loadPublishedPiece(CLIENT_A, "pub");
    expect(got).not.toBeNull();
    expect(got!.clusterRole).toBe("pillar");
    expect(got!.funnelStage).toBe("awareness");
    assertEqFilters(filters, "content_pieces", [
      ["client_id", CLIENT_A],
      ["slug", "pub"],
      ["status", "published"],
    ]);
  });

  it("loadPublishedPiece returns null for a DRAFT slug (fail-closed public read)", async () => {
    const { supabase } = makeFakeSupabase({ content_pieces: [published, draft] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.loadPublishedPiece(CLIENT_A, "draft-slug")).toBeNull();
  });

  it("listPublishedPieces returns ONLY published rows for the bound client", async () => {
    const { supabase, filters } = makeFakeSupabase({ content_pieces: [published, draft] });
    const data = new LiveContentReadAccess(supabase);

    const got = await data.listPublishedPieces(CLIENT_A);
    expect(got).toHaveLength(1);
    expect(got[0].slug).toBe("pub");
    assertEqFilters(filters, "content_pieces", [
      ["client_id", CLIENT_A],
      ["status", "published"],
    ]);
  });

  it("listPublishedPieces for a foreign client returns []", async () => {
    const { supabase } = makeFakeSupabase({ content_pieces: [published] });
    const data = new LiveContentReadAccess(supabase);
    expect(await data.listPublishedPieces(CLIENT_B)).toHaveLength(0);
  });
});
