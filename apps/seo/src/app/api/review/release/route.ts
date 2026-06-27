/**
 * POST /api/review/release — the CREDENTIALED-REVIEWER release authorization
 * (audit-006 H1, lane client-review / schema-tenancy).
 *
 * THE MISSING WRITE SEAM. `recordCredentialedRelease` (apps/seo/src/lib/review/
 * signoff.ts) is the SOLE writer of `credentialed_releases` — the only record
 * `canPublish()` accepts as the human release for a YMYL piece — but had ZERO
 * non-test callers. The publish route only READS a release; nothing WROTE one. This
 * route is that writer: an authenticated, credentialed reviewer (D6) authorizes the
 * release of a piece against an ACTIVE `byline_authorizations` row.
 *
 * THIS IS THE CREDENTIALED PATH, NOT THE CLIENT PATH (DR-037):
 *   - `/api/review/comments` is the CLIENT/agency token-scoped surface — it writes
 *     `comment_threads` / (advisory) `client_signoffs` and can NEVER release a
 *     piece. A client sign-off must NEVER satisfy a credentialed release.
 *   - THIS route is OPERATOR/credentialed-reviewer authenticated (no client token):
 *     it binds tenancy SERVER-side (operator session OR worker bridge JWT — the
 *     SAME chokepoint the other kernel routes use) and writes ONLY a
 *     `credentialed_releases` row via the fail-closed `recordCredentialedRelease`.
 *
 * FAIL-CLOSED / TENANT-SCOPED / DR-037:
 *   1. AUTH → bind tenancy SERVER-side. 401 unauth / 404 foreign client / 403 a
 *      request tenancy that disagrees with the bound context. NEVER trust body
 *      tenancy to widen scope.
 *   2. The piece is loaded scoped by the BOUND `clientId` (a cross-tenant piece id
 *      resolves to null → 404). The release `version` is derived from the PERSISTED
 *      piece row, never request input.
 *   3. `recordCredentialedRelease` is called with `pilot: isPilot()`. In production
 *      (`VERCEL_ENV === 'production'`) `isPilot()` is ALWAYS false, so the seeded
 *      PILOT PLACEHOLDER reviewer is REFUSED (`placeholder-in-production`) — no
 *      release written. A revoked / expired / dangling authorization is likewise
 *      REFUSED (`authorization-inactive`, §11.5). Either refusal → 422 (no write).
 *   4. The byline EVIDENCE (`credential`) and the tenancy (`workspaceId`/
 *      `clientId`) are bound SERVER-side: the credential is snapshot inside
 *      `recordCredentialedRelease` from the AUTHORIZATION row (never request input),
 *      and the tenancy comes from the bound context (never the body).
 *
 * Handler exported as `handleReviewRelease(request, deps)` for test injection. PII
 * rule: log only ids + version + outcome; never the credential/byline.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import {
  recordCredentialedRelease,
  type CredentialedReleaseResult,
} from "@/lib/review/signoff";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import { isPilot as activationIsPilot } from "@/lib/activation";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── The request body ──────────────────────────────────────────────────────────
// Tenancy is request-supplied (validated against the bound context, never trusted
// to widen). `authorizationId` names the byline authorization the reviewer releases
// against (the §11.5 / DR-037 gates run on THIS authorization inside the writer).
// `actorId` is the credentialed reviewer id (the D6 who released). NO `credential`
// / `version` / byline here — the credential is snapshot SERVER-side from the
// authorization, and the version is read from the PERSISTED piece row.
const BodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
    authorizationId: z.string().uuid(),
    actorId: z.string().min(1).max(256),
    releaseScope: z.enum(["piece", "section"]).optional(),
  })
  .strict();

// ── Dependency seam ───────────────────────────────────────────────────────────

export interface ReviewReleaseDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  /**
   * DR-037 pilot flag. Defaults to the activation `isPilot()` (production is ALWAYS
   * false → the placeholder reviewer is refused). Test-injectable so the
   * placeholder-in-production refusal is exercised deterministically.
   */
  isPilot: () => boolean;
  /** Injectable clock for deterministic authorization-expiry tests. */
  now?: () => Date;
}

const DEFAULT_DEPS: ReviewReleaseDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  isPilot: () => activationIsPilot(),
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Map a write-time refusal reason to a stable response (never prose). */
function refusalResponse(result: Extract<CredentialedReleaseResult, { ok: false }>): NextResponse {
  // §11.5 inactive authorization OR DR-037 placeholder-in-production → 422, no write.
  return json({ error: "release refused", code: "release-refused", reason: result.reason }, 422);
}

/**
 * The injectable handler. A credentialed reviewer authorizes the release of a piece
 * against an ACTIVE byline authorization; on success ONE `credentialed_releases`
 * row is written (the byline snapshot + tenancy bound SERVER-side).
 */
export async function handleReviewRelease(
  request: Request,
  deps: ReviewReleaseDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  // 2. AUTH → bind tenancy SERVER-side (operator session OR worker bridge JWT).
  //    401 unauth / 404 foreign client / (below) 403 tenancy disagreement.
  const bound = await authenticateBridgeRequest(
    request,
    body.clientId,
    deps.data,
    deps.resolveWorkspace,
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. WORKSPACE-OWNERSHIP: a request tenancy that disagrees with the bound
  //    context is rejected (403) — never used to widen tenancy.
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. Load the persisted piece scoped by the BOUND client (cross-tenant id → 404).
  //    The release `version` is read from the PERSISTED row, NEVER request input.
  const piece = await deps.data.loadPiece(body.pieceId, ctx.clientId);
  if (!piece) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 5. Record the CREDENTIALED release — the SOLE writer of `credentialed_releases`.
  //    FAIL-CLOSED inside `recordCredentialedRelease`:
  //      - §11.5: the authorization MUST resolve ACTIVE (granted, not revoked /
  //        expired / dangling) — checked at WRITE time → else `authorization-inactive`.
  //      - DR-037: in production `deps.isPilot()` is false → the seeded PILOT
  //        PLACEHOLDER reviewer is refused → `placeholder-in-production`.
  //    The `credential` byline is snapshot from the authorization (never request
  //    input); the tenancy is the BOUND context (never the body).
  const result = await recordCredentialedRelease(
    {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      pieceId: body.pieceId,
      version: piece.version,
      actorId: body.actorId,
      authorizationId: body.authorizationId,
      releaseScope: body.releaseScope ?? "piece",
    },
    deps.data,
    { pilot: deps.isPilot(), now: deps.now?.() },
  );

  if (!result.ok) {
    console.log(
      `[api/review/release] refused workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} ` +
        `pieceId=${body.pieceId} version=${piece.version} reason=${result.reason}`,
    );
    return refusalResponse(result);
  }

  console.log(
    `[api/review/release] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} ` +
      `pieceId=${body.pieceId} version=${piece.version} releaseId=${result.id}`,
  );

  return json(
    { pieceId: body.pieceId, version: piece.version, releaseId: result.id, released: true },
    201,
  );
}

export async function POST(request: Request): Promise<Response> {
  // ACTIVATION (DR-026): resolve the live ContentDataAccess BEHIND the service-role
  // creds gate. With no creds set this returns NOT_WIRED_DATA_ACCESS, so every
  // method throws loudly (fail-closed). The credential + tenancy are bound
  // SERVER-side; `isPilot()` resolves to false in production (DR-037).
  const data = await resolveContentDataAccess();
  const deps: ReviewReleaseDeps = {
    ...DEFAULT_DEPS,
    data,
    isPilot: () => activationIsPilot(),
  };
  return handleReviewRelease(request, deps);
}
