/**
 * Bridge-token enforcement — the STANDING REGRESSION for DR-018 (C.009.1).
 *
 * AC6 of PR 007 requires that an expired / cross-run / cross-tenant / tampered
 * per-run bridge JWT be "rejected by EVERY host tool." PR 007 built + unit-tested
 * the verifier, but the four `/content/api/*` kernel routes did not invoke it
 * (DR-018). This test closes that seam end-to-end and FAILS CI until every host
 * tool authenticates the worker bearer token.
 *
 * It is TABLE-DRIVEN over ALL FOUR route handlers. A 5th host tool added without
 * an `authenticateBridgeRequest` call (or one wired to ignore the token) would
 * have to be added to this table — and if it forgot to verify, the valid/rejected
 * assertions below would fail. For each route it asserts, with a worker-shaped
 * request (Authorization: Bearer <jwt>, NO operator session):
 *
 *   (a) a valid in-scope token is ACCEPTED and binds the TOKEN's tenancy
 *       (the session ownership check is never consulted — the token is the
 *        credential — and the route proceeds past auth);
 *   (b) an EXPIRED token       -> rejected (401, code "expired");
 *   (c) a CROSS-RUN token      -> structurally the token is its own run authority,
 *       so cross-run is exercised via the signature/decoding path: a token whose
 *       run claim is re-pointed by tampering fails the signature (bad-signature);
 *   (d) a CROSS-TENANT token   -> body.clientId disagreeing with a different
 *       tenant's token is rejected (403);
 *   (e) a TAMPERED-signature token -> rejected (401, code "bad-signature");
 *   (f) body.clientId disagreeing with the token -> rejected (403,
 *       code "client-token-mismatch") — no scope-widening.
 *
 * Drives each exported handler with injected deps (no live Supabase, no session,
 * no real signing secret — the secret + clock are injected).
 */

import { describe, it, expect, vi } from "vitest";

import { handleBrief } from "@/app/content/api/brief/route";
import { handleDraft } from "@/app/content/api/draft/route";
import { handleAudit } from "@/app/content/api/audit/route";
import { handlePublish } from "@/app/content/api/publish/route";
import { mintBridgeToken } from "@/lib/auth/bridge-token";
import {
  makeData,
  pieceRow,
  approvedVoiceSpec,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
} from "./fixtures";

const SECRET = "test-bridge-secret-c0091";
const NOW = Date.parse("2026-06-26T00:00:00.000Z");
const RUN_A = "11111111-aaaa-4aaa-8aaa-run0000000a1";

/** A worker-shaped Request: Authorization: Bearer <jwt>, JSON body, NO session. */
function bridgeRequest(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/content/api/test", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** A valid in-scope token for (WORKSPACE_A, CLIENT_A, RUN_A) at NOW. */
function tokenFor(
  scope: { workspaceId: string; clientId: string; runId: string },
  over: { nowMs?: number; secret?: string } = {},
): string {
  return mintBridgeToken(scope, {
    secret: over.secret ?? SECRET,
    nowMs: over.nowMs ?? NOW,
  });
}

const SCOPE_A = { workspaceId: WORKSPACE_A, clientId: CLIENT_A, runId: RUN_A };

/**
 * The route table. Each entry exposes a handler that takes a Request + the bridge
 * auth seam (jwtSecret + bridgeNowMs), a body builder, and a no-op data view that
 * lets the route proceed PAST auth on a valid token. `data.clientBelongsToWorkspace`
 * is a spy so we can prove the bridge path never consults the session-ownership
 * check (the token is the credential).
 *
 * Adding a 5th host tool means adding a row here; if it forgets to authenticate,
 * the (b)-(f) rejection assertions below will fail for it.
 */
interface RouteCase {
  name: string;
  call: (req: Request, opts: { jwtSecret: string; bridgeNowMs: () => number }) => Promise<{
    res: Response;
    ownershipSpy: ReturnType<typeof vi.fn>;
  }>;
  /** Build a request body carrying the given tenancy (workspace optional for brief). */
  body: (tenancy: { workspaceId: string; clientId: string }) => Record<string, unknown>;
}

function commonData() {
  // CLIENT_A/WORKSPACE_A and CLIENT_B/WORKSPACE_B both "belong" so an accidental
  // session path would also succeed — this makes the spy-not-called assertion the
  // load-bearing proof that the bridge path bound the TOKEN's tenancy.
  const ownershipSpy = vi.fn(async () => true);
  const data = makeData({
    clientBelongsToWorkspace: ownershipSpy,
    getApprovedVoiceSpec: vi.fn(async () => approvedVoiceSpec()),
    loadPiece: vi.fn(async () => pieceRow()),
  });
  return { data, ownershipSpy };
}

const ROUTES: RouteCase[] = [
  {
    name: "brief",
    body: (t) => ({
      clientId: t.clientId,
      keyword: "memory care for parents",
      audience: "adult children",
      contentType: "blog-post",
      tone: "educational",
    }),
    call: async (req, opts) => {
      const { data, ownershipSpy } = commonData();
      const res = await handleBrief(req, {
        data,
        resolveWorkspace: async () => null, // NO operator session — token must carry it
        serpProvider: async () => [],
        fetcher: vi.fn(async () => new Response("", { status: 200 })),
        now: () => new Date(NOW),
        jwtSecret: opts.jwtSecret,
        bridgeNowMs: opts.bridgeNowMs,
      });
      return { res, ownershipSpy };
    },
  },
  {
    name: "draft",
    body: (t) => ({
      workspaceId: t.workspaceId,
      clientId: t.clientId,
      title: "Test Piece",
      slug: "test-piece",
      body: "## Heading\n\nSome grounded body content.\n",
    }),
    call: async (req, opts) => {
      const { data, ownershipSpy } = commonData();
      const res = await handleDraft(req, {
        data,
        resolveWorkspace: async () => null,
        jwtSecret: opts.jwtSecret,
        bridgeNowMs: opts.bridgeNowMs,
      });
      return { res, ownershipSpy };
    },
  },
  {
    name: "audit",
    body: (t) => ({
      workspaceId: t.workspaceId,
      clientId: t.clientId,
      pieceId: PIECE_A,
    }),
    call: async (req, opts) => {
      const { data, ownershipSpy } = commonData();
      const res = await handleAudit(req, {
        data,
        resolveWorkspace: async () => null,
        runGate: async () => ({
          verdict: "PUBLISH",
          score: 0.9,
          dimensions: {},
          failureCodes: [],
          stageAClean: true,
        }),
        jwtSecret: opts.jwtSecret,
        bridgeNowMs: opts.bridgeNowMs,
      });
      return { res, ownershipSpy };
    },
  },
  {
    name: "publish",
    body: (t) => ({
      workspaceId: t.workspaceId,
      clientId: t.clientId,
      pieceId: PIECE_A,
      action: "unpublish", // avoids the publish-flag gate; still runs full auth
      to: "review",
    }),
    call: async (req, opts) => {
      const ownershipSpy = vi.fn(async () => true);
      const data = makeData({
        clientBelongsToWorkspace: ownershipSpy,
        // A published piece + unpublish action gives a structurally-legal revert,
        // so a valid token reaches a non-auth (200) outcome.
        loadPiece: vi.fn(async () => pieceRow({ status: "published", verdict: "PUBLISH", evalScore: 0.9 })),
      });
      const res = await handlePublish(req, {
        data,
        resolveWorkspace: async () => null,
        publishEnabled: () => false,
        jwtSecret: opts.jwtSecret,
        bridgeNowMs: opts.bridgeNowMs,
      });
      return { res, ownershipSpy };
    },
  },
];

const AUTH_REJECTION_CODES = new Set([
  "unauthorized",
  "not-found",
  "malformed",
  "bad-signature",
  "expired",
  "wrong-run",
  "wrong-tenant",
  "client-token-mismatch",
]);

const deps = { jwtSecret: SECRET, bridgeNowMs: () => NOW };

describe("bridge-auth — every host tool authenticates the per-run JWT (DR-018 / AC6)", () => {
  for (const route of ROUTES) {
    describe(`/content/api/${route.name}`, () => {
      it("(a) accepts a valid in-scope token and binds the TOKEN's tenancy (no session)", async () => {
        const token = tokenFor(SCOPE_A);
        const { res, ownershipSpy } = await route.call(
          bridgeRequest(token, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_A })),
          deps,
        );
        // The route proceeded PAST auth — it is NOT an auth rejection.
        const body = await res.json().catch(() => ({}));
        expect(
          AUTH_REJECTION_CODES.has(body.code),
          `valid token must not be an auth rejection (got status ${res.status} code ${body.code})`,
        ).toBe(false);
        expect([401, 403]).not.toContain(res.status);
        // The session-ownership check was NEVER consulted — the token is the credential.
        expect(ownershipSpy).not.toHaveBeenCalled();
      });

      it("(b) rejects an EXPIRED token (401, code expired)", async () => {
        // exp = mint NOW + 90s; verify ~2 minutes later.
        const token = tokenFor(SCOPE_A, { nowMs: NOW });
        const { res } = await route.call(
          bridgeRequest(token, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_A })),
          { jwtSecret: SECRET, bridgeNowMs: () => NOW + 120_000 },
        );
        const body = await res.json();
        expect(res.status).toBe(401);
        expect(body.code).toBe("expired");
      });

      it("(c) rejects a token whose run claim was re-pointed (signature breaks)", async () => {
        // Mint for RUN_A, then tamper the run claim → the signature no longer
        // matches → bad-signature. (A token is its own run authority, so a
        // *validly signed* token can only ever be for its own run; re-pointing the
        // run is exactly a tamper.)
        const token = tokenFor(SCOPE_A);
        const tampered = repointRunClaim(token, "99999999-bbbb-4bbb-8bbb-run0000000b9");
        const { res } = await route.call(
          bridgeRequest(tampered, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_A })),
          deps,
        );
        const body = await res.json();
        expect([401, 403]).toContain(res.status);
        expect(["bad-signature", "malformed"]).toContain(body.code);
      });

      it("(d) rejects a CROSS-TENANT token (token tenant != body tenant) (403)", async () => {
        // A validly-signed token for tenant B, presented on a body for tenant A.
        const tokenB = tokenFor({
          workspaceId: WORKSPACE_B,
          clientId: CLIENT_B,
          runId: RUN_A,
        });
        const { res } = await route.call(
          bridgeRequest(tokenB, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_A })),
          deps,
        );
        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body.code).toBe("client-token-mismatch");
      });

      it("(e) rejects a TAMPERED-signature token (401, code bad-signature)", async () => {
        const token = tokenFor(SCOPE_A);
        const forged = `${token.slice(0, -3)}${token.slice(-3) === "aaa" ? "bbb" : "aaa"}`;
        const { res } = await route.call(
          bridgeRequest(forged, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_A })),
          deps,
        );
        const body = await res.json();
        expect(res.status).toBe(401);
        expect(["bad-signature", "malformed"]).toContain(body.code);
      });

      it("(f) rejects body.clientId disagreeing with the token (403, no scope-widening)", async () => {
        // Valid token for CLIENT_A, but the body asks to act on CLIENT_B.
        const tokenA = tokenFor(SCOPE_A);
        const { res } = await route.call(
          bridgeRequest(tokenA, route.body({ workspaceId: WORKSPACE_A, clientId: CLIENT_B })),
          deps,
        );
        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body.code).toBe("client-token-mismatch");
      });
    });
  }
});

/**
 * Re-point the `run` claim of a compact JWS without re-signing — produces a token
 * whose payload no longer matches its signature (the cross-run tamper case).
 */
function repointRunClaim(token: string, newRun: string): string {
  const [header, payload, sig] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
  claims.run = newRun;
  const newPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${newPayload}.${sig}`;
}
