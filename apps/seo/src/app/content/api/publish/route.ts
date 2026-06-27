/**
 * POST /content/api/publish — host-enforced `canPublish()` + FSM transition.
 * Contract: `content-engine/1.0` (PR 005, lane engine-port).
 *
 * THE LOAD-BEARING GATE. The transition into `published` is decided HOST-SIDE by
 * `@sagemark/core`'s `assertTransition` (which consults `canPublish`), never by
 * the caller. All preconditions are read from the PERSISTED row + release
 * records (never request input):
 *   1. global publish flag on (default OFF — fail-safe);
 *   2. verdict === PUBLISH (persisted);
 *   3. the eval actually ran (a scorecard is persisted);
 *   4. a recorded human release exists — a `credentialed_release`, NEVER a
 *      `client_signoff` (a signoff resolves to NO_HUMAN_RELEASE);
 *   5. that release's `authorization_id` resolves to an ACTIVE byline
 *      authorization (not revoked / expired) — an inactive authorization is a
 *      fail-closed block;
 *   6. (YMYL) a named author + credentials + citations.
 *
 * Any blocked clause throws `IllegalTransitionError` -> 422 with a stable reason
 * (never prose). The handler is `handlePublish(request, deps)` for injection.
 *
 * PII rule: log only ids + action + outcome.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  assertTransition,
  IllegalTransitionError,
  type ReleaseAuthor,
  type TransitionContext,
  type LifecycleState,
} from "@sagemark/core";
import {
  PublishRequestSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
  parseReferencedPhotoSlugs,
  toReferencedImages,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
  type ContentPieceRow,
  type ReferencedImageDecision,
} from "@/lib/content/context";
import { readCredentialedRelease } from "@/lib/release/read-credentialed-release";
import { resolveBylineAuthor } from "@/lib/byline/resolve-author";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import { publishEnabled as activationPublishEnabled } from "@/lib/activation";

export const runtime = "nodejs";
export const maxDuration = 30;

export interface PublishDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  /** Global publish kill switch (default reads CONTENT_PUBLISH_ENABLED). */
  publishEnabled: () => boolean;
  /** Bridge-JWT signing secret override (default: host env). Test-injectable. */
  jwtSecret?: string;
  /** Bridge-JWT clock override (epoch ms) for deterministic expiry tests. */
  bridgeNowMs?: () => number;
}

function defaultPublishEnabled(): boolean {
  return process.env.CONTENT_PUBLISH_ENABLED === "1";
}

const DEFAULT_DEPS: PublishDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  publishEnabled: defaultPublishEnabled,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Resolve the `[photo:slug]` references a publishing body carries to the core
 * FSM's `ReferencedImage` decision rows (DR-033), FAIL-CLOSED:
 *   - A body with NO `[photo:]` token references no image → [] (gate passes).
 *   - A body WITH tokens but NO `resolveReferencedAssets` seam method available
 *     → every token is treated as UNRESOLVED (orphan) → the gate BLOCKS
 *     (UNLICENSED_ASSET). We never fail OPEN: if we can't prove the assets are
 *     licensed, we refuse the publish.
 *   - Otherwise each token resolves to `licensed` iff its asset row carries a
 *     non-null license, scoped to the bound client.
 */
async function resolveReferencedImages(
  body: string,
  clientId: string,
  data: ContentDataAccess,
): Promise<ReferencedImageDecision[]> {
  const slugs = parseReferencedPhotoSlugs(body);
  if (slugs.length === 0) return [];
  if (!data.resolveReferencedAssets) {
    // Fail-closed: tokens present but no resolver → all orphaned (block).
    return slugs.map((slug) => ({ slug, resolved: false, licensed: false }));
  }
  const assets = await data.resolveReferencedAssets(clientId, slugs);
  return toReferencedImages(slugs, assets);
}

export async function handlePublish(
  request: Request,
  deps: PublishDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = PublishRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  const flagOn = deps.publishEnabled();
  // A publish attempt with the global flag off is refused up front (fail-safe).
  if (body.action === "publish" && !flagOn) {
    return json({ error: "publishing is disabled", code: "publish-disabled" }, 403);
  }

  // 2. Authenticate + bind tenancy SERVER-side (criterion 7). A worker call
  //    carrying a Bearer per-run JWT is authenticated by the TOKEN (DR-018); an
  //    operator-console call (no bearer) uses the unchanged session path.
  const bound = await authenticateBridgeRequest(
    request,
    body.clientId,
    deps.data,
    deps.resolveWorkspace,
    { secret: deps.jwtSecret, nowMs: deps.bridgeNowMs?.() },
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. REJECT a request-supplied tenancy mismatch (403).
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. Load the persisted piece (scoped by client).
  const piece = await deps.data.loadPiece(body.pieceId, ctx.clientId);
  if (!piece) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 5. Build the transition. Publish goes piece.status -> published; unpublish
  //    goes published -> review|archived.
  const from = piece.status as LifecycleState;
  const to: LifecycleState = body.action === "publish" ? "published" : (body.to ?? "review");

  // For publish, assemble the FSM context from PERSISTED state only.
  if (body.action === "publish") {
    const release = await deps.data.getRelease(body.pieceId, ctx.clientId, piece.version);
    // Resolve the release (centralized): a client_signoff is passed through (the
    // FSM rejects it NO_HUMAN_RELEASE); a credentialed_release is honored ONLY if
    // its authorization is ACTIVE (§11.5 fail-closed). DR-013/extracted module.
    const humanRelease = await readCredentialedRelease(
      release,
      ctx.clientId,
      deps.data,
      new Date(),
    );
    // Byline author resolved SERVER-side from the (authorization-checked) release's
    // credential snapshot + the PERSISTED author_id — NEVER from request input.
    const author: ReleaseAuthor | null = resolveBylineAuthor(
      humanRelease,
      piece.authorId,
    );

    // A.011.7: bind evalRan to the PERSISTED gate_results.eval_ran row, not the
    // loose `evalScore != null || verdict != null` heuristic (a Stage-A veto sets
    // a verdict with no eval_score → the heuristic would mis-read evalRan=true).
    const gate = await deps.data.getGateResult(body.pieceId, ctx.clientId, piece.version);
    // DR-033: resolve the body's `[photo:]` references to licensed asset records
    // (fail-closed) so canPublish blocks an orphaned/unlicensed image publish.
    const referencedImages = await resolveReferencedImages(
      piece.body,
      ctx.clientId,
      deps.data,
    );
    const transitionCtx: TransitionContext = {
      verdict: piece.verdict,
      evalRan: gate?.evalRan === true,
      humanRelease,
      isYmyl: piece.isYmyl,
      author,
      // YMYL citation presence is read from the persisted brief snapshot
      // (graded sources present == citations available).
      hasCitations: (piece.briefSnapshot?.sources?.length ?? 0) > 0,
      referencedImages,
      publishEnabled: flagOn,
    };

    try {
      assertTransition(from, to, transitionCtx);
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        console.log(
          `[content/publish] blocked workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${body.pieceId} from=${err.from} to=${err.to} reason=${err.rejection}`,
        );
        return json(
          { error: "transition blocked", code: "transition-blocked", reason: err.rejection },
          422,
        );
      }
      throw err;
    }
  } else {
    // Unpublish: a structurally-legal revert (published -> review|archived). The
    // FSM does not gate reversible moves on evalRan; bind it from the persisted
    // gate_results row anyway (A.011.7) rather than the loose verdict heuristic.
    const gate = await deps.data.getGateResult(body.pieceId, ctx.clientId, piece.version);
    const transitionCtx: TransitionContext = {
      verdict: piece.verdict,
      evalRan: gate?.evalRan === true,
      isYmyl: piece.isYmyl,
      publishEnabled: flagOn,
    };
    try {
      assertTransition(from, to, transitionCtx);
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return json(
          { error: "transition blocked", code: "transition-blocked", reason: err.rejection },
          422,
        );
      }
      throw err;
    }
  }

  // 6. The transition is permitted — apply the status mutation (the ONLY write).
  try {
    await deps.data.transitionPieceStatus(body.pieceId, ctx.clientId, to);
  } catch (err) {
    console.error("[content/publish] status write failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "internal error", code: "internal" }, 500);
  }

  console.log(
    `[content/publish] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${body.pieceId} action=${body.action} status=${to}`,
  );

  return json(
    { contractVersion: CONTENT_CONTRACT_VERSION, pieceId: body.pieceId, status: to },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  // ACTIVATION (DR-026): resolve the full LIVE ContentDataAccess BEHIND the
  // service-role creds gate. The composed live adapter carries the read methods,
  // the write methods (incl. transitionPieceStatus), AND the live
  // `resolveReferencedAssets` image-resolver (C.021.2/DR-035) — superseding the
  // earlier resolver-only wiring. With no creds set this returns
  // NOT_WIRED_DATA_ACCESS, so every method throws loudly (today's fail-closed
  // default — a `[photo:]` body has no resolver → orphan → UNLICENSED_ASSET block).
  const data = await resolveContentDataAccess();
  // publishEnabled DEFAULT OFF (DR-037 + activation): only true when an explicit
  // PUBLISH_ENABLED flag is set AND service-role creds are present. This is the
  // global kill switch; canPublish + the DR-037 placeholder guard + the A.005.1
  // active-authorization predicate remain the authoritative barriers (unweakened).
  const deps: PublishDeps = {
    ...DEFAULT_DEPS,
    data,
    publishEnabled: () => activationPublishEnabled(),
  };
  return handlePublish(request, deps);
}

/** Re-exported so a future caller could narrow on the persisted-piece shape. */
export type { ContentPieceRow };
