/**
 * Live SoM persistence store (DR-026 activation, service-role, gated).
 *
 * THE GAP THIS CLOSES. The SoM ingestion cron persists each probe through a
 * `ShareOfModelRowStore` whose production default is `NOT_WIRED_SOM_ROW_STORE`
 * (throws). This module is the live service-role-backed store the ACTIVATION PR
 * injects, gated on the SAME service-role creds the content adapters use.
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS. Every `share_of_model` INSERT carries the
 * BOUND `workspace_id` + `client_id` (from the cron target's tenancy, never request
 * input — service-role bypasses RLS, so the app filter IS the boundary). The
 * per-engine `source_channel` label (Claude=direct-citation, ChatGPT/Gemini=
 * direct-proxy) is persisted VERBATIM so a proxy is never summed as a real citation.
 *
 * SAFE DEFAULT. The factory returns null when service-role creds are absent, so the
 * cron stays on `NOT_WIRED_SOM_ROW_STORE` — and the cron ALSO skips entirely unless
 * `SOM_LIVE` is set. A merge changes nothing live.
 *
 * FRESHNESS SEAMS — DEFERRED. The freshness cron's `FreshnessSeams.emitDraft` must
 * re-open a piece into `draft` (a status transition keyed by the internal piece
 * UUID), but the live PUBLIC read adapter's `PublishedPiece` projection does NOT
 * expose the internal `content_pieces.id` (only the public slug). Fabricating a
 * piece id from the slug would silently mis-target the transition, so the live
 * freshness seams are NOT wired here — the cron stays on its fail-closed
 * `NOT_WIRED_FRESHNESS_SEAMS` default (and skips unless `SOM_LIVE` anyway). Wiring
 * freshness live awaits a read-adapter widening that surfaces the piece id on the
 * published projection; the seam contract is unchanged.
 *
 * `server-only`. `@supabase/supabase-js` is imported dynamically, so importing this
 * module is network-free + cred-free.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import { readReadAdapterCreds } from "@/lib/content/live-data-access";
import type {
  ShareOfModelRowStore,
  ShareOfModelRowWrite,
} from "@/cron/ingest-share-of-model";

// ── Minimal service-role write surface for the share_of_model insert ───────────

interface SomInsertResult {
  error: unknown;
}
interface SomWriterSupabase {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<SomInsertResult>;
  };
}

function stringifyErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Build the live `ShareOfModelRowStore` from a service-role client — or null when
 * the host creds are absent (→ the cron keeps `NOT_WIRED_SOM_ROW_STORE`). Every
 * INSERT writes the BOUND tenancy columns VERBATIM from the cron-built row (the
 * cron copied them from the tenancy-bound target, never request input). Fail-loud
 * on a write error so the cron logs a per-row miss (it never silently drops).
 *
 * INERT: only the activation-wired cron uses it, and that cron skips unless
 * `SOM_LIVE` is set.
 */
export async function makeLiveShareOfModelRowStore(): Promise<ShareOfModelRowStore | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SomWriterSupabase;

  return {
    async persistRow(row: ShareOfModelRowWrite): Promise<void> {
      const { error } = await supabase.from("share_of_model").insert({
        workspace_id: row.workspaceId, // BOUND tenancy.
        client_id: row.clientId, // BOUND tenancy.
        piece_id: row.pieceId,
        engine: row.engine,
        query: row.query,
        cited: row.cited,
        position: row.position,
        raw_response: row.rawResponse,
        parser_conf: row.parserConf,
        audit_sampled: row.auditSampled,
        source_channel: row.sourceChannel,
        locale: row.locale,
        device_profile: row.deviceProfile,
        // captured_at OMITTED — the DB default now() applies.
      });
      if (error) {
        throw new Error(
          `som-live-store: persistRow failed for client=${row.clientId} engine=${row.engine}: ${stringifyErr(error)}`,
        );
      }
    },
  };
}
