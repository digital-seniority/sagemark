/**
 * Host-side LIVE review-token + review-comment adapter (DR-026, lane client-review).
 *
 * THE GAP THIS CLOSES. The tokenized `/review/[token]` surface talks to the DB
 * ONLY through the `ReviewTokenDataAccess` (read) + `ReviewCommentDataAccess`
 * (write) seams (resolve-token.ts). In production those seams run on the fail-
 * closed `NOT_WIRED_REVIEW_*` stubs (every method throws). This module is the
 * live, service-role-backed impl of all three seam methods — the LAST DR-026
 * data-layer gap. It is the live counterpart to `content/live-data-access.ts` for
 * the review lane.
 *
 * THE TOKEN BOUNDARY IS THE #1 CROSS-TENANT LEAK SURFACE (load-bearing). A review
 * token is an OPAQUE string handed to a client. `resolveTokenByHash` is the gate:
 * it looks up the SHA-256 hash of the token in `review_tokens` and returns EXACTLY
 * ONE `(workspace_id, client_id, piece_id, version)` tuple, or null. The denial is
 * at the DATA layer and FAIL-CLOSED:
 *
 *   - no row for the hash  → null (unknown / forged token);
 *   - `revoked_at` is set  → null (revoked token);
 *   - `expires_at` <= now  → null (expired token);
 *
 * filtered IN THE QUERY so a revoked/expired/forged token resolves to NOTHING. The
 * compare is the FULL hash against the `review_tokens_token_hash_unique` index —
 * one row per hash by construction — so a token for client A can NEVER resolve
 * client B's tuple. The hash is never widened to a partial/prefix match.
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS (load-bearing). The client is the Supabase
 * SERVICE ROLE (host-side, `server-only`), so RLS is NOT the tenancy boundary
 * here. `resolvePreviewTarget` carries EXPLICIT (client_id, id) + version filters
 * BOUND from the RESOLVED token scope — never request input. `insertComment`
 * writes the tenancy columns (workspace_id / client_id / piece_id / version)
 * VERBATIM from the insert payload, which the route already copied from the
 * resolved token tuple — never request input.
 *
 * EXPOSURE — REVIEW-SAFE PROJECTION BY CONSTRUCTION (AC#2). `resolvePreviewTarget`
 * SELECTs and returns ONLY the public review-safe fields the page renders (the
 * piece slug + client blog slug + SERP title/displayUrl/metaDescription). It NEVER
 * selects or returns the gate scorecard, credits, cost, model, or raw markdown —
 * the `ReviewPreviewTarget` shape has nowhere to put them and the SELECT lists
 * exactly the safe columns.
 *
 * FAIL-CLOSED (never fail-open). A token row missing/unparseable in any tenancy
 * column → null (no tuple). A preview target whose piece/client cannot be mapped →
 * null (the page 404s). An insert that does not return its new id throws (never
 * fabricates an id).
 *
 * WIRED INTO ROUTES (creds-gated; INERT until SUPABASE_* set):
 * `makeLiveReviewTokenAccess()` + `makeLiveReviewCommentAccess()` are built +
 * injectable and now composed behind `resolveReviewAccess()` (PR #74), which the
 * `/review/[token]` route and the comments route resolve. They return null when
 * the host service-role creds are absent, so the seams stay on their
 * `NOT_WIRED_REVIEW_*` defaults (unchanged behavior until creds are present).
 *
 * Clean ASCII / UTF-8. No `console.*`. `@supabase/supabase-js` is imported
 * dynamically so importing this module is network-free + cred-free.
 */

import "server-only";

import {
  hashReviewToken,
  type PinAnchor,
  type ReviewCommentDataAccess,
  type ReviewCommentInsert,
  type ReviewPreviewTarget,
  type ReviewScope,
  type ReviewTokenDataAccess,
} from "./resolve-token";

// ── Service-role creds (shared contract with the content read adapter) ─────────

/**
 * The host service-role creds the live review adapter needs. Same env contract as
 * `content/live-data-access.readReadAdapterCreds`. Returns null when either is
 * absent, so the factory leaves the seam on its fail-closed `NOT_WIRED_REVIEW_*`
 * default.
 */
export function readReviewAdapterCreds(): { url: string; serviceRoleKey: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

// ── The minimal service-role PostgREST surface this adapter uses ───────────────

interface ReviewResult<T> {
  data: T;
  error: unknown;
}

/**
 * A terminal PostgREST READ builder: awaitable to `{ data, error }` and supporting
 * the chained modifiers this adapter uses. Modelled minimally (only the methods
 * used) so the fake client in the test can implement the same shape. The chained
 * comparison modifiers (`eq`/`gt`/`is`/`or`) record the fail-closed token filter.
 */
interface ReviewReadQuery
  extends PromiseLike<ReviewResult<Record<string, unknown>[]>> {
  eq(col: string, val: string | number): ReviewReadQuery;
  /** `col IS value` — used for `revoked_at IS NULL` (fail-closed on revocation). */
  is(col: string, val: null): ReviewReadQuery;
  /** A raw PostgREST `or` filter — used for `expires_at IS NULL OR > now`. */
  or(filter: string): ReviewReadQuery;
  limit(n: number): ReviewReadQuery;
  maybeSingle(): Promise<ReviewResult<Record<string, unknown> | null>>;
}

/**
 * A terminal PostgREST INSERT builder: `.insert(row).select(cols).maybeSingle()`
 * resolves to the inserted row (the new id). Modelled minimally.
 */
interface ReviewInsertReturning {
  select(cols: string): {
    maybeSingle(): Promise<ReviewResult<Record<string, unknown> | null>>;
  };
}

/** The minimal service-role Supabase surface this adapter uses. */
export interface ReviewSupabase {
  from(table: string): {
    select(cols: string): ReviewReadQuery;
    insert(row: Record<string, unknown>): ReviewInsertReturning;
  };
}

// ── Small fail-closed coercion helpers (never fabricate) ──────────────────────

/** A REQUIRED string column — null when absent/empty/wrong-typed. */
function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asIntOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.trunc(v);
}

function stringifyErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Build the SERP breadcrumb `displayUrl` from the resolved slugs. The review page
 * builds the same-origin iframe src as `/clients/{clientBlogSlug}/blog/{pieceSlug}`
 * (see `app/review/[token]/page.tsx`); the breadcrumb mirrors that public path as
 * `{clientBlogSlug} › blog › {pieceSlug}`. Derived purely from review-safe slugs —
 * carries nothing sensitive.
 */
function buildDisplayUrl(clientBlogSlug: string, pieceSlug: string): string {
  return `${clientBlogSlug} › blog › ${pieceSlug}`;
}

// ── The live review adapter ────────────────────────────────────────────────────

/**
 * Live, service-role-backed impl of `ReviewTokenDataAccess` +
 * `ReviewCommentDataAccess`. Every read carries an EXPLICIT tenancy / fail-closed
 * filter; the write binds tenancy from the resolved scope the route copied onto
 * the insert payload.
 */
export class LiveReviewDataAccess {
  constructor(private readonly supabase: ReviewSupabase) {}

  // ── ReviewTokenDataAccess: the cross-tenant boundary ────────────────────────

  /**
   * THE TOKEN BOUNDARY. Resolve a NON-revoked, NON-expired `review_tokens` row by
   * the FULL SHA-256 token hash, returning its
   * `(workspace_id, client_id, piece_id, version)` tuple, or null.
   *
   * The fail-closed filter is applied IN THE QUERY:
   *
   *   SELECT workspace_id, client_id, piece_id, version
   *   FROM review_tokens
   *   WHERE token_hash = $hash            -- exact, full-hash match (unique index)
   *     AND revoked_at IS NULL            -- revoked token → no row
   *     AND (expires_at IS NULL OR expires_at > now())  -- expired token → no row
   *
   * so a forged/unknown hash (no row), a revoked token, or an expired token ALL
   * resolve to NOTHING. The `review_tokens_token_hash_unique` index guarantees one
   * row per hash, so a token for client A can never resolve client B's tuple. The
   * hash is compared whole (`.eq`) — never a prefix/partial widening. A row missing
   * any required tenancy column → null (fail-closed, never a partial tuple).
   */
  async resolveTokenByHash(tokenHash: string): Promise<ReviewScope | null> {
    // Defense-in-depth: an empty/non-string hash never hits the DB (no oracle).
    if (typeof tokenHash !== "string" || tokenHash.length === 0) return null;

    const { data, error } = await this.supabase
      .from("review_tokens")
      .select("workspace_id, client_id, piece_id, version")
      .eq("token_hash", tokenHash)
      // Fail-closed on revocation: a revoked token has a non-null revoked_at.
      .is("revoked_at", null)
      // Fail-closed on expiry: null = never expires; otherwise must be future.
      .or("expires_at.is.null,expires_at.gt.now()")
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-review-data-access: resolveTokenByHash failed: ${stringifyErr(error)}`,
      );
    }
    if (!data) return null;

    const workspaceId = reqString(data.workspace_id);
    const clientId = reqString(data.client_id);
    const pieceId = reqString(data.piece_id);
    const version = asIntOrNull(data.version);
    // Fail-closed: a row that cannot supply a full tuple is NOT a partial grant.
    if (!workspaceId || !clientId || !pieceId || version === null) return null;
    return { workspaceId, clientId, pieceId, version };
  }

  /**
   * Resolve the REVIEW-SAFE display projection for a RESOLVED token scope, or null.
   *
   * SELECTs ONLY the review-safe columns:
   *   - `content_pieces`  (id, slug, title, meta_description), scoped by the
   *     EXPLICIT (id = pieceId, client_id = clientId) filter bound from the scope;
   *   - `content_clients` (blog_slug), scoped by the EXPLICIT (id = clientId,
   *     workspace_id = workspaceId) tenancy bridge bound from the scope.
   *
   * It NEVER selects the scorecard / credits / cost / model / raw body — the
   * `ReviewPreviewTarget` shape carries none of them (AC#2 structural exposure
   * guard). The `version` is part of the resolved scope but `content_pieces` is the
   * single current row; the piece is still bound by (id, client_id). Returns null
   * when the piece or the client blog slug does not resolve (the page 404s).
   */
  async resolvePreviewTarget(scope: ReviewScope): Promise<ReviewPreviewTarget | null> {
    const piece = await this.supabase
      .from("content_pieces")
      .select("id, slug, title, meta_description")
      .eq("id", scope.pieceId)
      .eq("client_id", scope.clientId)
      .maybeSingle();
    if (piece.error) {
      throw new Error(
        `live-review-data-access: resolvePreviewTarget(piece) failed: ${stringifyErr(piece.error)}`,
      );
    }
    if (!piece.data) return null;
    const pieceSlug = reqString(piece.data.slug);
    const title = reqString(piece.data.title);
    // Fail-closed: a piece missing its public slug/title cannot render a preview.
    if (!pieceSlug || !title) return null;
    const metaDescription = asStringOrNull(piece.data.meta_description);

    const client = await this.supabase
      .from("content_clients")
      .select("blog_slug")
      .eq("id", scope.clientId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (client.error) {
      throw new Error(
        `live-review-data-access: resolvePreviewTarget(client) failed: ${stringifyErr(client.error)}`,
      );
    }
    if (!client.data) return null;
    const clientBlogSlug = reqString(client.data.blog_slug);
    // Fail-closed: no public blog slug → the iframe target cannot be built.
    if (!clientBlogSlug) return null;

    return {
      clientBlogSlug,
      pieceSlug,
      title,
      displayUrl: buildDisplayUrl(clientBlogSlug, pieceSlug),
      metaDescription,
    };
  }

  // ── ReviewCommentDataAccess: the comment write ──────────────────────────────

  /**
   * Persist one `comment_threads` row, returning its new id. The tenancy columns
   * (workspace_id / client_id / piece_id / version) are taken VERBATIM from the
   * insert payload — the route already copied them from the RESOLVED token tuple,
   * never request input. `kind` is the verb; `anchor` is the validated pin anchor
   * (jsonb, null for a section verb); `body`/`author` are the comment fields;
   * `status` is forced to `'open'` (a new thread is always open). Fail-closed: an
   * insert that does not return its new id throws (never fabricates an id).
   */
  async insertComment(insert: ReviewCommentInsert): Promise<{ id: string }> {
    const row: Record<string, unknown> = {
      workspace_id: insert.workspaceId,
      client_id: insert.clientId,
      piece_id: insert.pieceId,
      version: insert.version,
      kind: insert.kind,
      anchor: anchorToJson(insert.anchor),
      body: insert.body,
      author: insert.author,
      status: "open",
    };
    const { data, error } = await this.supabase
      .from("comment_threads")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-review-data-access: insertComment failed: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    // Fail-closed: a write that returned no id cannot be honored — never fabricate.
    if (!id) {
      throw new Error(
        "live-review-data-access: insertComment returned no id (write not honored)",
      );
    }
    return { id };
  }
}

/**
 * Serialize a validated `PinAnchor` to the `comment_threads.anchor` jsonb, or null
 * for a non-anchored section verb. Carries ONLY the validated/normalized fields.
 */
function anchorToJson(anchor: PinAnchor | null): Record<string, unknown> | null {
  if (!anchor) return null;
  const out: Record<string, unknown> = { x: anchor.x, y: anchor.y };
  if (anchor.elementHint !== undefined) out.elementHint = anchor.elementHint;
  return out;
}

// ── Inert factories (built + injectable; NOT wired into any route) ─────────────

/**
 * Build a `LiveReviewDataAccess` from a service-role Supabase client — but ONLY if
 * the host creds are present. Returns null otherwise, so the caller leaves the
 * seams on their fail-closed `NOT_WIRED_REVIEW_*` defaults (unchanged behavior).
 *
 * `@supabase/supabase-js` is imported dynamically so importing this module is
 * network-free and needs no creds just to import. Mirrors
 * `content/live-data-access.makeLiveContentReadAdapter` exactly.
 *
 * INERT: this is NOT called by any route in this PR.
 */
export async function makeLiveReviewDataAccess(): Promise<LiveReviewDataAccess | null> {
  const creds = readReviewAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ReviewSupabase;
  return new LiveReviewDataAccess(supabase);
}

/**
 * Build the live `ReviewTokenDataAccess`, or null when the host is not configured
 * (→ leave the seam on `NOT_WIRED_REVIEW_TOKEN_ACCESS`).
 *
 * INERT: not wired into the `/review/[token]` route in this PR (factory only).
 */
export async function makeLiveReviewTokenAccess(): Promise<ReviewTokenDataAccess | null> {
  const adapter = await makeLiveReviewDataAccess();
  if (!adapter) return null;
  return {
    resolveTokenByHash: (tokenHash) => adapter.resolveTokenByHash(tokenHash),
    resolvePreviewTarget: (scope) => adapter.resolvePreviewTarget(scope),
  };
}

/**
 * Build the live `ReviewCommentDataAccess`, or null when the host is not
 * configured (→ leave the seam on `NOT_WIRED_REVIEW_COMMENT_ACCESS`).
 *
 * INERT: not wired into the comments route in this PR (factory only).
 */
export async function makeLiveReviewCommentAccess(): Promise<ReviewCommentDataAccess | null> {
  const adapter = await makeLiveReviewDataAccess();
  if (!adapter) return null;
  return {
    insertComment: (insert) => adapter.insertComment(insert),
  };
}

/** Re-export so a wiring PR can hash a token at the adapter boundary if needed. */
export { hashReviewToken };
