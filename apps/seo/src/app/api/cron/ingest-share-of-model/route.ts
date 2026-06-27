/**
 * GET /api/cron/ingest-share-of-model — the Vercel-cron entrypoint for the SoM
 * citation-ingestion cron (PR 021 / P1.C.4). Scheduled in `apps/seo/vercel.json`.
 *
 * INERT / FLAG-GATED (the hard constraint). This route is a THIN wrapper over the
 * gated handler `runShareOfModelIngest`. It is inert by construction:
 *   - the handler SKIPS the whole run when `SOM_LIVE` is unset (zero probes), and
 *   - the adapters default to their fail-closed channel seams + the persistence
 *     store defaults to `NOT_WIRED_SOM_ROW_STORE`, and
 *   - this route resolves NO ingest targets (the live target-resolution — which
 *     binds workspace/client tenancy — is injected by the separate human-reviewed
 *     ACTIVATION PR).
 * So merging this route + the cron schedule triggers ZERO live calls and ZERO cost.
 *
 * AUTH. Vercel sets the `Authorization: Bearer $CRON_SECRET` header on cron
 * invocations; when `CRON_SECRET` is configured a mismatch is rejected 401. (With
 * no secret configured the route still runs inert — it can do nothing live.)
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { makeDefaultSomAdapters } from "@/lib/metrics/som-adapters";
import {
  runShareOfModelIngest,
  type IngestTarget,
} from "@/cron/ingest-share-of-model";

/** Reject a cron call whose Bearer token does not match a configured CRON_SECRET. */
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
  // targets); the handler additionally skips entirely when SOM_LIVE is unset.
  const targets: IngestTarget[] = [];
  const result = await runShareOfModelIngest(targets, {
    adapters: makeDefaultSomAdapters(),
  });

  return NextResponse.json(result);
}
