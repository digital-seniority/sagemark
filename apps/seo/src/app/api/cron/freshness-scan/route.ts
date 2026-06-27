/**
 * GET /api/cron/freshness-scan — the Vercel-cron entrypoint for the freshness
 * cron (PR 021 / P1.C.4). Scheduled in `apps/seo/vercel.json`.
 *
 * INERT / FLAG-GATED. A THIN wrapper over the gated handler `runFreshnessScan`:
 *   - the handler SKIPS the whole run when `SOM_LIVE` is unset (zero scans), and
 *   - the freshness seams default to `NOT_WIRED_FRESHNESS_SEAMS`, and
 *   - this route resolves NO targets (the live tenancy-bound target resolution +
 *     the draft sink are injected by the separate human-reviewed ACTIVATION PR).
 * NO-AUTO-PUBLISH is structural: the handler's only mutation is `emitDraft` (a
 * refresh DRAFT that re-enters the gate + human-release path); there is no publish
 * seam anywhere in this path.
 *
 * AUTH. Same `Authorization: Bearer $CRON_SECRET` check as the ingest route.
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { runFreshnessScan, type FreshnessTarget } from "@/cron/freshness-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The cron run-budget ceiling (seconds). When live, this cron scans a client's
 * published pieces and emits refresh DRAFTS — lighter than the ingest cron but
 * still per-piece work, so it gets a generous budget above the per-request route
 * values while staying well under the platform ceiling.
 */
export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return true; // no secret set ⇒ route is inert anyway
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // INERT: no targets resolved here (the activation PR injects tenancy-bound
  // targets + the live draft sink); the handler skips entirely when SOM_LIVE unset.
  const targets: FreshnessTarget[] = [];
  const result = await runFreshnessScan(targets);

  return NextResponse.json(result);
}
