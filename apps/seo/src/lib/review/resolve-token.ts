/**
 * Tokenized client-review resolution + the review-comment write seam (PR 018 /
 * P1.C.1, lane client-review).
 *
 * THE FAIL-CLOSED ROW-SCOPED BOUNDARY. A review token is an OPAQUE string handed
 * to a client. It resolves — through a DB lookup, NEVER a render-time flag — to
 * EXACTLY ONE `(workspaceId, clientId, pieceId, version)` tuple. The denial is at
 * the DATA layer: a token for client A can never read client B's piece or a
 * different version, because the lookup is by the SHA-256 hash of the token and
 * the `review_tokens.token_hash` unique index maps one hash to one tuple. A
 * request for any other client/version under the same token returns zero rows →
 * the page 404s. This is the agency-ending-leak boundary (both directions).
 *
 * THE TOKEN IS NEVER STORED. We store only `sha256(token)`; resolution hashes the
 * incoming token and looks the hash up. A DB leak does not hand out a working
 * review link.
 *
 * MOCKABLE DATA ACCESS (DR-006). sagemark has no live Supabase wired; the seam is
 * injected with a fixture in tests and a fail-closed `NOT_WIRED` stub in
 * production (throws loudly rather than fabricating/leaking a tuple). The
 * resolution + anchor-validation LOGIC here is pure and fully unit-testable
 * without a DB.
 *
 * SECURITY: the resolved tuple is the ONLY scope the /review surface trusts —
 * the page renders the hub it points at and the comments route writes rows
 * scoped by its `workspaceId`/`clientId`. No field from the URL or the iframe is
 * ever used to widen tenancy.
 *
 * No `server-only` marker (imported by plain-Node tests).
 */

import { createHash } from "node:crypto";

import type { CommentThreadKind } from "@sagemark/schema-flywheel";

// ── The resolved review scope ─────────────────────────────────────────────────

/**
 * The EXACT and ONLY tuple a review token grants read of. Every downstream
 * read/write on the /review surface is scoped by this — never by URL/iframe
 * input. `version` is the single version the token is pinned to.
 */
export interface ReviewScope {
  workspaceId: string;
  clientId: string;
  pieceId: string;
  version: number;
}

/** The discriminated result of resolving a token. `not-found` covers EVERY
 * failure (unknown/expired/revoked token, or a hash with no row) — we never
 * distinguish them to the client (no existence/expiry oracle). */
export type ResolveResult =
  | { ok: true; scope: ReviewScope }
  | { ok: false; reason: "not-found" };

// ── The fail-closed token data-access seam ────────────────────────────────────

/**
 * The minimal read seam token resolution needs. The impl looks up a NON-revoked,
 * NON-expired `review_tokens` row by its `token_hash` and returns its tuple, or
 * null. The impl MUST apply the revoked/expired filter itself (it has the clock /
 * row) and MUST scope by the hash only — it never takes a client/version from the
 * caller (those COME FROM the row). Production swaps a service-role Drizzle impl;
 * tests inject a fixture.
 */
export interface ReviewTokenDataAccess {
  /** Resolve a non-revoked/non-expired token row by its SHA-256 hash, or null. */
  resolveTokenByHash(tokenHash: string): Promise<ReviewScope | null>;
  /**
   * Resolve the REVIEW-SAFE display fields for a tuple — the public client blog
   * slug + the piece slug (to build the same-origin iframe src for the existing
   * SSR hub render route) + the title/meta for the SERP preview. Scoped by the
   * resolved tuple. Returns null if the tuple no longer resolves (the piece was
   * deleted between token issue and review). The projection is review-safe BY
   * CONSTRUCTION: it carries NO scorecard/credits/cost/model/markdown (AC#2).
   */
  resolvePreviewTarget(scope: ReviewScope): Promise<ReviewPreviewTarget | null>;
}

/**
 * The review-safe display projection for the surface. ONLY the public fields the
 * /review page needs: the iframe target (client blog slug + piece slug) + the
 * SERP fields (title, displayUrl, metaDescription). No internal/gate field is
 * present — the page can render NOTHING sensitive because nothing sensitive is on
 * this shape (the structural exposure guard, AC#2).
 */
export interface ReviewPreviewTarget {
  /** Public client blog slug (the `[client]` segment of the SSR render route). */
  clientBlogSlug: string;
  /** Piece slug (the `[slug]` segment of the SSR render route). */
  pieceSlug: string;
  /** Piece title (SERP link text). */
  title: string;
  /** Displayed URL breadcrumb for the SERP preview. */
  displayUrl: string;
  /** Meta description (SERP snippet); may be null. */
  metaDescription: string | null;
}

/** Hash an opaque review token to its lookup key (SHA-256 hex). Pure. */
export function hashReviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Resolve an opaque review token to its one scope tuple, fail-closed.
 *
 *   - An empty/malformed token → `not-found` WITHOUT touching the DB (no oracle).
 *   - A token whose hash has no live row → `not-found` (unknown/expired/revoked).
 *   - Otherwise → the EXACT tuple from the row.
 *
 * The caller (the page) turns `not-found` into a 404. There is no path by which a
 * token resolves to a tuple it was not issued for.
 */
export async function resolveReviewToken(
  token: string,
  data: ReviewTokenDataAccess,
): Promise<ResolveResult> {
  if (typeof token !== "string") return { ok: false, reason: "not-found" };
  const trimmed = token.trim();
  // Opaque tokens are non-trivial; reject anything implausibly short before a DB
  // hit (defense-in-depth; the hash lookup would miss anyway).
  if (trimmed.length < 16) return { ok: false, reason: "not-found" };

  const scope = await data.resolveTokenByHash(hashReviewToken(trimmed));
  if (!scope) return { ok: false, reason: "not-found" };
  return { ok: true, scope };
}

// ── Pin-anchor validation (normalized 0..1 + elementHint) ─────────────────────

/**
 * A validated, normalized pin anchor persisted on a `comment_threads.anchor`
 * jsonb. `x`/`y` are finite + clamped to [0,1]; `elementHint` is the best-effort
 * selector/data-key of the clicked element. Section verbs that are not
 * element-anchored carry a null anchor.
 */
export interface PinAnchor {
  x: number;
  y: number;
  elementHint?: string;
}

/**
 * Validate + normalize a candidate pin anchor (from the iframe pin-drop message
 * or the comments-route body). Returns the normalized anchor, or null when the
 * coords are not finite numbers — the route rejects a null anchor for a `pin`
 * kind (a pin MUST be element-anchored), so junk coords never persist. Pure.
 */
export function validatePinAnchor(raw: unknown): PinAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const x = finiteNumber(r.x);
  const y = finiteNumber(r.y);
  if (x === null || y === null) return null;
  const elementHint =
    typeof r.elementHint === "string" && r.elementHint.length > 0
      ? r.elementHint.slice(0, 512)
      : undefined;
  return { x: clamp01(x), y: clamp01(y), elementHint };
}

// ── The fail-closed comment write seam ────────────────────────────────────────

/**
 * The payload for persisting a review comment. Tenancy (`workspaceId`,
 * `clientId`, `pieceId`, `version`) is the RESOLVED scope — NEVER request input;
 * the route copies it from `resolveReviewToken`'s tuple. `kind` is the verb;
 * `anchor` is the validated pin anchor (required for `pin`, null for a section
 * verb). `author` is the client contact id.
 */
export interface ReviewCommentInsert {
  workspaceId: string;
  clientId: string;
  pieceId: string;
  version: number;
  kind: CommentThreadKind;
  anchor: PinAnchor | null;
  body: string;
  author: string;
}

/** The write seam: persist one `comment_threads` row, return its new id. */
export interface ReviewCommentDataAccess {
  insertComment(insert: ReviewCommentInsert): Promise<{ id: string }>;
}

/**
 * Thrown by the production stubs when no live backend is wired (DR-006). Fails
 * LOUDLY rather than silently dropping/fabricating a review row.
 */
export class ReviewDataNotWiredError extends Error {
  readonly code = "REVIEW_DATA_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `review data access is not wired: '${op}' has no live Supabase backend in this build (DR-006). ` +
        `Inject a data-access seam, or wire the service-role Drizzle impl scoped to review_tokens/comment_threads.`,
    );
    this.name = "ReviewDataNotWiredError";
  }
}

/** Fail-closed production default for token resolution. Throws until wired. */
export const NOT_WIRED_REVIEW_TOKEN_ACCESS: ReviewTokenDataAccess = {
  resolveTokenByHash: () => {
    throw new ReviewDataNotWiredError("resolveTokenByHash");
  },
  resolvePreviewTarget: () => {
    throw new ReviewDataNotWiredError("resolvePreviewTarget");
  },
};

/** Fail-closed production default for the comment write. Throws until wired. */
export const NOT_WIRED_REVIEW_COMMENT_ACCESS: ReviewCommentDataAccess = {
  insertComment: () => {
    throw new ReviewDataNotWiredError("insertComment");
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function finiteNumber(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
