-- 0031_cluster_funnel_columns.sql — promote cluster_role + funnel_stage to
-- first-class CHECK-constrained columns on content_pieces (D7), and re-assert
-- the fail-closed RLS the contract test depends on.
--
-- Constraint content is authoritative per the RFC § PR 004 inline SQL. The
-- `IF NOT EXISTS` guards are an additive idempotency safety net (matching the
-- 0030 convention) so a re-run never errors.

ALTER TABLE public.content_pieces
  ADD COLUMN IF NOT EXISTS cluster_role text,
  ADD COLUMN IF NOT EXISTS funnel_stage text;

-- CHECK constraints (added separately so the guarded ADD COLUMN above stays
-- simple; guarded against duplicate creation on re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_pieces_cluster_role_check'
  ) THEN
    ALTER TABLE public.content_pieces
      ADD CONSTRAINT content_pieces_cluster_role_check
      CHECK (cluster_role IN ('pillar','cornerstone','spoke','faq','checklist'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_pieces_funnel_stage_check'
  ) THEN
    ALTER TABLE public.content_pieces
      ADD CONSTRAINT content_pieces_funnel_stage_check
      CHECK (funnel_stage IN ('awareness','consideration','decision','retention'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS content_pieces_cluster_idx
  ON public.content_pieces (client_id, cluster_role, funnel_stage);

-- Fail-closed RLS (ported from 0030, re-asserted here for the contract test).
ALTER TABLE public.content_pieces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_piece_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_specs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments         ENABLE ROW LEVEL SECURITY;

-- the ONLY anon policy: published pieces, nothing else.
DROP POLICY IF EXISTS content_pieces_public_read ON public.content_pieces;
CREATE POLICY content_pieces_public_read ON public.content_pieces
  FOR SELECT TO anon USING (status = 'published');
-- voice_specs / content_piece_versions / review_comments: NO anon policy at all.
