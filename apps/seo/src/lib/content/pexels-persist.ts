/**
 * Pexels stock-image fetch + `generated_images` persistence (Slice 7 / DR-033).
 *
 * RESPONSIBILITY. This module is the single place that:
 *   1. Searches Pexels for a landscape photo matching the per-page query.
 *   2. Downloads the photo bytes (follows the Pexels CDN URL).
 *   3. Uploads to the `seo-generated-images` Supabase Storage bucket.
 *   4. Inserts a `generated_images` row tagged `model="pexels/stock"` + the
 *      recorded Pexels license blob (so `toHeroAssetLicense` marks it licensed).
 *
 * CREDS GATE — returns null (no-op) unless BOTH:
 *   - `PEXELS_API_KEY` is set (host-only; NEVER in `ALLOWED_ENV_KEYS`)
 *   - Supabase service-role creds are set (`SUPABASE_URL` + key)
 *
 * FAIL-CLOSED. Every failure (no Pexels result, download failure, upload failure,
 * insert conflict) is non-fatal: we log and return without throwing. The caller
 * treats a missing image as a render degradation (the `[photo:slug]` token resolves
 * to no asset → the SSR render strips the placeholder). A failed image NEVER blocks
 * the worker response.
 *
 * DEDUP. We skip the search+upload if a `generated_images` row already exists for
 * `(workspace_id, slug)` to avoid redundant Pexels downloads on re-runs.
 *
 * SECURITY.
 * - `PEXELS_API_KEY` stays HOST-ONLY — read here at activation, never echoed.
 * - `SUPABASE_SERVICE_ROLE_KEY` stays HOST-ONLY (same rule as the live adapters).
 * - The Supabase client is created fresh per activation (import is dynamic;
 *   importing this module is network-free + cred-free until `makePexelsImagePersist`
 *   is called).
 * - The storage_key is `{workspaceId}/{slug}` — workspace-scoped (cross-workspace
 *   keys never collide, service-role bypasses bucket RLS so the tenancy boundary
 *   is the explicit `workspace_id` column, not bucket policy).
 *
 * `server-only` because it reads `PEXELS_API_KEY` + service-role creds at
 * activation time. Clean ASCII / UTF-8.
 */

import "server-only";

import { makeDefaultPexelsSearch, makePexelsLicense } from "../tools/hero-image";

const BUCKET = "seo-generated-images" as const;

/**
 * The per-page image-persist hook wired into `/content/api/images`. When the
 * route receives a `requestImages` call from the worker, it invokes this function
 * with the tenancy + query metadata. The function is best-effort: errors are
 * swallowed and logged; a missing result degrades the render.
 */
export type PexelsImagePersist = (opts: {
  workspaceId: string;
  clientId: string;
  slug: string;
  query: string;
  alt: string;
}) => Promise<void>;

/** Read the Supabase service-role creds (same logic as the live read adapter). */
function readCreds(): { url: string; serviceRoleKey: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

/** Derive a MIME content-type from a Pexels CDN URL extension. */
function mimeFromUrl(url: string): string {
  const noQuery = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
  const dotIdx = noQuery.lastIndexOf(".");
  const ext = dotIdx >= 0 ? noQuery.slice(dotIdx + 1).toLowerCase() : "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg"; // Pexels default is JPEG
}

/**
 * Build the live Pexels-persist function, or `null` when the required creds are
 * absent. Callers in the images route spread the result into the `enqueueImageFetch`
 * dep slot; a null return leaves the route on its no-op stub (Slice 6 behavior).
 *
 * `fetchImpl` is injectable for tests (no live network in unit tests).
 */
export async function makePexelsImagePersist(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PexelsImagePersist | null> {
  const pexelsKey = process.env.PEXELS_API_KEY?.trim();
  if (!pexelsKey) return null; // no key → no-op (host-only, never in worker env)

  const creds = readCreds();
  if (!creds) return null; // no service-role creds → no-op

  const pexelsSearch = makeDefaultPexelsSearch(fetchImpl);

  return async ({ workspaceId, clientId, slug, query, alt: _alt }) => {
    try {
      // 1. Check for an existing row first (dedup: re-runs are idempotent).
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(creds.url, creds.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: existing } = await supabase
        .from("generated_images")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("slug", slug)
        .maybeSingle();

      if (existing) {
        console.log(`[pexels-persist] skip (row exists) ws=${workspaceId} slug=${slug}`);
        return;
      }

      // 2. Search Pexels.
      const photo = await pexelsSearch(query);
      if (!photo) {
        console.warn(`[pexels-persist] no result for query="${query.slice(0, 60)}" slug=${slug}`);
        return;
      }

      // 3. Download photo bytes.
      const imageUrl =
        photo.src.large2x ?? photo.src.large ?? photo.src.original;
      if (!imageUrl) {
        console.warn(`[pexels-persist] photo has no usable src url slug=${slug}`);
        return;
      }
      const imgRes = await fetchImpl(imageUrl);
      if (!imgRes.ok) {
        console.warn(
          `[pexels-persist] download failed slug=${slug} status=${imgRes.status}`,
        );
        return;
      }
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const rawCt = imgRes.headers.get("content-type") ?? "";
      const semiIdx = rawCt.indexOf(";");
      const contentType = rawCt.includes("/")
        ? (semiIdx >= 0 ? rawCt.slice(0, semiIdx).trim() : rawCt.trim())
        : mimeFromUrl(imageUrl);

      // 4. Content hash (dedup key for the unique index on (workspace_id, content_hash)).
      const { createHash } = await import("node:crypto");
      const contentHash = createHash("sha256").update(buffer).digest("hex");

      // 5. Upload to the generated-images bucket.
      const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const storageKey = `${workspaceId}/${slug}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storageKey, buffer, { contentType, upsert: true });

      if (uploadErr) {
        console.error("[pexels-persist] bucket upload failed", {
          workspaceId,
          slug,
          error: uploadErr,
        });
        return; // fail-closed: skip insert if upload failed
      }

      // 6. Insert the generated_images row.
      const license = makePexelsLicense(photo);
      const { error: insertErr } = await supabase
        .from("generated_images")
        .insert({
          workspace_id: workspaceId,
          client_id: clientId,
          slug,
          content_hash: contentHash,
          bucket: BUCKET,
          storage_key: storageKey,
          bytes: buffer.byteLength,
          content_type: contentType,
          model: "pexels/stock",
          license: JSON.stringify(license),
        });

      if (insertErr) {
        // The most likely cause is a race on (workspace_id, content_hash) or slug:
        // another request persisted the same image concurrently. Safe to ignore.
        console.error("[pexels-persist] insert failed (likely race)", {
          workspaceId,
          slug,
          error: insertErr,
        });
        return;
      }

      console.log(
        `[pexels-persist] ok slug=${slug} ws=${workspaceId} bytes=${buffer.byteLength} key=${storageKey}`,
      );
    } catch (err) {
      // Catch-all: never propagate to the caller (best-effort, fail-closed).
      console.error("[pexels-persist] unexpected error", {
        workspaceId,
        slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
