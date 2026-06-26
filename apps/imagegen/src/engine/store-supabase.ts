/**
 * ImageGen — Supabase-backed `GeneratedImageStore` (live wiring, Stage 2).
 *
 * PORTED from flywheel-main `packages/videogen/imagegen/store-supabase.ts`
 * (`makeSupabaseImageStore` + `makeSupabaseSignUrl`) and ADAPTED for the SEO
 * Creator: the tables are `generated_images` (the asset rows) + `image_generations`
 * (the audit log) — see migration drizzle/0035 — and the bucket is
 * `seo-generated-images`. The store implements the Stage-1 `GeneratedImageStore`
 * contract (apps/imagegen/src/engine/persist.ts) so `persistGeneratedImage`
 * drives it unchanged.
 *
 * `makeSupabaseImageStore(supabase)` returns the concrete store the /api/run live
 * path passes to `generateHeroImage`. Tests inject a purely in-memory fake (no
 * network, no spend).
 *
 * Tenancy: every read/write carries `workspace_id`, so workspace isolation is
 * applied at the application level on TOP of the fail-closed RLS (0035: RLS
 * enabled, no anon policy; service-role bypasses RLS). `generated_images`
 * uniquely indexes (workspace_id, content_hash) — `findAssetByHash` exploits it
 * for dedup; `insertAsset` relies on it as a backstop.
 *
 * `image_generations` is the audit log. The row is written EVEN ON DEDUP
 * (`asset_id` → the existing asset) so every inference call is counted toward
 * cost + provenance regardless of whether new bytes were stored.
 *
 * Pass the SERVICE-ROLE client (the API route holds one) so storage uploads and
 * DB writes share the same auth context and bypass RLS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Asset, GeneratedAssetLicense } from "./assets";
import type { GeneratedImageStore, GenerationRecord } from "./persist";
import { GENERATED_IMAGE_BUCKET } from "./persist";

// ---------------------------------------------------------------------------
// Row → Asset mapping
// ---------------------------------------------------------------------------

/** Derive a content type from a storage key extension (mirror of persist's extFor). */
function contentTypeFromKey(key: string): string {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.jpe?g$/i.test(key)) return "image/jpeg";
  if (/\.webp$/i.test(key)) return "image/webp";
  return "image/png";
}

/** Pull the model id out of the `model:<id>` tag the persist path writes. */
function modelFromTags(tags: string[]): string {
  const t = tags.find((x) => x.startsWith("model:"));
  return t ? t.slice("model:".length) : "unknown";
}

/** Map a `generated_images` DB row to the public `Asset` DTO persist returns. */
function rowToAsset(row: Record<string, unknown>): Asset {
  const createdAt = (row.created_at as string | null) ?? new Date(0).toISOString();
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: "image",
    source: "generated",
    storageKey: (row.storage_key as string | null) ?? null,
    externalUrl: null,
    license: (row.license as GeneratedAssetLicense | null) ?? null,
    contentHash: (row.content_hash as string | null) ?? null,
    bytes: (row.bytes as number | null) ?? null,
    metadata: (row.provenance as Record<string, unknown> | null) ?? null,
    tags: [
      "generated",
      `model:${row.model ?? "unknown"}`,
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

// ---------------------------------------------------------------------------
// Live store factory
// ---------------------------------------------------------------------------

/**
 * Create a `GeneratedImageStore` backed by the supplied Supabase client. Pass
 * the service-role client so storage uploads + DB writes bypass RLS and share
 * one auth context.
 */
export function makeSupabaseImageStore(
  supabase: SupabaseClient,
): GeneratedImageStore {
  return {
    async upload({ bucket, key, bytes, contentType }) {
      const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
        contentType,
        upsert: false,
      });
      if (error) {
        throw new Error(
          `imagegen store: storage upload failed for ${bucket}/${key}: ${error.message}`,
        );
      }
    },

    async findAssetByHash({ workspaceId, contentHash }) {
      const { data, error } = await supabase
        .from("generated_images")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (error) {
        throw new Error(`imagegen store: dedup lookup failed: ${error.message}`);
      }
      return data ? rowToAsset(data as Record<string, unknown>) : null;
    },

    async insertAsset({ workspaceId, storageKey, contentHash, bytes, license, tags }) {
      // client_id / model_version / prompt_hash / seed / provenance are not part
      // of the insertAsset contract (they arrive at insertGenerationRecord time
      // and are recorded in image_generations) → left null here (0035 nullable).
      const row = {
        workspace_id: workspaceId,
        content_hash: contentHash,
        bucket: GENERATED_IMAGE_BUCKET,
        storage_key: storageKey,
        bytes,
        content_type: contentTypeFromKey(storageKey),
        model: modelFromTags(tags),
        license: license as GeneratedAssetLicense,
      };
      const { data, error } = await supabase
        .from("generated_images")
        .insert(row)
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(
          `imagegen store: asset insert failed: ${error?.message ?? "no data returned"}`,
        );
      }
      return rowToAsset(data as Record<string, unknown>);
    },

    async insertGenerationRecord(record: GenerationRecord) {
      // The audit log subset. Always written — even on dedup — so every
      // inference is accounted (asset_id → the kept/existing asset).
      const row = {
        workspace_id: record.workspaceId,
        client_id: record.clientId,
        asset_id: record.assetId ?? null,
        model: record.modelId,
        cost_reported: record.costReported ?? null,
        status: record.status,
      };
      const { error } = await supabase.from("image_generations").insert(row);
      if (error) {
        throw new Error(
          `imagegen store: generation record insert failed: ${error.message}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// signUrl helper (the live `HeroImageDeps.signUrl` impl)
// ---------------------------------------------------------------------------

/** Signed-read-URL TTL: 24h (matches the videogen bucket ceiling). */
const SIGNED_URL_TTL_SECONDS = 86_400;

/**
 * Build the `signUrl` function `generateHeroImage` needs, backed by Supabase
 * Storage. Mints a fresh short-lived signed URL for a private-bucket key.
 */
export function makeSupabaseSignUrl(
  supabase: SupabaseClient,
): (args: { key: string; workspaceId: string }) => Promise<string> {
  return async ({ key }) => {
    const { data, error } = await supabase.storage
      .from(GENERATED_IMAGE_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(
        `imagegen store: createSignedUrl failed for ${GENERATED_IMAGE_BUCKET}/${key}: ${
          error?.message ?? "no URL returned"
        }`,
      );
    }
    return data.signedUrl;
  };
}
