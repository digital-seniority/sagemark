/**
 * POST /api/review/comments — persist a pinned comment or a section verb left on
 * the tokenized client-review surface (PR 018 / P1.C.1, lane client-review).
 *
 * FAIL-CLOSED, TOKEN-SCOPED. The request carries the OPAQUE review token (never a
 * client_id/version/workspace_id — those are NEVER trusted from the body). The
 * route:
 *
 *   1. Resolves the token to its ONE `(workspaceId, clientId, pieceId, version)`
 *      tuple via `resolveReviewToken` (a DB lookup, fail-closed). An
 *      unknown/expired/revoked token → 404 (no existence oracle). This is the
 *      same row-scoped boundary the page uses — the token can never widen tenancy.
 *   2. Validates the verb (`kind` ∈ pin | section-approve | request-changes) and,
 *      for a `pin`, the anchor (finite, normalized 0..1 coords + elementHint).
 *      Junk coords / a `pin` with no anchor → 400, NOTHING persisted.
 *   3. Persists ONE `comment_threads` row scoped by the RESOLVED tuple's
 *      `workspaceId`/`clientId`/`pieceId`/`version` — never request input. The
 *      `version` column records the version the comment was left on
 *      (version_left_on).
 *
 * A section Approve/Request-changes persists a row with the correct `kind`; it is
 * RECORDED but does NOT itself release a YMYL piece (that stays the separate
 * fail-closed `canPublish` path — PR 009). No publish/transition happens here.
 *
 * IFRAME MESSAGE VALIDATION: the origin/source/finite-coord checks on the iframe
 * `postMessage` happen client-side in `useIframePinDrop` (strict origin allowlist
 * + source-window check + type check + finite coords). This route is the SERVER
 * half: it re-validates the anchor coords (never trusts the client), and binds
 * tenancy from the token, not the message.
 *
 * Handler exported as `handleReviewComment(request, deps)` for test injection.
 * PII rule: log only ids + kind. No `body` content logged.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  resolveReviewToken,
  validatePinAnchor,
  NOT_WIRED_REVIEW_TOKEN_ACCESS,
  NOT_WIRED_REVIEW_COMMENT_ACCESS,
  type ReviewTokenDataAccess,
  type ReviewCommentDataAccess,
  type PinAnchor,
} from "@/lib/review/resolve-token";
import { COMMENT_THREAD_KINDS } from "@sagemark/schema-flywheel";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Injected seams (tests pass fixtures; production uses the fail-closed stubs). */
export interface ReviewCommentDeps {
  tokens: ReviewTokenDataAccess;
  comments: ReviewCommentDataAccess;
}

const DEFAULT_DEPS: ReviewCommentDeps = {
  tokens: NOT_WIRED_REVIEW_TOKEN_ACCESS,
  comments: NOT_WIRED_REVIEW_COMMENT_ACCESS,
};

// The request body. NOTE: NO workspace_id / client_id / version / piece_id — the
// tuple comes from the resolved token ONLY. `anchor` is optional (required for a
// `pin`; absent/null for a section verb). Coords are re-validated server-side.
const BodySchema = z.object({
  token: z.string().min(1),
  kind: z.enum(COMMENT_THREAD_KINDS),
  anchor: z
    .object({
      x: z.number(),
      y: z.number(),
      elementHint: z.string().optional(),
    })
    .nullish(),
  body: z.string().max(10_000).optional(),
  author: z.string().min(1).max(256),
});

/**
 * The injectable handler. Resolves the token → tuple, validates the verb/anchor,
 * and persists one scoped `comment_threads` row. Returns the new comment id +
 * the recorded kind; never echoes the resolved tuple back (no scope leak).
 */
export async function handleReviewComment(
  request: Request,
  deps: ReviewCommentDeps = DEFAULT_DEPS,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const { token, kind, author } = parsed.data;
  const body = parsed.data.body ?? "";

  // 1. Resolve the token → ONE tuple (fail-closed). Unknown/expired/revoked → 404.
  const resolved = await resolveReviewToken(token, deps.tokens);
  if (!resolved.ok) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const { scope } = resolved;

  // 2. Validate the anchor. A `pin` MUST be element-anchored with finite,
  //    normalized coords; a section verb carries no anchor. Junk coords on a pin
  //    → 400, nothing persisted. (The iframe message was origin/source/finite-
  //    validated client-side; this re-validates server-side — never trust input.)
  let anchor: PinAnchor | null = null;
  if (kind === "pin") {
    const validated = parsed.data.anchor
      ? validatePinAnchor(parsed.data.anchor)
      : null;
    if (!validated) {
      return NextResponse.json(
        { error: "invalid-anchor" },
        { status: 400 },
      );
    }
    anchor = validated;
  } else if (parsed.data.anchor) {
    // A section verb MAY carry an anchor (which section it was left on); validate
    // it if present, but do not require it. Invalid coords are dropped (null),
    // never persisted as junk.
    anchor = validatePinAnchor(parsed.data.anchor);
  }

  // 3. Persist — scoped by the RESOLVED tuple, never request input. `version`
  //    records the version the comment was left on (version_left_on).
  const { id } = await deps.comments.insertComment({
    workspaceId: scope.workspaceId,
    clientId: scope.clientId,
    pieceId: scope.pieceId,
    version: scope.version,
    kind,
    anchor,
    body,
    author,
  });

  // A section approve/request-changes is RECORDED; it never releases the piece.
  return NextResponse.json({ id, kind }, { status: 201 });
}

export async function POST(request: Request): Promise<Response> {
  return handleReviewComment(request);
}
