/**
 * Content data-access composition (DR-026 activation, creds-gated + safe-default).
 *
 * THE DI SEAM the kernel routes resolve at activation. The live READ adapter
 * (`makeLiveContentReadAccess`) and live WRITE adapter (`makeLiveContentWriteAccess`)
 * are already built + INERT on `preview`; this helper is the thin composition that
 * returns either the LIVE `ContentDataAccess` (when service-role creds are present)
 * or the existing fail-closed `NOT_WIRED_DATA_ACCESS` default (unchanged behavior).
 *
 * SAFE DEFAULT (the hard rule): with NO env set, both factories return null, so
 * `resolveContentDataAccess()` returns `NOT_WIRED_DATA_ACCESS` — every route
 * behaves EXACTLY as today (fail-closed). A merge changes nothing live.
 *
 * COMPOSITION + FAIL-CLOSED REMAINDER. The live adapters cover the read + write
 * surface, plus the live image-resolver (`resolveReferencedAssets`, C.021.2). The
 * deferred-migration methods (`nameVersion` / `setActiveVersion`) the live write
 * adapter intentionally leaves NOT_WIRED (the schema lane owns those columns) — so
 * any method NOT supplied by a live adapter falls back to the fail-closed
 * `NOT_WIRED_DATA_ACCESS` stub. The composition NEVER fabricates a method.
 *
 * TENANCY PRESERVED. The live adapters already enforce the bound `workspace_id`/
 * `client_id` on every query (service-role bypasses RLS — the app filter is the
 * boundary). This helper changes nothing about that: it only swaps the impl; the
 * routes still pass the BOUND `ctx`, never request input.
 *
 * `server-only`: composing the live adapter touches the service-role creds.
 * Importing this module is network-free + cred-free (the adapters import
 * `@supabase/supabase-js` dynamically and return null without creds).
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import {
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
  type ReadOnlyDataAccess,
} from "./context";
import {
  makeLiveContentReadAccess,
  makeLiveContentWriteAccess,
  type ContentReadAccess,
  type ContentWriteAccess,
} from "./live-data-access";
import { makeLiveResolveReferencedAssets } from "./image-resolver";

/**
 * Resolve the full `ContentDataAccess` for the kernel routes (brief/draft/audit/
 * publish), creds-gated + safe-default.
 *
 *   - service-role creds PRESENT  → the LIVE adapter: read methods from the live
 *     READ adapter, write methods from the live WRITE adapter, the live
 *     `resolveReferencedAssets` (image-resolver), and the deferred-migration
 *     methods left on their fail-closed NOT_WIRED stubs.
 *   - creds ABSENT                → `NOT_WIRED_DATA_ACCESS` UNCHANGED (today's
 *     fail-closed default — every method throws loudly).
 *
 * The function is async because building the live adapters dynamically imports the
 * Supabase client (network-free import; a real connection only on first query).
 */
export async function resolveContentDataAccess(): Promise<ContentDataAccess> {
  const read: ContentReadAccess | null = await makeLiveContentReadAccess();
  // No service-role creds → leave the seam on its fail-closed default (unchanged).
  if (!read) return NOT_WIRED_DATA_ACCESS;

  const write: ContentWriteAccess | null = await makeLiveContentWriteAccess();
  // Defence-in-depth: the read adapter resolved (creds present) so the write
  // adapter resolves too; if it somehow did not, stay fully fail-closed rather
  // than expose a read-only-but-claims-writable surface.
  if (!write) return NOT_WIRED_DATA_ACCESS;

  const resolveReferencedAssets = await makeLiveResolveReferencedAssets();

  // Compose: live read + live write + live image-resolver. Any method NOT supplied
  // by a live adapter (the deferred-migration nameVersion/setActiveVersion) falls
  // through to the fail-closed NOT_WIRED stub — never fabricated.
  return {
    ...NOT_WIRED_DATA_ACCESS,
    ...read,
    ...write,
    ...(resolveReferencedAssets ? { resolveReferencedAssets } : {}),
  };
}

/**
 * Resolve the READ-ONLY view the audit route is given (structurally cannot
 * mutate — it is a `Pick<>` of three read methods only). Creds-gated + safe-
 * default: the LIVE read adapter's three methods when creds are present, else the
 * fail-closed default's three (which throw loudly). The audit route can never
 * mutate through this view (no write method is exposed at the type level).
 */
export async function resolveReadOnlyDataAccess(): Promise<ReadOnlyDataAccess> {
  const read = await makeLiveContentReadAccess();
  if (!read) {
    return {
      clientBelongsToWorkspace: NOT_WIRED_DATA_ACCESS.clientBelongsToWorkspace,
      getApprovedVoiceSpec: NOT_WIRED_DATA_ACCESS.getApprovedVoiceSpec,
      loadPiece: NOT_WIRED_DATA_ACCESS.loadPiece,
    };
  }
  return {
    clientBelongsToWorkspace: read.clientBelongsToWorkspace,
    getApprovedVoiceSpec: read.getApprovedVoiceSpec,
    loadPiece: read.loadPiece,
  };
}
