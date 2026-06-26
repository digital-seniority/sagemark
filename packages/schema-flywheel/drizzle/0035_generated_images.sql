-- 0035_generated_images.sql — ImageGen Stage-2 persistence (@sagemark/imagegen).
-- Two NEW tables backing the generated-image store: `generated_images` (the
-- durable asset rows) + `image_generations` (the per-inference audit log, written
-- even on dedup so every spend is accounted). Plus a PRIVATE storage bucket
-- `seo-generated-images` for the bytes.
--
-- This migration is ADDITIVE-ONLY and idempotent (`IF NOT EXISTS` / `ON CONFLICT
-- DO NOTHING`). It MUST NOT alter or drop any existing table, column, constraint,
-- index, policy, or bucket. It follows the exact style of 0033_content_clients_rls
-- and 0032_release_records.
--
-- RLS — FAIL-CLOSED, mirrors the 0032/0033 "ENABLE ROW LEVEL SECURITY; no anon
-- policy" pattern. Generated images are INTERNAL/PRIVATE: anon reaches ZERO rows
-- on both tables. They only ever become public when their bytes are referenced
-- inside a PUBLISHED content_piece, which the content-hub render route already
-- gates (0030 anon policy is published-content_pieces ONLY). The only access
-- paths here are service-role (the operator / imagegen pipeline), which bypasses
-- RLS. There are no authenticated non-service tenant users, so no tenant-read
-- policy is needed.
--
-- STORAGE BUCKET — `seo-generated-images`, PRIVATE (public=false). Created here
-- via `insert into storage.buckets ... on conflict do nothing`. NO anon storage
-- policy is created (service-role only; reads go through short-lived signed URLs
-- minted by makeSupabaseSignUrl). NEEDS-INPUT: if `storage.buckets` is not
-- writable in the apply context (e.g. a restricted CI role), create the bucket
-- out-of-band via the Supabase dashboard / MCP — id+name `seo-generated-images`,
-- public OFF — before the imagegen live path is enabled. The bucket insert is
-- idempotent and harmless to re-run.
--
-- Source-of-truth Drizzle definitions: src/content.ts (generatedImages +
-- imageGenerations). Companion contract test: apps/seo/test/tenancy/
-- rls-contract.test.ts (Tier-1 shape + Tier-2 anon→zero-rows for both tables).
--
-- ROLLBACK (down) — additive, so the down is:
--   ALTER TABLE public.image_generations DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.generated_images   DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.image_generations;
--   DROP TABLE IF EXISTS public.generated_images;
-- (The `seo-generated-images` bucket is left in place; remove it manually if a
-- full teardown is required.)

-- The asset rows: durable generated-image records. Dedup is by
-- (workspace_id, content_hash) — the UNIQUE index findAssetByHash exploits and
-- insertAsset relies on as a backstop.
--
-- COLUMN NULLABILITY follows the Stage-1 `GeneratedImageStore.insertAsset`
-- contract (apps/imagegen/src/engine/persist.ts), which is the source of truth
-- and OUT OF SCOPE to change in Stage 2. insertAsset supplies only
-- {workspaceId, source, storageKey, contentHash, bytes, license, tags}. So:
--   * workspace_id, content_hash, bucket, storage_key, bytes, license — always
--     present at insertAsset → NOT NULL.
--   * content_type, model — DERIVED at insert (content_type from the key
--     extension; model from the `model:<id>` tag) → NOT NULL.
--   * client_id, model_version, prompt_hash, seed, provenance — NOT supplied to
--     insertAsset (they arrive at insertGenerationRecord time and are recorded
--     authoritatively in image_generations) → NULLABLE here. DR candidate: if a
--     future stage wants these NOT NULL on the asset row, widen the insertAsset
--     contract first.
CREATE TABLE IF NOT EXISTS public.generated_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid,                                       -- nullable: not supplied to insertAsset (see header)
  content_hash  text NOT NULL,                              -- sha256 hex of the bytes (dedup key)
  bucket        text NOT NULL,                              -- storage bucket id (seo-generated-images)
  storage_key   text NOT NULL,                              -- key within the bucket
  bytes         integer NOT NULL,                           -- byte length of the stored object
  content_type  text NOT NULL,                              -- image/png | image/jpeg | image/webp (derived from key)
  model         text NOT NULL,                              -- pinned gateway model id (derived from the model:<id> tag)
  model_version text,                                       -- pinned model version (nullable)
  prompt_hash   text,                                       -- nullable: not supplied to insertAsset (see header)
  seed          bigint,                                     -- generation seed, if returned (nullable)
  license       jsonb NOT NULL,                             -- AI-generated provenance/license blob (Never-list #8)
  provenance    jsonb,                                      -- SynthID/C2PA/revised-prompt lineage flags (nullable)
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Dedup: one stored asset per (workspace, content-hash). Mirrors the reference's
-- (workspace_id, content_hash) unique index.
CREATE UNIQUE INDEX IF NOT EXISTS generated_images_ws_hash_unique
  ON public.generated_images (workspace_id, content_hash);
CREATE INDEX IF NOT EXISTS generated_images_client_idx
  ON public.generated_images (client_id);
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;  -- no anon policy (fail-closed; private until referenced in published content)

-- The audit log: one row per inference call. Written EVEN ON DEDUP (asset_id →
-- the existing asset) so every generation is counted toward cost + provenance
-- regardless of whether new bytes were stored.
CREATE TABLE IF NOT EXISTS public.image_generations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL,
  asset_id      uuid REFERENCES public.generated_images(id) ON DELETE SET NULL,  -- written even on dedup; nullable for rejected/failed
  model         text NOT NULL,
  cost_reported numeric,                                    -- provider-reported cost (nullable)
  status        text NOT NULL,                              -- succeeded | rejected | failed
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_generations_ws_idx
  ON public.image_generations (workspace_id);
CREATE INDEX IF NOT EXISTS image_generations_asset_idx
  ON public.image_generations (asset_id);
ALTER TABLE public.image_generations ENABLE ROW LEVEL SECURITY;  -- no anon policy (fail-closed)

-- PRIVATE storage bucket for the generated bytes. public=false → no public CDN
-- URL; reads only via service-role signed URLs. Idempotent. NO anon storage
-- policy is created (service-role only). See the NEEDS-INPUT note in the header
-- if storage.buckets is not writable in the apply context.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('seo-generated-images', 'seo-generated-images', false)
  ON CONFLICT (id) DO NOTHING;
