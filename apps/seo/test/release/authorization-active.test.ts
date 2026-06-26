/**
 * authorization-active — unit tests for the §11.5 ACTIVE predicate (A.005.1 /
 * DR-039). Proves the exact rule:
 *
 *     ACTIVE === GRANTED ∧ ¬REVOKED ∧ ¬EXPIRED ∧ IN-SCOPE
 *
 * and that EVERY uncertainty (missing row, missing/future granted_at, revoked,
 * expired, missing/unrecognized scope) is fail-closed INACTIVE — never
 * default-active. This is the single shared predicate BOTH the publish READ path
 * (`read-credentialed-release` -> canPublish) and the release WRITE path
 * (`signoff.recordCredentialedRelease`) call, so the read can never reject what
 * the write would accept (parity).
 */

import { describe, it, expect } from "vitest";
import {
  isAuthorizationActive,
  scopePermitsPieceRelease,
  AUTHORIZATION_SCOPES,
} from "@/lib/release/authorization-active";
import type { PersistedAuthorization } from "@/lib/content/context";

const NOW = new Date("2026-06-26T00:00:00.000Z");

/** A fully-active authorization as of NOW: granted in the past, not revoked, no
 * expiry, recognized scope. Override one field to drive each inactive case. */
function auth(over: Partial<PersistedAuthorization> = {}): PersistedAuthorization {
  return {
    id: "auth-1",
    grantedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    expiresAt: null,
    scope: "client",
    ...over,
  };
}

describe("isAuthorizationActive — the §11.5 ACTIVE predicate (A.005.1)", () => {
  it("ACTIVE: granted (past) ∧ not revoked ∧ not expired ∧ recognized scope", () => {
    expect(isAuthorizationActive(auth(), NOW)).toEqual({ active: true });
  });

  it("ACTIVE: an expiry strictly in the future is fine", () => {
    expect(
      isAuthorizationActive(auth({ expiresAt: "2099-01-01T00:00:00.000Z" }), NOW),
    ).toEqual({ active: true });
  });

  it.each(AUTHORIZATION_SCOPES)("ACTIVE: recognized scope %s permits a piece release", (scope) => {
    expect(isAuthorizationActive(auth({ scope }), NOW)).toEqual({ active: true });
  });

  // ── Fail-closed INACTIVE cases (default DENY) ────────────────────────────────

  it("INACTIVE missing: a null/undefined row (dangling FK)", () => {
    expect(isAuthorizationActive(null, NOW)).toEqual({ active: false, reason: "missing" });
    expect(isAuthorizationActive(undefined, NOW)).toEqual({ active: false, reason: "missing" });
  });

  it("INACTIVE not-granted: granted_at absent (granted is NEVER implicit)", () => {
    expect(isAuthorizationActive(auth({ grantedAt: null }), NOW)).toEqual({
      active: false,
      reason: "not-granted",
    });
    expect(isAuthorizationActive(auth({ grantedAt: undefined }), NOW)).toEqual({
      active: false,
      reason: "not-granted",
    });
  });

  it("INACTIVE not-granted: granted_at unparseable", () => {
    expect(isAuthorizationActive(auth({ grantedAt: "not-a-date" }), NOW)).toEqual({
      active: false,
      reason: "not-granted",
    });
  });

  it("INACTIVE not-granted: granted_at in the future (grant has not taken effect)", () => {
    expect(isAuthorizationActive(auth({ grantedAt: "2099-01-01T00:00:00.000Z" }), NOW)).toEqual({
      active: false,
      reason: "not-granted",
    });
  });

  it("INACTIVE revoked: revoked_at set", () => {
    expect(isAuthorizationActive(auth({ revokedAt: "2026-02-01T00:00:00.000Z" }), NOW)).toEqual({
      active: false,
      reason: "revoked",
    });
  });

  it("INACTIVE expired: expires_at at or before now", () => {
    expect(isAuthorizationActive(auth({ expiresAt: "2020-01-01T00:00:00.000Z" }), NOW)).toEqual({
      active: false,
      reason: "expired",
    });
    // boundary: an expiry exactly at `now` is expired (<=).
    expect(isAuthorizationActive(auth({ expiresAt: NOW.toISOString() }), NOW)).toEqual({
      active: false,
      reason: "expired",
    });
  });

  it("INACTIVE out-of-scope: scope absent (scope is NEVER implicit)", () => {
    expect(isAuthorizationActive(auth({ scope: undefined }), NOW)).toEqual({
      active: false,
      reason: "out-of-scope",
    });
  });

  it("INACTIVE out-of-scope: scope empty / unrecognized", () => {
    expect(isAuthorizationActive(auth({ scope: "" }), NOW)).toEqual({
      active: false,
      reason: "out-of-scope",
    });
    expect(isAuthorizationActive(auth({ scope: "bogus" }), NOW)).toEqual({
      active: false,
      reason: "out-of-scope",
    });
  });
});

describe("scopePermitsPieceRelease — conservative scope rule", () => {
  it.each(AUTHORIZATION_SCOPES)("permits recognized scope %s", (scope) => {
    expect(scopePermitsPieceRelease(scope)).toBe(true);
  });
  it("is case/whitespace tolerant for a recognized scope", () => {
    expect(scopePermitsPieceRelease(" Client ")).toBe(true);
  });
  it.each([undefined, null, "", "  ", "bogus", "section", "global"])(
    "refuses an absent/unrecognized scope (%s)",
    (scope) => {
      expect(scopePermitsPieceRelease(scope as string | null | undefined)).toBe(false);
    },
  );
});
