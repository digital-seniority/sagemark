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
import { somLiveEnabled } from "@/lib/metrics/som-adapters/types";
import { somDirectRunner } from "@sagemark/core";
import { makeLiveShareOfModelRowStore } from "@/lib/metrics/som-live-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The cron run-budget ceiling (seconds). When live, this cron probes N engines
 * across the funnel-staged query bank per (client, query, engine) and persists a
 * row each — the app's heaviest workload — so it takes the platform's default
 * function-timeout ceiling (300s) rather than the per-request route values.
 */
export const maxDuration = 300;

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

  // ACTIVATION (DR-026): inject the live DIRECT runner + the live share_of_model
  // store, BOTH gated. The direct runner routes every model call through the
  // metered Gateway (DR-013, forceGateway) and attaches the Claude web-search tool
  // for the direct-citation engine. The store is null unless service-role creds are
  // present. Crucially, even with both injected, the handler SKIPS the whole run
  // (zero probes, zero store calls) unless `SOM_LIVE` is set — so a merge with no
  // env triggers nothing live. We only attach the live runner when SOM_LIVE is on
  // (no point building the AI-SDK-backed adapters for a run that will skip).
  const live = somLiveEnabled(process.env);
  const adapters = live
    ? makeDefaultSomAdapters({ directRunner: somDirectRunner })
    : makeDefaultSomAdapters();
  const store = live ? (await makeLiveShareOfModelRowStore()) ?? undefined : undefined;

  // INERT: no targets resolved here (go-live injects tenancy-bound targets); the
  // handler also skips entirely when SOM_LIVE is unset.
  const targets: IngestTarget[] = [];
  const result = await runShareOfModelIngest(targets, { adapters, store });

  return NextResponse.json(result);
}
