-- 0030_content_pieces.sql — SEO Creator content store (additive-only).
-- Ported from flywheel-main origin/preview
-- packages/schema-flywheel/drizzle/0030_content_pieces.sql with one addition:
-- the `review_comments` table (per-version reviewer annotations) the SEO
-- Creator RLS contract requires anon to read zero rows from. MUST NOT alter or
-- drop any existing table. Clean UTF-8 only.
--
-- Source-of-truth Drizzle definitions: `src/content.ts`.
-- Companion contract test: `apps/seo/test/tenancy/rls-contract.test.ts`.
--
-- Content identity is kept SEPARATE from any accounting `clients` table: a
-- `content_clients` tenant root is created and content/voice FKs point at it
-- ON DELETE RESTRICT (a client with content cannot be silently deleted).
--
-- Idempotent: enum creation is guarded (DO $$ / pg_type), every CREATE uses
-- IF NOT EXISTS, and the one policy is dropped-then-created.

-- Enums (additive; guarded so re-runs are safe) ----------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_status') THEN
    CREATE TYPE public.content_status AS ENUM (
      'draft', 'review', 'approved', 'published', 'archived'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_verdict') THEN
    CREATE TYPE public.content_verdict AS ENUM (
      'PUBLISH', 'REVIEW', 'REVISE', 'REJECT'
    );
  END IF;
END$$;

-- Tenant root (separate content identity) ----------------------------------
CREATE TABLE IF NOT EXISTS public.content_clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  blog_slug    text NOT NULL,
  workspace_id uuid NOT NULL,                  -- owning workspace (the workspace_id->client_id bridge)
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_clients_blog_slug_unique UNIQUE (blog_slug)
);
CREATE INDEX IF NOT EXISTS content_clients_workspace_idx ON public.content_clients (workspace_id);

-- Content pieces ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_pieces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  slug             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  excerpt          text,
  meta_description text,
  status           content_status NOT NULL DEFAULT 'draft',
  version          integer NOT NULL DEFAULT 1,
  is_ymyl          boolean NOT NULL DEFAULT false,
  author_id        uuid,
  eval_score       integer,
  verdict          content_verdict,
  dimensions       jsonb,
  faq_data         jsonb,
  brief_snapshot   jsonb,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_pieces_client_slug_unique UNIQUE (client_id, slug)
);
CREATE INDEX IF NOT EXISTS content_pieces_client_status_idx       ON public.content_pieces (client_id, status);
CREATE INDEX IF NOT EXISTS content_pieces_client_published_at_idx ON public.content_pieces (client_id, published_at);

-- Immutable version snapshots (client_id denormalized for a future RLS path) -
CREATE TABLE IF NOT EXISTS public.content_piece_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id    uuid NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL,                      -- denormalized for RLS
  version     integer NOT NULL,
  body        text NOT NULL,
  dimensions  jsonb,
  verdict     content_verdict,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_piece_versions_piece_version_unique UNIQUE (piece_id, version)
);
CREATE INDEX IF NOT EXISTS content_piece_versions_client_idx ON public.content_piece_versions (client_id);

-- Voice specs (a row with approved_at IS NULL is a draft; pipeline hard-stops) -
CREATE TABLE IF NOT EXISTS public.voice_specs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  spec              jsonb NOT NULL,
  bootstrapped_from text,
  approved_at       timestamptz,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_specs_client_version_unique UNIQUE (client_id, version)
);
CREATE INDEX IF NOT EXISTS voice_specs_approved_idx ON public.voice_specs (client_id) WHERE approved_at IS NOT NULL;

-- Per-version reviewer annotations (client_id denormalized for RLS). New in
-- the SEO Creator port; anon must never reach it.
CREATE TABLE IF NOT EXISTS public.review_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id    uuid NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL,                      -- denormalized for RLS
  version     integer NOT NULL,
  author_id   uuid NOT NULL,
  body        text NOT NULL,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_comments_piece_idx  ON public.review_comments (piece_id, version);
CREATE INDEX IF NOT EXISTS review_comments_client_idx ON public.review_comments (client_id);

-- RLS — v1 has exactly TWO access paths:
--   (1) service-role (the operator pipeline) — bypasses RLS entirely;
--   (2) anon public read — ONLY published content_pieces rows (render surface).
-- There are NO authenticated non-service-role tenant users in v1. So this
-- migration creates NO authenticated tenant-read policy: every non-published
-- row and every other table is invisible to anon (fail-closed).
ALTER TABLE public.content_pieces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_piece_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_specs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments         ENABLE ROW LEVEL SECURITY;

-- Public read: ONLY published content_pieces rows (the render surface).
-- No policy on voice_specs / content_piece_versions / review_comments
-- => anon has no access to them.
DROP POLICY IF EXISTS content_pieces_public_read ON public.content_pieces;
CREATE POLICY content_pieces_public_read ON public.content_pieces
  FOR SELECT TO anon USING (status = 'published');
