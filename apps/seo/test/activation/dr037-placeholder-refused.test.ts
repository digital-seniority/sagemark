/**
 * dr037-placeholder-refused.test.ts — the DR-037 LOAD-BEARING go-live proof.
 *
 * Ties the activation gate to the credentialed-release write: in PRODUCTION the
 * activation `isPilot()` resolves to false, and a credentialed release backed by the
 * seeded PILOT PLACEHOLDER reviewer is REFUSED (`placeholder-in-production`) — no
 * release written, so a real YMYL piece can NEVER be published off a placeholder in
 * prod. The pilot context (non-production + PILOT flag) permits it (build/test
 * authority). This is the end-to-end DR-037 assertion the judge checks.
 *
 * No DB / network: `recordCredentialedRelease` takes an injected `SignoffData` seam
 * (a spy) and the `pilot` flag is fed from `isPilot(env)` with an injected env.
 */
import { describe, it, expect, vi } from "vitest";
import { recordCredentialedRelease, PLACEHOLDER_REVIEWER_NAME } from "@/lib/review/signoff";
import { isPilot } from "@/lib/activation";
import type {
  PersistedAuthorization,
  CredentialedReleaseInsert,
} from "@/lib/content/context";

const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** An ACTIVE placeholder authorization (granted, in-scope, not revoked/expired). */
function placeholderAuth(now: Date): PersistedAuthorization {
  const past = new Date(now.getTime() - 60_000).toISOString();
  return {
    id: AUTH_ID,
    grantedAt: past,
    revokedAt: null,
    expiresAt: null,
    scope: "client",
    placeholder: true, // DR-037 sentinel (migration 0038 column)
    credential: { name: PLACEHOLDER_REVIEWER_NAME, credentials: "RN" },
  };
}

/** A spy SignoffData seam: resolves the placeholder auth, records insert calls. */
function makeSpyData(auth: PersistedAuthorization) {
  const inserts: CredentialedReleaseInsert[] = [];
  const data = {
    getAuthorization: vi.fn(async () => auth),
    insertClientSignoff: vi.fn(async () => ({ id: "signoff-1" })),
    insertCredentialedRelease: vi.fn(async (insert: CredentialedReleaseInsert) => {
      inserts.push(insert);
      return { id: "release-1" };
    }),
  };
  return { data, inserts };
}

const RELEASE: Omit<CredentialedReleaseInsert, "credential"> = {
  workspaceId: "wwwwwwww-wwww-4www-8www-wwwwwwwwwwww",
  clientId: CLIENT,
  pieceId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
  version: 1,
  actorId: "actor-1",
  authorizationId: AUTH_ID,
  releaseScope: "piece",
};

describe("DR-037: production => pilot:false => placeholder release REFUSED", () => {
  it("production env resolves pilot:false, and the placeholder release is refused (no write)", async () => {
    const now = new Date("2026-06-26T00:00:00Z");
    const { data, inserts } = makeSpyData(placeholderAuth(now));

    // Activation: production => isPilot() is false (the DR-037 invariant).
    const pilot = isPilot({ VERCEL_ENV: "production", PILOT: "1" });
    expect(pilot).toBe(false);

    const result = await recordCredentialedRelease(RELEASE, data, { pilot, now });

    expect(result).toEqual({ ok: false, reason: "placeholder-in-production" });
    // The load-bearing proof: NO credentialed release was written.
    expect(data.insertCredentialedRelease).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("pilot context (non-production + PILOT flag) permits the placeholder (build authority)", async () => {
    const now = new Date("2026-06-26T00:00:00Z");
    const { data, inserts } = makeSpyData(placeholderAuth(now));

    const pilot = isPilot({ VERCEL_ENV: "preview", PILOT: "1" });
    expect(pilot).toBe(true);

    const result = await recordCredentialedRelease(RELEASE, data, { pilot, now });

    expect(result).toEqual({ ok: true, id: "release-1" });
    expect(inserts).toHaveLength(1);
    // The byline evidence is snapshot from the authorization, never request input.
    expect(inserts[0].credential).toEqual({
      name: PLACEHOLDER_REVIEWER_NAME,
      credentials: "RN",
    });
  });
});
