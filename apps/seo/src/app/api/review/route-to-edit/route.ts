/**
 * POST /api/review/route-to-edit — route a client "Request changes" comment into
 * the PR 012 bounded agent edit loop (PR 019 / P1.C.2, lane client-review).
 *
 * THE OPERATOR-TRIAGE ROUTING. A client left a `request-changes` comment on the
 * tokenized review surface (PR 018). An OPERATOR (authenticated, no client token)
 * triages it: this route turns that comment into a BOUNDED `/api/edit` instruction
 * anchored to the commented region, RUNS the existing edit loop (which re-runs the
 * FULL @sagemark/core gate host-side — a client instruction can NEVER talk past a
 * YMYL/faithfulness veto), and on success updates the thread to "addressed in vN".
 *
 * IT DOES NOT FORK THE EDIT LOOP. It builds the same `/api/edit` request body and
 * calls the SAME `handleEdit` handler (the bounded-diff + stale guard + full-gate-
 * re-run + append-only versioning). The gate, the bound enforcement, the version
 * write — all the edit route's. This route only ADAPTS (comment → region +
 * instruction) and SEQUENCES (edit → resolve thread).
 *
 * FAIL-CLOSED / TENANT-SCOPED:
 *   1. AUTH → bind tenancy SERVER-side (operator session). A foreign client id is
 *      404; a request tenancy that disagrees with the bound context is 403.
 *   2. The comment is loaded scoped by the BOUND `clientId` (a cross-tenant comment
 *      id resolves to null → 404). It MUST be a `request-changes` comment.
 *   3. The comment is mapped to a bounded region+instruction. A comment with no
 *      section anchor and no operator-supplied region → 422 (operator must scope).
 *   4. `handleEdit` runs the bounded edit + the FULL gate re-run + the version
 *      write. ANY edit-route rejection (stale 409 / rate-limit 429 / bound 422 /
 *      non-draft 409 / gate-regressed verdict) is PASSED THROUGH unchanged — the
 *      routing never relaxes a guard.
 *   5. ONLY on a 200 edit does the thread resolve to "addressed in vN". A blocked
 *      edit leaves the thread OPEN (the change was not made).
 *
 * Handler exported as `handleRouteToEdit(request, deps)` for test injection. PII
 * rule: log only ids + version + verdict; never the comment body.
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
import { hashBody } from "@/lib/edit/constrained-edit-contract";
import {
  commentToInstruction,
  type TriageRegion,
} from "@/lib/review/comment-to-instruction";
import { handleEdit, type EditDeps } from "@/app/api/edit/route";
import { CONTENT_CONTRACT_VERSION } from "@/lib/content/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── The request body ──────────────────────────────────────────────────────────
// Tenancy is request-supplied (validated against the bound context, never trusted
// to widen). `commentId` names the `request-changes` thread to triage. The
// OPTIONAL `region` is the operator's explicit scope override (when the comment
// does not self-address a section). NO instruction here — it comes from the
// comment body (the routing maps it). NO baseVersionHash — the host computes it
// from the persisted latest version (the operator never supplies a hash).
const TriageRegionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), heading: z.string().min(1).max(300) }).strict(),
  z.object({ kind: z.literal("paragraph"), index: z.number().int().min(0).max(10_000) }).strict(),
  z
    .object({ kind: z.literal("span"), start: z.number().int().min(0), end: z.number().int().min(1) })
    .strict(),
]);

const BodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
    commentId: z.string().uuid(),
    region: TriageRegionSchema.optional(),
  })
  .strict();

// ── Dependency seam ───────────────────────────────────────────────────────────

export interface RouteToEditDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  /**
   * The edit handler to drive. Defaults to the real PR 012 `handleEdit`. Injected
   * in tests so the routing/sequencing is exercised without a live model — the
   * test passes an `editDeps` (with a stub EditModel) the default handler consumes.
   */
  runEdit: (request: Request, editDeps?: EditDeps) => Promise<Response>;
  /**
   * The EditDeps forwarded to `runEdit` (the data access + injected EditModel +
   * gate runner + rate limiter). In production this is the route's own default
   * deps; tests inject a deterministic EditModel + gate stub.
   */
  editDeps?: EditDeps;
}

const DEFAULT_DEPS: RouteToEditDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  runEdit: handleEdit,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * The injectable handler. Triages a `request-changes` comment into a bounded edit
 * + resolves the thread on success.
 */
export async function handleRouteToEdit(
  request: Request,
  deps: RouteToEditDeps = DEFAULT_DEPS,
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

  // 2. AUTH → bind tenancy SERVER-side (operator session). 401 / 404 / (below) 403.
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

  // 4. Load the comment scoped by the BOUND client (cross-tenant id → null → 404).
  const comment = await deps.data.loadCommentThread(body.commentId, ctx.clientId);
  if (!comment || comment.pieceId !== body.pieceId) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 5. Map the comment → a bounded region + instruction. A non-request-changes
  //    comment, an empty body, or a comment with no resolvable region (no section
  //    anchor and no operator override) is a 422 — nothing edited.
  const triageRegion = body.region as TriageRegion | undefined;
  const routed = commentToInstruction(
    { kind: comment.kind, body: comment.body, anchor: comment.anchor },
    triageRegion,
  );
  if (!routed.ok) {
    return json({ error: "comment not routable to a bounded edit", code: routed.reason }, 422);
  }

  // 6. Compute the base-version hash HOST-side from the persisted latest version
  //    (the operator never supplies a hash). No version yet → 409 (nothing to edit).
  const latest = await deps.data.loadLatestVersion(body.pieceId, ctx.clientId);
  if (!latest) {
    return json({ error: "piece has no version to edit", code: "no-version" }, 409);
  }
  const baseVersionHash = hashBody(latest.body);

  // 7. Drive the SAME PR 012 edit loop (bounded diff + full gate re-run + append-
  //    only version). We build the exact /api/edit body and call handleEdit; ANY
  //    rejection is passed through unchanged (we never relax a guard).
  const editRequest = new Request("http://localhost/api/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contractVersion: CONTENT_CONTRACT_VERSION,
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      pieceId: body.pieceId,
      region: routed.routed.region,
      instruction: routed.routed.instruction,
      baseVersionHash,
    }),
  });

  const editResponse = await deps.runEdit(editRequest, deps.editDeps);

  // A non-200 edit (stale / rate-limited / bound break / non-draft / model error)
  // is RETURNED AS-IS — the thread stays OPEN (the change was not applied). The
  // routing never converts a blocked edit into a resolved thread.
  if (editResponse.status !== 200) {
    return editResponse;
  }

  const editResult = (await editResponse.json()) as {
    version: number;
    verdict?: string | null;
  };

  // 8. ONLY on a successful edit, resolve the thread to "addressed in vN".
  await deps.data.resolveCommentThread({
    commentId: body.commentId,
    clientId: ctx.clientId,
    addressedInVersion: editResult.version,
  });

  console.log(
    `[api/review/route-to-edit] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} ` +
      `pieceId=${body.pieceId} commentId=${body.commentId} version=${editResult.version} ` +
      `verdict=${editResult.verdict ?? "null"}`,
  );

  return json(
    {
      pieceId: body.pieceId,
      commentId: body.commentId,
      version: editResult.version,
      verdict: editResult.verdict ?? null,
      threadStatus: "resolved",
      threadNote: `addressed in v${editResult.version} — see diff`,
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleRouteToEdit(request);
}
