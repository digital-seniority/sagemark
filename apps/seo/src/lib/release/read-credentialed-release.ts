/**
 * read-credentialed-release — resolve the persisted human-release record into the
 * FSM's `HumanRelease` shape, applying the two fail-closed gates the publish
 * predicate depends on.
 *
 * SOURCE OF TRUTH: the `credentialed_releases` table (read via the route's
 * `ContentDataAccess.getRelease` seam). This module CENTRALIZES the release-read +
 * authorization-active logic that was previously inlined in
 * `apps/seo/src/app/content/api/publish/route.ts`, so both the kernel publish
 * route and the new studio `/api/publish` route resolve a release identically.
 *
 * TWO FAIL-CLOSED GATES (default deny):
 *
 *   1. `client_signoff` can NEVER release. An advisory `client_signoff` row is
 *      passed THROUGH unchanged so the FSM resolves it to NO_HUMAN_RELEASE — it
 *      is structurally incapable of satisfying the precondition (no credential,
 *      no authorization_id). It is never up-converted to a credentialed release.
 *
 *   2. A `credentialed_release` is honored ONLY when its `authorization_id`
 *      resolves to an ACTIVE `byline_authorizations` row (§11.5). A revoked /
 *      expired / dangling authorization DOWNGRADES the release to `null`, so the
 *      FSM blocks publish and the byline is NEVER resolved from an inactive
 *      authorization.
 *
 * Returns the resolved `HumanRelease` (which the FSM then judges) — it does NOT
 * itself decide publishability; `canPublish()` remains the single authority.
 */

import type { HumanRelease } from "@sagemark/core";
import type {
  ContentDataAccess,
  PersistedRelease,
} from "@/lib/content/context";
import { isAuthorizationActive } from "./authorization-active";

/** The minimal data-access surface this reader needs (the authorization lookup). */
export type ReleaseReaderData = Pick<ContentDataAccess, "getAuthorization">;

/**
 * Resolve a persisted release into the FSM's `HumanRelease`.
 *
 *   - `null` release            → `null` (no recorded release).
 *   - `client_signoff`          → passed through as a `client_signoff` shape (the
 *                                 FSM rejects it as NO_HUMAN_RELEASE).
 *   - `credentialed_release`    → honored ONLY if its `authorization_id` resolves
 *                                 to an ACTIVE authorization; otherwise `null`
 *                                 (fail-closed — revoked / expired / dangling).
 *
 * The `clientId` is the BOUND tenancy client (never request input); it scopes the
 * authorization lookup. `now` is injectable for deterministic expiry tests.
 */
export async function readCredentialedRelease(
  release: PersistedRelease | null,
  clientId: string,
  data: ReleaseReaderData,
  now: Date = new Date(),
): Promise<HumanRelease> {
  if (!release) return null;

  // Gate 1 — an advisory client_signoff can never release. Pass it through so the
  // FSM resolves NO_HUMAN_RELEASE; never up-convert it to a credentialed release.
  if (release.releaseType === "client_signoff") {
    return { releaseType: "client_signoff", actorId: release.actorId };
  }

  // Gate 2 — a credentialed_release must carry an ACTIVE backing authorization.
  if (!release.authorizationId) return null; // structurally incomplete → fail closed
  const auth = await data.getAuthorization(release.authorizationId, clientId);
  const status = isAuthorizationActive(auth, now);
  if (!status.active) return null; // revoked / expired / dangling → fail closed

  return {
    releaseType: "credentialed_release",
    actorId: release.actorId,
    credential: release.credential ?? {},
    authorizationId: release.authorizationId,
  };
}
