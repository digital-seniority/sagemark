/**
 * resolve-author — server-side byline resolution for the publish gate.
 *
 * THE BYLINE-TRUST BOUNDARY (closes the inherited origin/preview YMYL byline-trust
 * bug). The byline an E-E-A-T / YMYL piece carries is resolved HERE from PERSISTED
 * state only — NEVER from request input. `request.author` is structurally absent
 * from this resolver: there is no parameter through which a caller could inject a
 * byline.
 *
 * RESOLUTION ORDER (server-side):
 *   1. The author id is the PERSISTED `content_pieces.author_id` (a soft reference
 *      into the approved voice-spec `authors[]` registry).
 *   2. The name + credentials come from the ACTIVE credentialed release's
 *      `credential` snapshot — the byline EVIDENCE captured at release time and
 *      backed by an active `byline_authorizations` row (§11.5). A piece whose
 *      release was a `client_signoff`, or whose authorization is revoked / expired
 *      / dangling, has its release resolved to `null` upstream
 *      (`readCredentialedRelease`), so NO byline is produced here — the byline is
 *      never resolved from an inactive authorization or an advisory signoff.
 *
 * Returns `null` when there is no active credentialed release — a YMYL piece then
 * fails the FSM's YMYL_NO_BYLINE clause (fail-closed), which is the intended
 * behavior: no release ⇒ no byline ⇒ no publish.
 */

import type { HumanRelease, ReleaseAuthor } from "@sagemark/core";

/**
 * Resolve the byline author from the (already authorization-checked) release plus
 * the persisted author id. The `authorId` is the value read from the persisted
 * `content_pieces` row — callers MUST pass `piece.authorId`, never a request
 * field. Only an ACTIVE `credentialed_release` yields a byline; any other release
 * shape (or `null`) yields `null`.
 */
export function resolveBylineAuthor(
  release: HumanRelease,
  persistedAuthorId: string | null,
): ReleaseAuthor | null {
  if (!release || release.releaseType !== "credentialed_release") {
    // No active credentialed release → no byline (a client_signoff / inactive
    // authorization was already downgraded upstream). Fail-closed for YMYL.
    return null;
  }
  return {
    id: persistedAuthorId ?? undefined,
    name: release.credential?.name,
    credentials: release.credential?.credentials,
  };
}
