/**
 * Public content data-access composition (DR-026 activation, creds-gated).
 *
 * The PUBLIC read seam for the resource-library homepage + the blog render route.
 * The live public READ adapter (`makeLivePublicContentReadAccess`) + the live hero
 * resolver (`makeLiveResolveHeroAssets`, C.021.2) are already built; this helper
 * composes them gated:
 *
 *   - service-role creds PRESENT → the LIVE public adapter (resolveClientByBlogSlug
 *     / loadPublishedPiece / listPublishedPieces) + the live `resolveHeroAssets`.
 *   - creds ABSENT               → `NOT_WIRED_PUBLIC_DATA_ACCESS` UNCHANGED.
 *
 * NOTE — the homepage route ALREADY composes the live `resolveHeroAssets` onto
 * `NOT_WIRED_PUBLIC_DATA_ACCESS` (C.021.2/DR-035) so the hero path is gated today.
 * This helper ADDS the published-content reads (DR-026) on the SAME creds gate
 * without regressing the hero path: when creds are absent the result is exactly the
 * NOT_WIRED default + (gated-off) hero resolver — today's behavior. Only published
 * rows ever surface (the adapter filters `status='published'`; the DB anon RLS
 * policy is the authoritative second gate).
 *
 * `server-only`. Importing is network-free + cred-free.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
} from "./context";
import { makeLivePublicContentReadAccess } from "./live-data-access";
import { makeLiveResolveHeroAssets } from "./image-resolver";

/**
 * Resolve the public seam, creds-gated + safe-default. With NO creds set this
 * returns `NOT_WIRED_PUBLIC_DATA_ACCESS` with the live hero resolver attached ONLY
 * when its own creds gate passes (which, sharing the same service-role creds, is
 * off too) — i.e. exactly today's homepage behavior.
 */
export async function resolvePublicContentDataAccess(): Promise<PublicContentDataAccess> {
  const read = await makeLivePublicContentReadAccess();
  const resolveHeroAssets = await makeLiveResolveHeroAssets();

  // Creds absent → leave the published-content reads on their fail-closed default,
  // attaching the (also-gated, so absent) hero resolver — unchanged behavior.
  if (!read) {
    return resolveHeroAssets
      ? { ...NOT_WIRED_PUBLIC_DATA_ACCESS, resolveHeroAssets }
      : NOT_WIRED_PUBLIC_DATA_ACCESS;
  }

  // Creds present → live published-content reads + the live hero resolver.
  return {
    ...NOT_WIRED_PUBLIC_DATA_ACCESS,
    ...read,
    ...(resolveHeroAssets ? { resolveHeroAssets } : {}),
  };
}
