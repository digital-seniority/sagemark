-- 0037_generated_image_slug.sql — slug asset-linkage for generated images
-- (C.021.2, DR-035). Adds the `slug` column the publish/homepage image-resolver
-- joins on: a piece body's `[photo:slug]` token resolves to the
-- `generated_images` row whose (workspace_id, slug) matches. Before this column
-- the slug reached the persist seam but had no column to land in, so a
-- `[photo:slug]` token could never resolve and an image-bearing piece stayed
-- fail-closed-unpublishable (the safe but blocking prior state — DR-035).
--
-- ADDITIVE-ONLY + idempotent (`IF NOT EXISTS`). Touches ONLY the `public`
-- schema. MUST NOT alter or drop any existing table, column, constraint, index,
-- or policy. Follows the exact style of 0035_generated_images /
-- 0036_comment_threads.
--
-- COLUMN NULLABILITY: `slug` is NULLABLE. The Stage-1
-- `GeneratedImageStore.insertAsset` contract did not historically carry slug;
-- pre-existing rows (and any rejected/failed generation that never reached
-- insertAsset) have no slug. A NULL slug simply never matches a
-- `[photo:slug]` token → that token resolves to NO row → the publish gate
-- treats it as an ORPHAN and BLOCKS (fail-closed). So a missing slug is safe by
-- construction; it is never fabricated.
--
-- MIGRATION-ROLE NOTE (migration-runs-on-live-pooled-role): this migration
-- writes ONLY the `public` schema and uses ONLY `ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. It declares NO event trigger, NO
-- SET ROLE, NO GRANT, NO ALTER OWNER, NO `storage.*` DDL/DML, and depends on NO
-- superuser-only construct. The live POOLED migration role can execute every
-- statement below. (The pre-existing `rls_auto_enable()` event trigger — DR-015
-- — does not re-fire on ADD COLUMN; RLS on generated_images is already enabled
-- by 0035 and is untouched here.)
--
-- Source-of-truth Drizzle definition: src/content.ts (generatedImages.slug +
-- the generated_images_workspace_slug_idx index). Companion adapter test:
-- apps/seo/test/render/image-resolver.test.ts (Tier-1 adapter tenancy + license
-- gating) and apps/seo/test/tenancy/rls-contract.test.ts (Tier-1 SQL-shape over
-- 0037 + Tier-2 live-Postgres tenancy + license gating).
--
-- ROLLBACK (down) — additive, so the down is:
--   DROP INDEX IF EXISTS public.generated_images_workspace_slug_idx;
--   ALTER TABLE public.generated_images DROP COLUMN IF EXISTS slug;
-- Reverting the column makes every `[photo:slug]` token unresolvable again,
-- which returns the publish gate to its safe fail-closed-blocks-image-bodies
-- prior state — never fail-open.

-- The slug a generated image was produced for (the page slug / brief id). Joins
-- back to the `[photo:slug]` body token the publish gate + homepage resolve.
-- Nullable: not all rows carry one (see header).
ALTER TABLE public.generated_images
  ADD COLUMN IF NOT EXISTS slug text;

-- The resolver lookup key: (workspace_id, slug). Every image-resolver query is
-- workspace-scoped (service-role bypasses RLS, so the explicit workspace_id
-- filter is the tenancy boundary) AND slug-matched. This index serves
-- `WHERE workspace_id = $1 AND slug = ANY($2)`.
CREATE INDEX IF NOT EXISTS generated_images_workspace_slug_idx
  ON public.generated_images (workspace_id, slug);
