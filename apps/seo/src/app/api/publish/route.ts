/**
 * POST /api/publish — the STUDIO (operator-console) publish endpoint (PR 009).
 *
 * THE FAIL-CLOSED PUBLISH MOAT, operator-facing. This is the surface the studio
 * operator clicks "publish" through. It does NOT fork the publish gate: it drives
 * the SAME `@sagemark/core` FSM (`assertTransition` → `canPublish`) and the SAME
 * centralized release/byline resolution as the worker-facing kernel route, by
 * delegating to the shared `handlePublish` core handler.
 *
 * WHAT IS ENFORCED HERE (all HOST-SIDE, all from PERSISTED state — never request
 * input):
 *   1. Global publish flag on (default OFF — fail-safe).
 *   2. verdict === PUBLISH (persisted on the row).
 *   3. The eval actually ran — bound to the persisted `gate_results.eval_ran` row
 *      (A.011.7), never inferred from verdict/eval_score.
 *   4. A recorded human release — a `credentialed_release` read from the
 *      `credentialed_releases` table; a `client_signoff` can NEVER satisfy it
 *      (it resolves to NO_HUMAN_RELEASE). Source of truth: `read-credentialed-release`.
 *   5. That release's `authorization_id` resolves to an ACTIVE
 *      `byline_authorizations` row — a revoked / expired / inactive / dangling
 *      authorization is a fail-closed block (`authorization-active`).
 *   6. (YMYL) a named author + credentials + citations — the byline is resolved
 *      SERVER-side from the release's credential snapshot + the persisted
 *      `author_id`; `request.author` is never trusted (`resolve-author`).
 *
 * A `PUBLISH` verdict alone leaves the piece at `draft`/`approved` — there is NO
 * autopilot; only a recorded credentialed release advances it. Any blocked clause
 * returns a stable FSM reason (422), never prose.
 *
 * The handler is `handleStudioPublish(request, deps)` for test injection; it reuses
 * the exact `handlePublish` gate so the operator path can never diverge from the
 * worker path.
 */

import "server-only";

import {
  handlePublish,
  type PublishDeps,
} from "@/app/content/api/publish/route";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The studio publish handler. Operator-console calls carry NO bearer token, so the
 * shared `handlePublish` binds tenancy via the operator-session path
 * (`resolveWorkspace` → `clientBelongsToWorkspace`). The gate, the release read,
 * the authorization-active check, and the server-side byline resolution are all
 * the shared core's — this route only routes.
 */
export async function handleStudioPublish(
  request: Request,
  deps?: PublishDeps,
): Promise<Response> {
  return handlePublish(request, deps);
}

export async function POST(request: Request): Promise<Response> {
  return handleStudioPublish(request);
}
