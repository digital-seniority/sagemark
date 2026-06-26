/**
 * authorization-active — the §11.5 fail-closed byline-authorization check.
 *
 * Resolves a `credentialed_release`'s `authorization_id` → `byline_authorizations`
 * row and decides whether that authorization is ACTIVE (granted ∧ not revoked ∧
 * not expired). A revoked / expired / dangling (missing) authorization is treated
 * as a FAIL-CLOSED block: the release does NOT satisfy the human-release
 * precondition, so publish is blocked and the byline is NEVER resolved from an
 * inactive authorization. Default-deny — never default-allow.
 *
 * PURE w.r.t. the row (no I/O of its own); the row is loaded by the caller via the
 * route's `ContentDataAccess.getAuthorization` seam so this is unit-testable with
 * injected fixtures (revoked / expired / inactive / active).
 */

import type { PersistedAuthorization } from "@/lib/content/context";

/** Why an authorization fails the active check (stable, never prose). */
export type AuthorizationInactiveReason =
  | "missing" // dangling FK — no row resolves
  | "revoked" // revoked_at is set
  | "expired"; // expires_at is in the past

export type AuthorizationActiveResult =
  | { active: true }
  | { active: false; reason: AuthorizationInactiveReason };

/**
 * Decide whether a resolved authorization row is ACTIVE as of `now`.
 *
 * Fail-closed ordering: a null/undefined row is `missing` (dangling FK → block);
 * a `revoked_at` set is `revoked`; an `expires_at` at or before `now` is
 * `expired`. Only a row that survives all three is active. The default is DENY —
 * any uncertainty blocks.
 */
export function isAuthorizationActive(
  auth: PersistedAuthorization | null | undefined,
  now: Date,
): AuthorizationActiveResult {
  if (!auth) return { active: false, reason: "missing" };
  if (auth.revokedAt) return { active: false, reason: "revoked" };
  if (
    auth.expiresAt &&
    new Date(auth.expiresAt).getTime() <= now.getTime()
  ) {
    return { active: false, reason: "expired" };
  }
  return { active: true };
}
