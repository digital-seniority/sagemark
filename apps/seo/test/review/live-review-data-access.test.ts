/**
 * live-review-data-access.test.ts — the LIVE review-token + review-comment adapter
 * (DR-026, lane client-review). The LAST DR-026 data-layer gap.
 *
 * Exercises `LiveReviewDataAccess` against an IN-MEMORY FAKE Supabase service-role
 * client (no network, no live DB). The fake is a chainable PostgREST spy:
 * `.from(t).select(cols).eq(c,v).is(c,null).or(filter).maybeSingle()` for reads and
 * `.from(t).insert(row).select("id").maybeSingle()` for the write. The fake applies
 * the recorded filters in-memory (so a wrong/forged token produces a different —
 * empty — result, exactly like the DB) AND records every query so each test proves
 * the EXACT filter set.
 *
 * THE LOAD-BEARING PROOFS:
 *   (a) a VALID, non-revoked, non-expired token hash → the correct tuple, with the
 *       EXACT fail-closed filter set (token_hash eq + revoked_at IS NULL + expiry
 *       or-filter) — the boundary is built right;
 *   (b) THE CROSS-TENANT BOUNDARY (non-vacuous): a token seeded for client A,
 *       resolved with a DIFFERENT / forged hash → null; a revoked token → null; an
 *       expired token → null; a short/empty hash → null without a DB hit;
 *   (c) `resolvePreviewTarget` returns ONLY the review-safe fields (slugs + SERP),
 *       scoped to the tuple, and exposes NO scorecard / credits / cost / model /
 *       raw body (AC#2 — proven by selecting only safe columns AND asserting the
 *       forbidden keys are structurally absent even when the row carries them);
 *   (d) `insertComment` persists with the RESOLVED tenancy taken verbatim + the
 *       validated anchor + status='open', and returns the new id.
 *
 * Tier-2 (live pg / Supabase) is NEEDS-INPUT — no psql / live DB in this env.
 */
import { describe, it, expect } from "vitest";

import {
  LiveReviewDataAccess,
  type ReviewSupabase,
} from "@/lib/review/live-review-data-access";
import {
  hashReviewToken,
  validatePinAnchor,
  type ReviewScope,
} from "@/lib/review/resolve-token";

// ── fixtures (valid RFC-4122 v4 UUIDs) ──────────────────────────────
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEW_COMMENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const TOKEN_A = "tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const HASH_A = hashReviewToken(TOKEN_A);
const FORGED = "tok_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
const HASH_FORGED = hashReviewToken(FORGED);

const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

const SCOPE_A: ReviewScope = {
  workspaceId: WS_A,
  clientId: CLIENT_A,
  pieceId: PIECE_A,
  version: 2,
};

// ── In-memory fake chainable PostgREST client ───────────────────────

interface AppliedFilter {
  table: string;
  op: "select" | "insert";
  cols: string | null;
  insertRow: Record<string, unknown> | null;
  eq: Array<[string, string | number]>;
  is: Array<[string, null]>;
  or: string[];
  limit: number | null;
}

/**
 * Evaluate one PostgREST `or` filter clause against a row. We support exactly the
 * two clause shapes the adapter emits: `col.is.null` and `col.gt.now()`. The
 * `now()` comparison treats the value as an ISO timestamp string vs the test clock.
 */
function matchesOrClause(row: Record<string, unknown>, clause: string, now: number): boolean {
  const [col, op, rhs] = clause.split(".");
  const val = row[col];
  if (op === "is" && rhs === "null") return val === null || val === undefined;
  if (op === "gt" && rhs === "now()") {
    if (typeof val !== "string") return false;
    const t = Date.parse(val);
    return Number.isFinite(t) && t > now;
  }
  return false;
}

/**
 * Build a fake `ReviewSupabase`. `tables` maps a table name to its rows; the fake
 * applies the recorded `.eq()` / `.is()` / `.or()` filters in-memory (so a wrong
 * tenancy/token filter produces a different — usually empty — result, exactly like
 * the DB). `now` is the test clock used to evaluate the expiry `or` filter.
 * `inserts` collects every insert payload; `insertReturns` is the row the next
 * insert's `.select().maybeSingle()` resolves to (the new id).
 */
function makeFakeSupabase(
  tables: Record<string, Record<string, unknown>[]>,
  opts: { now?: number; insertReturns?: Record<string, unknown> | null } = {},
) {
  const filters: AppliedFilter[] = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const now = opts.now ?? Date.now();
  const insertReturns =
    opts.insertReturns === undefined ? { id: NEW_COMMENT_ID } : opts.insertReturns;

  function makeReadQuery(table: string, cols: string) {
    const f: AppliedFilter = {
      table,
      op: "select",
      cols,
      insertRow: null,
      eq: [],
      is: [],
      or: [],
      limit: null,
    };
    filters.push(f);

    function resolveRows(): Record<string, unknown>[] {
      let rows = (tables[table] ?? []).slice();
      for (const [col, val] of f.eq) rows = rows.filter((r) => r[col] === val);
      for (const [col] of f.is) rows = rows.filter((r) => r[col] === null || r[col] === undefined);
      for (const clause of f.or) {
        // PostgREST `.or("a,b")` is a disjunction of comma-separated clauses.
        const parts = clause.split(",");
        rows = rows.filter((r) => parts.some((p) => matchesOrClause(r, p, now)));
      }
      if (f.limit !== null) rows = rows.slice(0, f.limit);
      return rows;
    }

    const builder = {
      eq(col: string, val: string | number) {
        f.eq.push([col, val]);
        return builder;
      },
      is(col: string, val: null) {
        f.is.push([col, val]);
        return builder;
      },
      or(filter: string) {
        f.or.push(filter);
        return builder;
      },
      limit(n: number) {
        f.limit = n;
        return builder;
      },
      async maybeSingle() {
        return { data: resolveRows()[0] ?? null, error: null as null };
      },
      then<R>(onfulfilled?: (v: { data: Record<string, unknown>[]; error: null }) => R) {
        return Promise.resolve({ data: resolveRows(), error: null as null }).then(onfulfilled);
      },
    };
    return builder;
  }

  const supabase = {
    from(table: string) {
      return {
        select(cols: string) {
          return makeReadQuery(table, cols);
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          filters.push({
            table,
            op: "insert",
            cols: null,
            insertRow: row,
            eq: [],
            is: [],
            or: [],
            limit: null,
          });
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: insertReturns, error: null as null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as ReviewSupabase;
  return { supabase, filters, inserts };
}

function tokenRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    token_hash: HASH_A,
    workspace_id: WS_A,
    client_id: CLIENT_A,
    piece_id: PIECE_A,
    version: 2,
    revoked_at: null,
    expires_at: null,
    ...over,
  };
}

// ── (a) valid token → correct tuple + exact fail-closed filter set ──

describe("LiveReviewDataAccess.resolveTokenByHash — the cross-tenant boundary", () => {
  it("resolves a valid, non-revoked, non-expired token to its EXACT tuple", async () => {
    const { supabase, filters } = makeFakeSupabase({ review_tokens: [tokenRow()] });
    const data = new LiveReviewDataAccess(supabase);

    const scope = await data.resolveTokenByHash(HASH_A);
    expect(scope).toEqual(SCOPE_A);

    // The EXACT fail-closed filter set: full-hash eq + revoked_at IS NULL + expiry.
    const q = filters.find((x) => x.table === "review_tokens");
    expect(q).toBeDefined();
    expect(q!.eq).toContainEqual(["token_hash", HASH_A]);
    expect(q!.is).toContainEqual(["revoked_at", null]);
    expect(q!.or).toContain("expires_at.is.null,expires_at.gt.now()");
    // Only the review-safe tuple columns are selected (no token_hash leak-back).
    expect(q!.cols).toBe("workspace_id, client_id, piece_id, version");
  });

  // ── (b) THE BOUNDARY, non-vacuous: forged / revoked / expired / short → null ──

  it("a DIFFERENT / forged token hash → null (no cross-token resolution)", async () => {
    // Seed ONLY token A. A forged token's hash matches NO row → null. Non-vacuous:
    // the same fake resolves HASH_A to a tuple (proven above).
    const { supabase } = makeFakeSupabase({ review_tokens: [tokenRow()] });
    const data = new LiveReviewDataAccess(supabase);

    expect(HASH_FORGED).not.toBe(HASH_A);
    expect(await data.resolveTokenByHash(HASH_FORGED)).toBeNull();
  });

  it("a token whose tuple is client A can NEVER yield client B (one row per hash)", async () => {
    // Seed A's token. The only row for HASH_A carries A's tuple; there is no path
    // by which HASH_A returns B's ids. Resolving A yields exactly A's tuple.
    const { supabase } = makeFakeSupabase({
      review_tokens: [tokenRow({ client_id: CLIENT_A, workspace_id: WS_A })],
    });
    const data = new LiveReviewDataAccess(supabase);
    const scope = await data.resolveTokenByHash(HASH_A);
    expect(scope!.clientId).toBe(CLIENT_A);
    expect(scope!.clientId).not.toBe(CLIENT_B);
    expect(scope!.workspaceId).not.toBe(WS_B);
  });

  it("a REVOKED token → null (revoked_at IS NULL filter excludes it)", async () => {
    const { supabase } = makeFakeSupabase({
      review_tokens: [tokenRow({ revoked_at: "2025-01-01T00:00:00.000Z" })],
    });
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolveTokenByHash(HASH_A)).toBeNull();
  });

  it("an EXPIRED token → null (expires_at <= now)", async () => {
    const { supabase } = makeFakeSupabase(
      { review_tokens: [tokenRow({ expires_at: PAST })] },
      { now: Date.parse("2026-06-26T00:00:00.000Z") },
    );
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolveTokenByHash(HASH_A)).toBeNull();
  });

  it("a FUTURE-expiry token still resolves (expires_at > now)", async () => {
    const { supabase } = makeFakeSupabase(
      { review_tokens: [tokenRow({ expires_at: FUTURE })] },
      { now: Date.parse("2026-06-26T00:00:00.000Z") },
    );
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolveTokenByHash(HASH_A)).toEqual(SCOPE_A);
  });

  it("an empty hash → null WITHOUT a DB hit (no oracle)", async () => {
    const { supabase, filters } = makeFakeSupabase({ review_tokens: [tokenRow()] });
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolveTokenByHash("")).toBeNull();
    expect(filters.length).toBe(0);
  });

  it("a row missing a tenancy column → null (fail-closed, never a partial tuple)", async () => {
    const { supabase } = makeFakeSupabase({
      review_tokens: [tokenRow({ workspace_id: null })],
    });
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolveTokenByHash(HASH_A)).toBeNull();
  });
});

// ── (c) resolvePreviewTarget — review-safe projection only ──

describe("LiveReviewDataAccess.resolvePreviewTarget — exposure guard (AC#2)", () => {
  function seed(extraPieceCols: Record<string, unknown> = {}) {
    return makeFakeSupabase({
      content_pieces: [
        {
          id: PIECE_A,
          client_id: CLIENT_A,
          slug: "what-is-memory-care",
          title: "What is memory care?",
          meta_description: "A plain-language guide for families.",
          // Forbidden columns deliberately present on the ROW — the adapter must
          // not select or surface them.
          eval_score: 91,
          verdict: "PUBLISH",
          dimensions: { secret: true },
          body: "# RAW MARKDOWN BODY",
          cost_usd: 1.23,
          model: "claude-opus",
          credits: 5,
          ...extraPieceCols,
        },
      ],
      content_clients: [{ id: CLIENT_A, workspace_id: WS_A, blog_slug: "willow-creek" }],
    });
  }

  it("returns ONLY the review-safe projection, scoped to the resolved tuple", async () => {
    const { supabase, filters } = seed();
    const data = new LiveReviewDataAccess(supabase);

    const target = await data.resolvePreviewTarget(SCOPE_A);
    expect(target).toEqual({
      clientBlogSlug: "willow-creek",
      pieceSlug: "what-is-memory-care",
      title: "What is memory care?",
      displayUrl: "willow-creek › blog › what-is-memory-care",
      metaDescription: "A plain-language guide for families.",
    });

    // Piece scoped by EXPLICIT (id, client_id) bound from the resolved scope.
    const pieceQ = filters.find((x) => x.table === "content_pieces");
    expect(pieceQ!.eq).toContainEqual(["id", PIECE_A]);
    expect(pieceQ!.eq).toContainEqual(["client_id", CLIENT_A]);
    // Client scoped by EXPLICIT (id, workspace_id) tenancy bridge bound from scope.
    const clientQ = filters.find((x) => x.table === "content_clients");
    expect(clientQ!.eq).toContainEqual(["id", CLIENT_A]);
    expect(clientQ!.eq).toContainEqual(["workspace_id", WS_A]);

    // The piece SELECT lists ONLY review-safe columns — no scorecard/cost/model/body.
    expect(pieceQ!.cols).toBe("id, slug, title, meta_description");
    for (const forbidden of [
      "eval_score",
      "verdict",
      "dimensions",
      "body",
      "cost",
      "model",
      "credit",
    ]) {
      expect(pieceQ!.cols!.includes(forbidden)).toBe(false);
    }
  });

  it("the returned target carries NO scorecard/credits/cost/model/markdown key", async () => {
    const { supabase } = seed();
    const data = new LiveReviewDataAccess(supabase);
    const target = await data.resolvePreviewTarget(SCOPE_A);
    const keys = Object.keys(target!);
    expect(keys.sort()).toEqual(
      ["clientBlogSlug", "displayUrl", "metaDescription", "pieceSlug", "title"].sort(),
    );
    for (const forbidden of [
      "evalScore",
      "eval_score",
      "verdict",
      "dimensions",
      "scorecard",
      "credits",
      "cost",
      "costUsd",
      "model",
      "body",
      "markdown",
    ]) {
      expect(forbidden in (target as Record<string, unknown>)).toBe(false);
    }
  });

  it("a cross-tenant piece id (different client) → null (no leak)", async () => {
    const { supabase } = seed();
    const data = new LiveReviewDataAccess(supabase);
    // Same piece id, but the scope claims client B — the (id, client_id) filter
    // resolves to no row. Non-vacuous: SCOPE_A resolves (proven above).
    const crossScope: ReviewScope = { ...SCOPE_A, clientId: CLIENT_B };
    expect(await data.resolvePreviewTarget(crossScope)).toBeNull();
  });

  it("a piece that no longer resolves → null (page 404s)", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [],
      content_clients: [{ id: CLIENT_A, workspace_id: WS_A, blog_slug: "willow-creek" }],
    });
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolvePreviewTarget(SCOPE_A)).toBeNull();
  });

  it("a client whose blog slug does not resolve → null", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [
        { id: PIECE_A, client_id: CLIENT_A, slug: "s", title: "T", meta_description: null },
      ],
      content_clients: [],
    });
    const data = new LiveReviewDataAccess(supabase);
    expect(await data.resolvePreviewTarget(SCOPE_A)).toBeNull();
  });

  it("null meta_description passes through as null (review-safe)", async () => {
    const { supabase } = makeFakeSupabase({
      content_pieces: [
        { id: PIECE_A, client_id: CLIENT_A, slug: "s", title: "T", meta_description: null },
      ],
      content_clients: [{ id: CLIENT_A, workspace_id: WS_A, blog_slug: "wc" }],
    });
    const data = new LiveReviewDataAccess(supabase);
    const target = await data.resolvePreviewTarget(SCOPE_A);
    expect(target!.metaDescription).toBeNull();
  });
});

// ── (d) insertComment — resolved tenancy verbatim + validated anchor ──

describe("LiveReviewDataAccess.insertComment — the comment write", () => {
  it("persists with the RESOLVED tenancy verbatim + validated anchor + status open", async () => {
    const { supabase, inserts } = makeFakeSupabase({}, { insertReturns: { id: NEW_COMMENT_ID } });
    const data = new LiveReviewDataAccess(supabase);

    const anchor = validatePinAnchor({ x: 0.5, y: 0.25, elementHint: "h2#intro" });
    expect(anchor).not.toBeNull();

    const result = await data.insertComment({
      workspaceId: WS_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      version: 2,
      kind: "pin",
      anchor,
      body: "Please tighten this section.",
      author: "client-contact-1",
    });
    expect(result).toEqual({ id: NEW_COMMENT_ID });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("comment_threads");
    expect(inserts[0].row).toEqual({
      workspace_id: WS_A,
      client_id: CLIENT_A,
      piece_id: PIECE_A,
      version: 2,
      kind: "pin",
      anchor: { x: 0.5, y: 0.25, elementHint: "h2#intro" },
      body: "Please tighten this section.",
      author: "client-contact-1",
      status: "open",
    });
  });

  it("a section verb persists a null anchor", async () => {
    const { supabase, inserts } = makeFakeSupabase({});
    const data = new LiveReviewDataAccess(supabase);
    await data.insertComment({
      workspaceId: WS_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      version: 1,
      kind: "section-approve",
      anchor: null,
      body: "",
      author: "client-contact-1",
    });
    expect(inserts[0].row.anchor).toBeNull();
    expect(inserts[0].row.status).toBe("open");
  });

  it("a write that returns no id throws (fail-closed, never fabricates)", async () => {
    const { supabase } = makeFakeSupabase({}, { insertReturns: null });
    const data = new LiveReviewDataAccess(supabase);
    await expect(
      data.insertComment({
        workspaceId: WS_A,
        clientId: CLIENT_A,
        pieceId: PIECE_A,
        version: 1,
        kind: "pin",
        anchor: { x: 0.1, y: 0.1 },
        body: "x",
        author: "a",
      }),
    ).rejects.toThrow(/no id/);
  });
});
