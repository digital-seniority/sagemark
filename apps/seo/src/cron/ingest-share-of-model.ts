/**
 * SoM citation-INGESTION cron handler (PR 021 / P1.C.4, lane worker-runtime).
 * RFC engineering-rfc.md §728.
 *
 * WHAT IT DOES (when activated). For each (client, query, engine) in the funnel-
 * staged query bank: `adapter.probe` → `som-parse` (citation + confidence +
 * audit-sample flag) → PERSIST one `share_of_model` row through the data seam
 * `{client_id, piece_id?, engine, query (normalized), cited, position, raw_response,
 * parser_conf, audit_sampled, source_channel, locale, device_profile, captured_at}`,
 * tenancy-scoped (workspace_id + client_id BOUND, never request input). A degraded
 * engine logs a MISS + heartbeat — it never crashes the cron. Both crons emit a
 * heartbeat so a wedged cron alerts rather than stalling silently.
 *
 * INERT / FLAG-GATED (the hard constraint). The handler consults `somLiveEnabled()`
 * FIRST. With `SOM_LIVE` unset it SKIPS the whole run — it makes ZERO probe calls,
 * touches NO adapter, and persists NO row. Merging the cron schedule therefore
 * triggers nothing live (no cost). The Tier-1 test asserts: SOM_LIVE unset ⇒ a
 * probe-spy records zero calls.
 *
 * The persistence + the adapters are INJECTED (the seam is NOT_WIRED by default,
 * DR-026), so this module is importable + runnable in tests with fakes and is
 * inert in production until a human-reviewed wiring PR injects the live store +
 * the live (credentialed) adapters.
 *
 * Clean ASCII / UTF-8. No `console.*` — the handler RETURNS a structured report
 * (incl. heartbeats) the caller logs through the existing structured-log path.
 */

import type { ShareOfModelEngine } from "../lib/metrics/share-of-model";
import {
  somLiveEnabled,
  type SomAdapter,
  type SomProbeContext,
} from "../lib/metrics/som-adapters/types";
import { isAuditSampled, DEFAULT_AUDIT_SAMPLE_RATE } from "../lib/metrics/som-parse";
import { getQueryBank, type ClientQueryBank } from "../lib/metrics/query-bank";

/**
 * One fully-shaped `share_of_model` row the ingestion cron persists. Mirrors the
 * 0039 table columns (schema-flywheel `shareOfModel`). `workspaceId` + `clientId`
 * are the BOUND tenancy (never request input). `capturedAt` is set by the store
 * (DB default `now()`), so it is not on this write shape.
 */
export interface ShareOfModelRowWrite {
  workspaceId: string;
  clientId: string;
  pieceId: string | null;
  engine: ShareOfModelEngine;
  /** The NORMALIZED prompt actually sent (canonical phrasing). */
  query: string;
  cited: boolean;
  position: number | null;
  rawResponse: string | null;
  parserConf: number | null;
  auditSampled: boolean;
  sourceChannel: string;
  locale: string | null;
  deviceProfile: string | null;
}

/**
 * The ingestion persistence seam (DR-026: NOT_WIRED by default). The live impl is
 * a service-role client that writes ONE `share_of_model` row, every write scoped
 * by the BOUND workspace_id + client_id (service role bypasses RLS, so the app
 * filter IS the tenancy boundary). Tests inject an in-memory recorder.
 */
export interface ShareOfModelRowStore {
  persistRow(row: ShareOfModelRowWrite): Promise<void>;
}

/** Thrown when the ingestion store is reached without a wired live backend. */
export class ShareOfModelRowStoreNotWiredError extends Error {
  readonly code = "SOM_ROW_STORE_NOT_WIRED" as const;
  constructor() {
    super(
      "share_of_model row store is not wired: no live service-role backend in " +
        "this build (DR-026). Inject a ShareOfModelRowStore at activation.",
    );
    this.name = "ShareOfModelRowStoreNotWiredError";
  }
}

/** The fail-closed default store (inert) — throws loudly if ever reached live. */
export const NOT_WIRED_SOM_ROW_STORE: ShareOfModelRowStore = {
  persistRow: () => {
    throw new ShareOfModelRowStoreNotWiredError();
  },
};

/** A heartbeat the cron emits (the caller forwards it to the alerting path). */
export interface CronHeartbeat {
  cron: string;
  at: number;
  /** A short status note (e.g. "skipped: SOM_LIVE unset", "ok", "engine miss"). */
  note: string;
}

/** The structured result the ingestion handler returns (the caller logs it). */
export interface IngestResult {
  skipped: boolean;
  skipReason?: string;
  probes: number;
  persisted: number;
  deferred: number;
  misses: number;
  auditSampled: number;
  heartbeats: CronHeartbeat[];
}

/** One client to ingest: the BOUND tenancy + the query-bank key. */
export interface IngestTarget {
  workspaceId: string;
  clientId: string;
  /** The query-bank key (e.g. "whispering-willows"). */
  clientKey: string;
}

/** Injected deps (all default to fail-closed / process.env). */
export interface IngestDeps {
  adapters: SomAdapter[];
  store?: ShareOfModelRowStore;
  env?: NodeJS.ProcessEnv;
  /** Injected clock (ms) so the rate-limit window + heartbeats are deterministic. */
  now?: () => number;
  /** Audit sample rate (default 10%). */
  auditSampleRate?: number;
  /** Resolve a query bank by key (default = the registry). */
  resolveBank?: (clientKey: string) => ClientQueryBank | null;
}

const CRON_NAME = "ingest-share-of-model";

/**
 * Run the SoM ingestion cron over `targets`. INERT-FIRST: if `SOM_LIVE` is not
 * enabled the run is SKIPPED with zero probes (the merge-safe path). Otherwise, for
 * each (client, query, engine) it probes, parses, and persists a tenancy-scoped
 * `share_of_model` row; a deferred / missed engine is logged + heartbeated, never
 * fatal. Returns a structured report.
 */
export async function runShareOfModelIngest(
  targets: IngestTarget[],
  deps: IngestDeps,
): Promise<IngestResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const store = deps.store ?? NOT_WIRED_SOM_ROW_STORE;
  const auditSampleRate = deps.auditSampleRate ?? DEFAULT_AUDIT_SAMPLE_RATE;
  const resolveBank = deps.resolveBank ?? getQueryBank;
  const heartbeats: CronHeartbeat[] = [];

  // ── INERT GATE (hard constraint): SOM_LIVE unset ⇒ ZERO probes, zero rows. ──
  if (!somLiveEnabled(env)) {
    heartbeats.push({
      cron: CRON_NAME,
      at: now(),
      note: "skipped: SOM_LIVE unset or disabled (inert — no live probe, no cost)",
    });
    return {
      skipped: true,
      skipReason: "SOM_LIVE unset or disabled",
      probes: 0,
      persisted: 0,
      deferred: 0,
      misses: 0,
      auditSampled: 0,
      heartbeats,
    };
  }

  let probes = 0;
  let persisted = 0;
  let deferred = 0;
  let misses = 0;
  let auditSampledCount = 0;

  for (const target of targets) {
    const bank = resolveBank(target.clientKey);
    if (!bank) {
      heartbeats.push({
        cron: CRON_NAME,
        at: now(),
        note: `miss: no query bank for clientKey=${target.clientKey}`,
      });
      continue;
    }

    for (const entry of bank.entries) {
      const context: SomProbeContext = {
        locale: "en-US",
        deviceProfile: "desktop",
      };

      for (const adapter of adaptersForRun(deps.adapters)) {
        probes++;
        let outcome;
        try {
          outcome = await adapter.probe(
            { query: entry.text, citeTarget: bank.citeTarget, context },
            now(),
          );
        } catch (err) {
          // Defence-in-depth: an adapter that throws degrades to a MISS — the
          // cron never crashes (RFC §728).
          misses++;
          heartbeats.push({
            cron: CRON_NAME,
            at: now(),
            note: `miss: ${adapter.engine} threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          continue;
        }

        if (outcome.status === "deferred") {
          deferred++;
          heartbeats.push({
            cron: CRON_NAME,
            at: now(),
            note: `deferred: ${outcome.engine} (${outcome.reason})`,
          });
          continue;
        }
        if (outcome.status === "miss") {
          misses++;
          heartbeats.push({
            cron: CRON_NAME,
            at: now(),
            note: `miss: ${outcome.engine} (${outcome.reason})`,
          });
          continue;
        }

        // status === "ok" — persist a tenancy-scoped row through the seam.
        const r = outcome.result;
        const audit = isAuditSampled(entry.text, auditSampleRate);
        if (audit) auditSampledCount++;
        const row: ShareOfModelRowWrite = {
          // Tenancy: BOUND workspace + client (never request input).
          workspaceId: target.workspaceId,
          clientId: target.clientId,
          pieceId: null,
          engine: r.engine,
          query: entry.text,
          // A persisted row carries an explicit boolean — an unscored `cited`
          // (null) fails closed to NOT cited (we never fabricate a citation).
          cited: r.cited === true,
          position: r.position,
          rawResponse: r.rawResponse,
          parserConf: r.parserConf,
          auditSampled: audit,
          sourceChannel: r.sourceChannel,
          locale: r.locale,
          deviceProfile: r.deviceProfile,
        };
        try {
          await store.persistRow(row);
          persisted++;
        } catch (err) {
          // A persistence failure for ONE row is a logged miss — the cron
          // continues to the next probe (no silent stall, no crash).
          misses++;
          heartbeats.push({
            cron: CRON_NAME,
            at: now(),
            note: `miss: persist failed for ${r.engine}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      }
    }
  }

  heartbeats.push({
    cron: CRON_NAME,
    at: now(),
    note: `ok: probes=${probes} persisted=${persisted} deferred=${deferred} misses=${misses}`,
  });

  return {
    skipped: false,
    probes,
    persisted,
    deferred,
    misses,
    auditSampled: auditSampledCount,
    heartbeats,
  };
}

/** Defensive copy so a caller mutating the array mid-run cannot skew the loop. */
function adaptersForRun(adapters: SomAdapter[]): SomAdapter[] {
  return [...adapters];
}
