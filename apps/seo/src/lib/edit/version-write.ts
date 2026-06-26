/**
 * version-write — append-only `content_piece_versions` writes for the bounded
 * conversational edit (PR 012 / P1.U.3).
 *
 * APPEND-ONLY VERSIONING. Every accepted edit writes a NEW `content_piece_versions`
 * row and NEVER mutates a prior one. The current body of a piece is the body of
 * its HIGHEST-version row; an edit:
 *
 *   1. reads the current (highest) version through the data-access seam;
 *   2. verifies the client's `baseVersionHash` matches `hashBody(currentBody)` —
 *      the SHA-256 stale-edit guard (a no-lost-update check; the route 409s on a
 *      mismatch BEFORE any model call or write);
 *   3. applies the bounded diff to the current body (the splice — bounded, not a
 *      free rewrite);
 *   4. re-runs the FULL gate on the edited body (done by the route — see
 *      `/api/edit`); then
 *   5. appends a NEW row at `currentVersion + 1` carrying the edited body + the
 *      re-computed verdict/dimensions.
 *
 * The append is the ONLY write this module performs, and it goes through
 * `insertPieceVersion` — the schema's `(piece_id, version)` unique index is the
 * structural guard that a prior version is never overwritten (a duplicate version
 * throws). The verdict written is the gate's verdict for THIS edited body — an
 * edit that regressed the gate persists its regressed (non-publishable) verdict,
 * so the edit can never quietly bank a stale PUBLISH.
 *
 * PURE-ish: the stale check + next-version computation are deterministic; the
 * write is delegated to the injected seam. No Next APIs, no LLM, no `server-only`
 * marker (unit-tested in plain Node with a spy seam). Clean ASCII / UTF-8.
 */

import type { Verdict } from "@sagemark/core";
import type {
  ContentDataAccess,
  PersistedPieceVersion,
} from "@/lib/content/context";
import { hashBody } from "./constrained-edit-contract";

// ── Stale-edit guard (SHA-256, no lost update) ────────────────────────────────

/** The result of the stale-edit base-hash check. */
export type StaleCheck =
  | { ok: true; current: PersistedPieceVersion; currentHash: string }
  | { ok: false; reason: "no-version" | "stale"; currentHash: string | null };

/**
 * Load the current (highest) version and verify the client's `baseVersionHash`
 * matches it. PURE over the seam read:
 *
 *   - `no-version` — the piece has no version snapshot yet (nothing to edit; the
 *     route surfaces a 409/404-class error rather than fabricating a base).
 *   - `stale`      — the client edited against an older body (its hash != the
 *     current body's hash). The route 409s — a no-lost-update guard: the operator
 *     must re-base on the current version before retrying.
 *   - `ok`         — the hashes match; the edit is based on the current truth.
 *
 * The comparison hashes the PERSISTED current body with the SAME `hashBody` the
 * client used, so it is exact. Tenancy is already bound by the caller; this read
 * is scoped by the BOUND `clientId`.
 */
export async function checkBaseVersionHash(
  data: Pick<ContentDataAccess, "loadLatestVersion">,
  pieceId: string,
  clientId: string,
  baseVersionHash: string,
): Promise<StaleCheck> {
  const current = await data.loadLatestVersion(pieceId, clientId);
  if (!current) {
    return { ok: false, reason: "no-version", currentHash: null };
  }
  const currentHash = hashBody(current.body);
  if (currentHash !== baseVersionHash) {
    return { ok: false, reason: "stale", currentHash };
  }
  return { ok: true, current, currentHash };
}

// ── Append-only version write ─────────────────────────────────────────────────

/** The arguments for appending a new edited version. */
export interface AppendVersionArgs {
  pieceId: string;
  clientId: string;
  /** The version this edit was based on (the current highest version). */
  baseVersion: number;
  /** The edited body (after the bounded splice). */
  body: string;
  /** The verdict the FULL gate re-computed for THIS edited body. */
  verdict: Verdict | null;
  /** The Stage-B dimensions for this version (null when a Stage-A veto suppressed scoring). */
  dimensions: unknown | null;
}

/**
 * Append a NEW `content_piece_versions` row at `baseVersion + 1`. NEVER mutates a
 * prior version — the only write is the `insertPieceVersion` append, guarded by
 * the schema's `(piece_id, version)` unique index. Returns the new row id +
 * version. The caller has already (a) bound tenancy, (b) passed the stale guard,
 * (c) applied the bounded diff, and (d) re-run the full gate.
 */
export async function appendEditedVersion(
  data: Pick<ContentDataAccess, "insertPieceVersion">,
  args: AppendVersionArgs,
): Promise<{ id: string; version: number }> {
  const nextVersion = args.baseVersion + 1;
  return data.insertPieceVersion({
    pieceId: args.pieceId,
    clientId: args.clientId,
    version: nextVersion,
    body: args.body,
    verdict: args.verdict,
    dimensions: args.dimensions,
  });
}
