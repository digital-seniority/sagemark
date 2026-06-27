/**
 * Review-surface data-access composition (DR-026 activation, creds-gated).
 *
 * The tokenized `/review/[token]` page + the `/api/review/comments` route talk to
 * the DB ONLY through the `ReviewTokenDataAccess` (read) + `ReviewCommentDataAccess`
 * (write) seams. The live adapters (`makeLiveReviewTokenAccess` /
 * `makeLiveReviewCommentAccess`) are already built + INERT; this helper resolves
 * either the live impl (creds present) or the existing fail-closed
 * `NOT_WIRED_REVIEW_*` default (unchanged behavior).
 *
 * SAFE DEFAULT: with NO env set both factories return null → the NOT_WIRED default
 * → an unknown/expired/revoked token (and every token) fails closed exactly as
 * today. The token boundary (the #1 cross-tenant leak surface) is unchanged: the
 * live adapter resolves EXACTLY ONE (workspaceId, clientId, pieceId, version) tuple
 * by the full SHA-256 hash, fail-closed on revoked/expired.
 *
 * `server-only`. Importing is network-free + cred-free.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import {
  NOT_WIRED_REVIEW_TOKEN_ACCESS,
  NOT_WIRED_REVIEW_COMMENT_ACCESS,
  type ReviewTokenDataAccess,
  type ReviewCommentDataAccess,
} from "./resolve-token";
import {
  makeLiveReviewTokenAccess,
  makeLiveReviewCommentAccess,
} from "./live-review-data-access";

/**
 * Resolve the review TOKEN seam (the `/review/[token]` page), creds-gated +
 * safe-default. Live `ReviewTokenDataAccess` when creds are present, else the
 * fail-closed `NOT_WIRED_REVIEW_TOKEN_ACCESS` (unchanged — every token 404s).
 */
export async function resolveReviewTokenAccess(): Promise<ReviewTokenDataAccess> {
  const live = await makeLiveReviewTokenAccess();
  return live ?? NOT_WIRED_REVIEW_TOKEN_ACCESS;
}

/**
 * Resolve the review COMMENT seam (the `/api/review/comments` route), creds-gated +
 * safe-default. Live `ReviewCommentDataAccess` when creds are present, else the
 * fail-closed `NOT_WIRED_REVIEW_COMMENT_ACCESS`.
 */
export async function resolveReviewCommentAccess(): Promise<ReviewCommentDataAccess> {
  const live = await makeLiveReviewCommentAccess();
  return live ?? NOT_WIRED_REVIEW_COMMENT_ACCESS;
}
