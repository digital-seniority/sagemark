/**
 * signoff — the TWO distinct persisted sign-off acts (PR 019 / P1.C.2, lane
 * client-review).
 *
 * Two acts, two TABLES, two actors, two permission levels — never one flag:
 *
 *   1. `recordClientSignoff` writes ONE `client_signoffs` row (PR 004 `0032`). It
 *      is ADVISORY: the client/agency contact's approval / comment resolution. It
 *      can NEVER release a piece and is STRUCTURALLY incapable of supplying a
 *      reviewer byline — the `ClientSignoffInsert` payload has NO `credential` and
 *      NO `authorizationId`, mirroring the table (which has no such columns).
 *      `canPublish()` reads `credentialed_releases`, never this — a `client_signoffs`
 *      row alone leaves the piece UNRELEASABLE and never populates the byline.
 *
 *   2. `recordCredentialedRelease` writes ONE `credentialed_releases` row — the
 *      ONLY record `canPublish()` accepts as the human release for a YMYL piece. It
 *      writes the named, undeletable release version recording the reviewer's
 *      identity + `credential` snapshot + `authorizationId`, and is the SOLE source
 *      of the E-E-A-T "Reviewed by [Name, Credential]" byline.
 *
 * THE CREDENTIALED RELEASE WRITE IS FAIL-CLOSED (§11.5 + DR-037):
 *
 *   - ACTIVE-AUTHORIZATION (§11.5): the write proceeds ONLY when the supplied
 *     `authorizationId` resolves to an ACTIVE `byline_authorizations` row (granted
 *     ∧ not revoked ∧ not expired), checked HERE at WRITE time with the SAME
 *     `isAuthorizationActive` predicate the publish READ path uses. A revoked /
 *     expired / dangling authorization → NO release written, publish stays blocked.
 *
 *   - DR-037 GO-LIVE GUARD: the seeded PILOT PLACEHOLDER reviewer (`placeholder:
 *     true` on its authorization, name "Pending Clinical Reviewer") can NEVER back
 *     a real release in a non-pilot/production context. When `context.pilot` is
 *     false (production), a placeholder authorization is REFUSED — no release
 *     written. The real credentialed reviewer must replace the placeholder before
 *     any production YMYL publish.
 *
 * The byline EVIDENCE (the `credential` snapshot written onto the release) is taken
 * from the AUTHORIZATION row, never from request input — the byline can never be
 * injected by a caller.
 *
 * PURE w.r.t. policy; the I/O (the authorization lookup + the two inserts) is the
 * injected `ContentDataAccess` seam, so this is fully unit-testable with fixtures
 * (active / revoked / expired / dangling / placeholder). No `server-only` marker.
 * Clean ASCII / UTF-8.
 */

import type {
  ContentDataAccess,
  ClientSignoffInsert,
  CredentialedReleaseInsert,
  PersistedAuthorization,
} from "@/lib/content/context";
import { isAuthorizationActive } from "@/lib/release/authorization-active";

/** The seam surface the sign-off writer needs (lookup + the two inserts). */
export type SignoffData = Pick<
  ContentDataAccess,
  "getAuthorization" | "insertClientSignoff" | "insertCredentialedRelease"
>;

/** The recognizable placeholder reviewer name (DR-037 sentinel, defense-in-depth). */
export const PLACEHOLDER_REVIEWER_NAME = "Pending Clinical Reviewer";

/** Why a credentialed release was REFUSED at write time (stable, never prose). */
export type ReleaseRefusedReason =
  | "authorization-inactive" // §11.5: revoked / expired / dangling backing authorization
  | "placeholder-in-production"; // DR-037: the seeded pilot placeholder used outside pilot

export type ClientSignoffResult = { ok: true; id: string };

export type CredentialedReleaseResult =
  | { ok: true; id: string }
  | { ok: false; reason: ReleaseRefusedReason };

/**
 * Record the ADVISORY client sign-off. Writes ONE `client_signoffs` row and
 * returns its id. It can NEVER release the piece nor supply a byline — the payload
 * is structurally incapable of either (no credential, no authorization_id). This
 * function does NOT touch `credentialed_releases` and never resolves a byline.
 */
export async function recordClientSignoff(
  insert: ClientSignoffInsert,
  data: Pick<ContentDataAccess, "insertClientSignoff">,
): Promise<ClientSignoffResult> {
  const { id } = await data.insertClientSignoff(insert);
  return { ok: true, id };
}

/** Is this authorization the DR-037 seeded PILOT PLACEHOLDER? */
export function isPlaceholderAuthorization(
  auth: PersistedAuthorization | null | undefined,
): boolean {
  if (!auth) return false;
  // Primary marker: the additive `placeholder` boolean column (migration 0038).
  if (auth.placeholder === true) return true;
  // Defense-in-depth sentinel: the recognizable placeholder reviewer name on the
  // credential snapshot. Either signal blocks (a real authorization has neither).
  const name = auth.credential?.name?.trim();
  return name === PLACEHOLDER_REVIEWER_NAME;
}

/**
 * Record the CREDENTIALED release — the ONLY act that writes the human release
 * `canPublish()` reads. FAIL-CLOSED at WRITE time:
 *
 *   1. §11.5 — the `authorizationId` MUST resolve to an ACTIVE authorization
 *      (granted ∧ ¬revoked ∧ ¬expired) as of `now`. A revoked / expired / dangling
 *      authorization → REFUSED (`authorization-inactive`), NO release written.
 *   2. DR-037 — in a NON-pilot/production context (`context.pilot === false`), the
 *      seeded PLACEHOLDER reviewer is REFUSED (`placeholder-in-production`), NO
 *      release written. In the pilot it is permitted (build/test authority).
 *
 * The `credential` byline snapshot written onto the release is taken from the
 * AUTHORIZATION row (the byline evidence captured at grant), never from caller
 * input — so a caller can never inject a byline. The `actorId`/`releaseScope`/
 * tenancy come from the (host-bound) `release` argument.
 */
export async function recordCredentialedRelease(
  release: Omit<CredentialedReleaseInsert, "credential">,
  data: SignoffData,
  options: {
    /** Pilot context permits the DR-037 placeholder; production refuses it. */
    pilot: boolean;
    /** Injectable clock for deterministic expiry tests. */
    now?: Date;
  },
): Promise<CredentialedReleaseResult> {
  const now = options.now ?? new Date();

  // 1. §11.5 ACTIVE-AUTHORIZATION gate — at WRITE time, same predicate as the read
  //    path. A revoked / expired / dangling (missing) authorization is refused.
  const auth = await data.getAuthorization(release.authorizationId, release.clientId);
  const active = isAuthorizationActive(auth, now);
  if (!active.active) {
    return { ok: false, reason: "authorization-inactive" };
  }

  // 2. DR-037 GO-LIVE GUARD — the seeded pilot placeholder can never back a real
  //    release in production. (`auth` is non-null here — active implies present.)
  if (!options.pilot && isPlaceholderAuthorization(auth)) {
    return { ok: false, reason: "placeholder-in-production" };
  }

  // The byline EVIDENCE is the authorization's credential snapshot — never input.
  const credential = auth!.credential ?? {};

  const { id } = await data.insertCredentialedRelease({
    ...release,
    credential,
  });
  return { ok: true, id };
}
