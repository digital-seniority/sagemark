/**
 * The per-run bridge JWT — mint + verify (PR 007 / P0.W.4, lane worker-runtime;
 * extracted to a reusable lib by C.009.1 / DR-018).
 *
 * THE WORKER↔HOST CREDENTIAL. `/api/run` mints a compact HS256 JWS scoped to
 * EXACTLY one `(workspace_id, client_id, run_id)` and expiring at the run-budget
 * ceiling (~90s). It is the worker's ONLY host credential: the worker holds no
 * Supabase client and no operator session, so every call it makes back into the
 * `/content/api/*` kernel routes carries this token as `Authorization: Bearer`.
 * Every host tool re-derives tenancy from the verified claims — NEVER from a
 * request argument — so a token for client A is structurally unable to act on
 * client B (`wrong-tenant`/`wrong-run` rejection).
 *
 * This module was lifted verbatim out of `apps/seo/src/app/api/run/route.ts` so
 * the verifier can be invoked at the kernel-route call sites (DR-018) WITHOUT the
 * routes importing a Next route file. Behavior is identical to PR 007; the run
 * route re-exports `mintBridgeToken`/`verifyBridgeToken` to keep its public
 * surface (and PR 007's tests) green.
 *
 * The signature is checked in CONSTANT TIME before any claim is trusted.
 *
 * No `server-only` marker: the signing secret is read lazily inside
 * `bridgeSigningSecret()`, so this module is importable by plain-Node tests that
 * inject the secret. Clean ASCII / UTF-8.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { RUN_BUDGET_CEILING_MS } from "@/lib/stream/sse-relay";

// Re-export the run-budget ceiling so callers can reach it from the bridge-token
// module too. The canonical definition stays in `sse-relay.ts` (its owner), which
// the existing PR 007 tests import from — moving it would break that surface.
export { RUN_BUDGET_CEILING_MS };

// ── The per-run bridge JWT (acceptance 6) ─────────────────────────────────────

/**
 * The claims the bridge JWT carries. Scoped to EXACTLY one (workspace, client,
 * run) — the worker cannot widen tenancy because the host re-derives it from
 * these claims, never from a request argument.
 */
export interface BridgeTokenClaims {
  /** workspace_id (tenancy). */
  ws: string;
  /** client_id (tenancy). */
  cl: string;
  /** run_id (the run this token may act for). */
  run: string;
  /** issued-at (epoch seconds). */
  iat: number;
  /** expiry (epoch seconds) — the run-budget ceiling. */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Resolve the HMAC signing secret for the bridge JWT. Reads the host env (NEVER
 * shipped to the worker). Fail-closed: a missing secret throws so we never mint
 * an unsigned/forgeable token.
 */
export function bridgeSigningSecret(): string {
  const secret = process.env.SEO_BRIDGE_JWT_SECRET ?? process.env.SEO_RUN_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SEO_BRIDGE_JWT_SECRET is not set on the host — cannot mint the per-run bridge JWT (fail-closed).",
    );
  }
  return secret;
}

/**
 * Mint a compact JWS (HS256) per-run bridge token. Standard `header.payload.sig`
 * serialization signed with HMAC-SHA256 — no external dep needed (acceptance 6).
 * `exp` is set to `now + ceilingMs` (~90s, the single-piece cap).
 */
export function mintBridgeToken(
  scope: { workspaceId: string; clientId: string; runId: string },
  opts: { secret?: string; nowMs?: number; ceilingMs?: number } = {},
): string {
  const secret = opts.secret ?? bridgeSigningSecret();
  const nowMs = opts.nowMs ?? Date.now();
  const ceilingMs = opts.ceilingMs ?? RUN_BUDGET_CEILING_MS;
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ceilingMs) / 1000);

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: BridgeTokenClaims = {
    ws: scope.workspaceId,
    cl: scope.clientId,
    run: scope.runId,
    iat,
    exp,
  };
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

/** The reason a bridge token failed verification (stable, for host-tool 401/403). */
export type BridgeTokenRejection =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-run"
  | "wrong-tenant";

export type VerifyBridgeTokenResult =
  | { ok: true; claims: BridgeTokenClaims }
  | { ok: false; reason: BridgeTokenRejection };

/**
 * Verify a per-run bridge token against an EXPECTED (workspace, client, run)
 * scope. This is what every host tool calls (acceptance 6): a token minted for
 * run A is rejected (`wrong-run`) for run B; a token for tenant A is rejected
 * (`wrong-tenant`) for tenant B; an expired token is rejected (`expired`). The
 * signature is checked in constant time before any claim is trusted.
 */
export function verifyBridgeToken(
  token: string,
  expected: { workspaceId: string; clientId: string; runId: string },
  opts: { secret?: string; nowMs?: number } = {},
): VerifyBridgeTokenResult {
  const secret = opts.secret ?? bridgeSigningSecret();
  const nowMs = opts.nowMs ?? Date.now();

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const header = parts[0]!;
  const payload = parts[1]!;
  const sig = parts[2]!;

  // 1. Verify the signature in constant time BEFORE trusting any claim.
  const expectedSig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  // 2. Decode claims.
  let claims: BridgeTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BridgeTokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };

  // 3. Expiry (acceptance 6 — expires at the run-budget ceiling).
  if (Math.floor(nowMs / 1000) >= claims.exp) return { ok: false, reason: "expired" };

  // 4. Tenancy + run scope (acceptance 6 — cross-run / cross-tenant rejected).
  if (claims.ws !== expected.workspaceId || claims.cl !== expected.clientId) {
    return { ok: false, reason: "wrong-tenant" };
  }
  if (claims.run !== expected.runId) return { ok: false, reason: "wrong-run" };

  return { ok: true, claims };
}
