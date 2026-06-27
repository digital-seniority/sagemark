/**
 * Freshness-scan cron handler (PR 021 / P1.C.4, lane worker-runtime).
 * RFC engineering-rfc.md §728 + §1 non-goals (NO auto-publish).
 *
 * WHAT IT DOES (when activated). Scans a client's PUBLISHED pieces and, for each
 * one whose last-updated age exceeds the staleness threshold, emits a refresh
 * DRAFT — NEVER an auto-publish. A refreshed draft re-enters the gate + the human-
 * release path like any other piece (per §1 non-goals). The handler emits a
 * heartbeat so a wedged cron alerts rather than stalling silently.
 *
 * NO-AUTO-PUBLISH (load-bearing). The handler's ONLY mutation is `emitDraft`; it
 * has NO publish seam at all (a publish is structurally impossible here — there is
 * no method to call). The Tier-1 test asserts: the draft sink fires, and the
 * (separately spied) publish path is NEVER touched.
 *
 * INERT / FLAG-GATED. Like the ingest cron, the handler consults `somLiveEnabled()`
 * (the same SOM_LIVE flag gates BOTH crons per the spec) and SKIPS the whole run
 * when unset — zero scans, zero drafts. Merging the schedule triggers nothing live.
 *
 * The published-piece reader + the draft sink are INJECTED (NOT_WIRED by default,
 * DR-026), so this module is importable + testable with fakes and inert in
 * production until a human-reviewed wiring PR injects the live reader + draft sink.
 *
 * Clean ASCII / UTF-8. No `console.*` — returns a structured report incl. heartbeats.
 */

import { somLiveEnabled } from "../lib/metrics/som-adapters/types";
import type { CronHeartbeat } from "./ingest-share-of-model";

/** The default staleness threshold: a published piece older than 180 days. */
export const DEFAULT_STALENESS_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A published piece the freshness scan considers (the minimal staleness shape). */
export interface PublishedPieceForFreshness {
  pieceId: string;
  slug: string;
  /** Last-updated timestamp (ISO) — the staleness clock. Null ⇒ treated as stale. */
  updatedAt: string | null;
}

/** A refresh-draft request the cron emits (NEVER a publish). */
export interface RefreshDraftRequest {
  workspaceId: string;
  clientId: string;
  pieceId: string;
  /** Why the refresh was triggered (audit trail). */
  reason: string;
}

/**
 * The freshness seams (DR-026: NOT_WIRED by default). `listPublished` reads the
 * client's published pieces (tenancy-scoped, BOUND workspace + client). `emitDraft`
 * creates a refresh DRAFT — the ONLY mutation; there is deliberately NO publish
 * method (no auto-publish is structurally possible).
 */
export interface FreshnessSeams {
  listPublished(
    workspaceId: string,
    clientId: string,
  ): Promise<PublishedPieceForFreshness[]>;
  emitDraft(req: RefreshDraftRequest): Promise<void>;
}

/** Thrown when a freshness seam is reached without a wired live backend. */
export class FreshnessSeamsNotWiredError extends Error {
  readonly code = "FRESHNESS_SEAMS_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `freshness seam '${op}' is not wired: no live service-role backend in this ` +
        "build (DR-026). Inject FreshnessSeams at activation.",
    );
    this.name = "FreshnessSeamsNotWiredError";
  }
}

/** The fail-closed default seams (inert) — throw loudly if ever reached live. */
export const NOT_WIRED_FRESHNESS_SEAMS: FreshnessSeams = {
  listPublished: () => {
    throw new FreshnessSeamsNotWiredError("listPublished");
  },
  emitDraft: () => {
    throw new FreshnessSeamsNotWiredError("emitDraft");
  },
};

/** One client to scan: the BOUND tenancy. */
export interface FreshnessTarget {
  workspaceId: string;
  clientId: string;
}

/** Injected deps (default to fail-closed / process.env / wall clock). */
export interface FreshnessDeps {
  seams?: FreshnessSeams;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Staleness threshold in days (default 180). */
  stalenessDays?: number;
}

/** The structured result the freshness handler returns. */
export interface FreshnessResult {
  skipped: boolean;
  skipReason?: string;
  scanned: number;
  /** Refresh DRAFTS emitted (never publishes). */
  draftsEmitted: number;
  errors: number;
  heartbeats: CronHeartbeat[];
}

const CRON_NAME = "freshness-scan";

/**
 * Is a published piece stale at `now`? True iff its `updatedAt` is older than
 * `stalenessDays`, OR `updatedAt` is missing/unparseable (a piece with no known
 * update time is treated as stale → a conservative refresh draft, never a publish).
 */
export function isStale(
  piece: PublishedPieceForFreshness,
  now: number,
  stalenessDays: number,
): boolean {
  if (!piece.updatedAt) return true;
  const t = Date.parse(piece.updatedAt);
  if (Number.isNaN(t)) return true;
  return now - t > stalenessDays * MS_PER_DAY;
}

/**
 * Run the freshness cron over `targets`. INERT-FIRST: `SOM_LIVE` unset ⇒ the run is
 * SKIPPED (zero scans, zero drafts). Otherwise, for each stale published piece it
 * emits a refresh DRAFT (never a publish — there is no publish seam) and continues
 * past a per-piece error (logged, never fatal). Returns a structured report.
 */
export async function runFreshnessScan(
  targets: FreshnessTarget[],
  deps: FreshnessDeps = {},
): Promise<FreshnessResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const seams = deps.seams ?? NOT_WIRED_FRESHNESS_SEAMS;
  const stalenessDays = deps.stalenessDays ?? DEFAULT_STALENESS_DAYS;
  const heartbeats: CronHeartbeat[] = [];

  // ── INERT GATE: SOM_LIVE unset ⇒ zero scans, zero drafts. ──
  if (!somLiveEnabled(env)) {
    heartbeats.push({
      cron: CRON_NAME,
      at: now(),
      note: "skipped: SOM_LIVE unset or disabled (inert — no scan, no draft)",
    });
    return {
      skipped: true,
      skipReason: "SOM_LIVE unset or disabled",
      scanned: 0,
      draftsEmitted: 0,
      errors: 0,
      heartbeats,
    };
  }

  let scanned = 0;
  let draftsEmitted = 0;
  let errors = 0;

  for (const target of targets) {
    let published: PublishedPieceForFreshness[];
    try {
      published = await seams.listPublished(target.workspaceId, target.clientId);
    } catch (err) {
      errors++;
      heartbeats.push({
        cron: CRON_NAME,
        at: now(),
        note: `error: listPublished failed for client=${target.clientId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    for (const piece of published) {
      scanned++;
      if (!isStale(piece, now(), stalenessDays)) continue;
      try {
        // The ONLY mutation: a refresh DRAFT (re-enters the gate + human release).
        await seams.emitDraft({
          workspaceId: target.workspaceId,
          clientId: target.clientId,
          pieceId: piece.pieceId,
          reason: `stale > ${stalenessDays}d (last updated ${piece.updatedAt ?? "unknown"})`,
        });
        draftsEmitted++;
      } catch (err) {
        errors++;
        heartbeats.push({
          cron: CRON_NAME,
          at: now(),
          note: `error: emitDraft failed for piece=${piece.pieceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  heartbeats.push({
    cron: CRON_NAME,
    at: now(),
    note: `ok: scanned=${scanned} draftsEmitted=${draftsEmitted} errors=${errors}`,
  });

  return { skipped: false, scanned, draftsEmitted, errors, heartbeats };
}
