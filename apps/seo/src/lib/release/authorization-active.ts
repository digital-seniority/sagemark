/**
 * authorization-active — the §11.5 fail-closed byline-authorization check.
 *
 * Resolves a `credentialed_release`'s `authorization_id` -> `byline_authorizations`
 * row and decides whether that authorization is ACTIVE. A.005.1 / DR-039 hardens
 * "active" to the full §11.5 predicate:
 *
 *     ACTIVE  ===  GRANTED  AND  NOT REVOKED  AND  NOT EXPIRED  AND  IN SCOPE
 *
 *   - GRANTED      `granted_at` is present AND not in the future (a grant dated
 *                  after `now` has not taken effect yet). A missing/unparseable
 *                  `granted_at` is NOT treated as granted — fail-closed.
 *   - NOT REVOKED  `revoked_at` is unset.
 *   - NOT EXPIRED  `expires_at` is unset OR strictly after `now`.
 *   - IN SCOPE     `scope` is present AND a recognized authorization scope
 *                  (`client` | `cluster` | `piece`, the DB CHECK vocabulary) that
 *                  PERMITS releasing this piece. A missing / empty / unrecognized
 *                  scope is NOT treated as permitted — fail-closed.
 *
 * A revoked / expired / not-yet-granted / dangling (missing) / out-of-scope
 * authorization is a FAIL-CLOSED block: the release does NOT satisfy the
 * human-release precondition, so publish is blocked and the byline is NEVER
 * resolved from an inactive authorization. Default-deny — never default-allow.
 *
 * SCOPE-MATCHING SEMANTICS (assumption, conservative — see A.005.1 report):
 * the §11.5 / RFC text records `scope` as part of "who authorized, scope, dates"
 * but does NOT spell out an exact scope-matching rule, and the authorization
 * `scope` vocabulary (`client`|`cluster`|`piece`) is a DIFFERENT axis from a
 * release's `release_scope` (`piece`|`section`): the authorization `scope` is the
 * BREADTH of the byline grant (which content the author may be bylined on), not
 * the granularity of the release act. The conservative rule we implement, which
 * does NOT loosen the predicate and does NOT break the legitimate broad grant the
 * pilot uses (`scope:'client'`):
 *
 *     a piece-level release REQUIRES an authorization whose `scope` is a
 *     recognized authorization scope (client | cluster | piece). All three
 *     recognized scopes authorize bylining the author on a piece (client = any
 *     piece for the client; cluster / piece = a narrower grant that still
 *     authorizes that piece). An UNRECOGNIZED or ABSENT scope FAILS (fail-closed).
 *
 * If the program later defines a stricter cluster/piece-id binding, narrow
 * `scopePermitsPieceRelease` — never widen the absent/unrecognized case to allow.
 *
 * PURE w.r.t. the row (no I/O of its own); the row is loaded by the caller via the
 * route's `ContentDataAccess.getAuthorization` seam so this is unit-testable with
 * injected fixtures (revoked / expired / not-yet-granted / out-of-scope / active).
 */

import type { PersistedAuthorization } from "@/lib/content/context";

/** Why an authorization fails the active check (stable, never prose). */
export type AuthorizationInactiveReason =
  | "missing" // dangling FK — no row resolves
  | "not-granted" // granted_at absent/unparseable, or dated in the future
  | "revoked" // revoked_at is set
  | "expired" // expires_at is in the past
  | "out-of-scope"; // scope absent/empty/unrecognized (does not permit the release)

export type AuthorizationActiveResult =
  | { active: true }
  | { active: false; reason: AuthorizationInactiveReason };

/** The recognized `byline_authorizations.scope` vocabulary (the DB CHECK set). */
export const AUTHORIZATION_SCOPES = ["client", "cluster", "piece"] as const;
export type AuthorizationScope = (typeof AUTHORIZATION_SCOPES)[number];

/**
 * Does this authorization `scope` permit a piece-level credentialed release?
 *
 * Conservative + fail-closed: ONLY a recognized scope permits; an absent / empty /
 * unrecognized scope returns false (the predicate then blocks). All three
 * recognized authorization scopes authorize releasing a piece (see the module
 * doc-comment for the breadth rationale and the narrowing path).
 */
export function scopePermitsPieceRelease(scope: string | null | undefined): boolean {
  if (typeof scope !== "string") return false;
  const normalized = scope.trim().toLowerCase();
  return (AUTHORIZATION_SCOPES as readonly string[]).includes(normalized);
}

/** Parse an ISO timestamp to epoch ms, or null if absent/unparseable (fail-closed). */
function toEpochMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide whether a resolved authorization row is ACTIVE as of `now`.
 *
 * Fail-closed ordering (any uncertainty blocks, default DENY):
 *   1. null/undefined row              -> `missing` (dangling FK).
 *   2. `granted_at` absent / unparseable / in the future -> `not-granted`.
 *   3. `revoked_at` set                -> `revoked`.
 *   4. `expires_at` at or before `now` -> `expired`.
 *   5. `scope` absent / unrecognized   -> `out-of-scope`.
 * Only a row that survives all five is active.
 */
export function isAuthorizationActive(
  auth: PersistedAuthorization | null | undefined,
  now: Date,
): AuthorizationActiveResult {
  if (!auth) return { active: false, reason: "missing" };

  // 1. GRANTED — granted_at must be present, parseable, and not in the future.
  //    A missing/unparseable grant is NOT implicitly granted (fail-closed).
  const grantedMs = toEpochMs(auth.grantedAt);
  if (grantedMs === null || grantedMs > now.getTime()) {
    return { active: false, reason: "not-granted" };
  }

  // 2. NOT REVOKED.
  if (auth.revokedAt) return { active: false, reason: "revoked" };

  // 3. NOT EXPIRED — an expiry at or before `now` is expired.
  const expiresMs = toEpochMs(auth.expiresAt);
  if (expiresMs !== null && expiresMs <= now.getTime()) {
    return { active: false, reason: "expired" };
  }

  // 4. IN SCOPE — a recognized authorization scope that permits the piece release.
  if (!scopePermitsPieceRelease(auth.scope)) {
    return { active: false, reason: "out-of-scope" };
  }

  return { active: true };
}
