/**
 * ImageGen — store seams (`imagegen/1`, Stage 1).
 *
 * Two `GeneratedImageStore` implementations that are NOT the live Supabase store
 * (that is Stage 2 — DR candidate, see the orchestrator header):
 *
 *  1. `makeInMemoryImageStore()` — a deterministic in-memory store for tests +
 *     the /api/run DRY-RUN mode. Dedups by (workspace, contentHash), records
 *     every generation row in-process. NO network, NO Supabase.
 *
 *  2. `makeNotWiredImageStore()` — a FAIL-CLOSED production store. Every method
 *     throws `StoreNotWiredError` so the live /api/run path fails LOUD (never
 *     silently no-ops) until the Stage-2 Supabase store lands. This is the
 *     "make the seam real but don't author the migration in this PR" guardrail.
 */

import type { Asset } from "./assets";
import type { GeneratedImageStore, GenerationRecord } from "./persist";

// ── Fail-closed NOT_WIRED store (Stage-1 production seam) ────────────

/** Thrown by the NOT_WIRED store — Stage-2 Supabase persistence is not wired. */
export class StoreNotWiredError extends Error {
  readonly code = "store-not-wired";
  readonly statusCode = 501;
  constructor(method: string) {
    super(
      `imagegen: the generated-image store is NOT WIRED (method "${method}"). ` +
        `Stage-1 ships the injected store seam only; the live Supabase store ` +
        `(generated_images table + bucket + RLS) is the Stage-2 follow-up. ` +
        `Use dry-run mode (in-memory store) until Stage 2 lands.`,
    );
    this.name = "StoreNotWiredError";
  }
}

/**
 * The fail-closed production store. Throws on every call so the live path can
 * never silently drop a generated image on the floor before Stage-2.
 */
export function makeNotWiredImageStore(): GeneratedImageStore {
  return {
    async upload() {
      throw new StoreNotWiredError("upload");
    },
    async findAssetByHash() {
      throw new StoreNotWiredError("findAssetByHash");
    },
    async insertAsset() {
      throw new StoreNotWiredError("insertAsset");
    },
    async insertGenerationRecord() {
      throw new StoreNotWiredError("insertGenerationRecord");
    },
  };
}

// ── In-memory store (tests + dry-run) ───────────────────────────────

export interface InMemoryImageStore extends GeneratedImageStore {
  /** All assets inserted, newest last. */
  readonly assets: ReadonlyArray<Asset>;
  /** All provenance records written, newest last. */
  readonly records: ReadonlyArray<GenerationRecord>;
  /** All uploads performed (bucket+key+size), newest last. */
  readonly uploads: ReadonlyArray<{
    bucket: string;
    key: string;
    size: number;
  }>;
}

/**
 * A deterministic in-memory store. Dedups by (workspaceId, contentHash). Asset
 * ids are stable + sequential so tests can assert on them.
 */
export function makeInMemoryImageStore(): InMemoryImageStore {
  const assets: Asset[] = [];
  const records: GenerationRecord[] = [];
  const uploads: Array<{ bucket: string; key: string; size: number }> = [];
  let seq = 0;

  const store: GeneratedImageStore = {
    async upload(args) {
      uploads.push({
        bucket: args.bucket,
        key: args.key,
        size: args.bytes.length,
      });
    },
    async findAssetByHash(args) {
      return (
        assets.find(
          (a) =>
            a.workspaceId === args.workspaceId &&
            a.contentHash === args.contentHash,
        ) ?? null
      );
    },
    async insertAsset(row) {
      const now = new Date(0).toISOString();
      const asset: Asset = {
        id: `asset-${++seq}`,
        workspaceId: row.workspaceId,
        kind: "image",
        source: row.source,
        storageKey: row.storageKey,
        externalUrl: null,
        license: row.license,
        contentHash: row.contentHash,
        bytes: row.bytes,
        metadata: null,
        tags: row.tags,
        createdAt: now,
        updatedAt: now,
      };
      assets.push(asset);
      return asset;
    },
    async insertGenerationRecord(record) {
      records.push(record);
    },
  };

  return Object.assign(store, {
    get assets() {
      return assets;
    },
    get records() {
      return records;
    },
    get uploads() {
      return uploads;
    },
  }) as InMemoryImageStore;
}

/**
 * A dry-run signUrl that returns a stable fake URL for a storage key (no live
 * storage). Used by /api/run dry-run mode + tests.
 */
export function makeDryRunSignUrl(): (args: {
  key: string;
  workspaceId: string;
}) => Promise<string> {
  return async ({ key }) => `dryrun://signed/${key}`;
}
