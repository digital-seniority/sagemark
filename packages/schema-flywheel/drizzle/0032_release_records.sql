-- 0032_release_records.sql — byline authorization + the release/signoff split.
-- Authoritative target: the RFC § PR 004 inline 0032 SQL. THREE distinct
-- tables; the split is load-bearing for PR 009's canPublish().
--
-- `IF NOT EXISTS` table/index guards are an additive idempotency safety net
-- (matching the 0030/0031 convention); columns, CHECKs, FKs and the UNIQUE are
-- exactly as the RFC specifies.

-- FIRST: the consent/authorization record backing every published byline (§11.5).
-- Created BEFORE credentialed_releases so the authorization_id FK target exists.
-- A byline is attachable only while an ACTIVE authorization exists
-- (granted_at set, revoked_at IS NULL, expires_at NULL or in the future).
CREATE TABLE IF NOT EXISTS public.byline_authorizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  author_id     uuid NOT NULL,                                -- -> voice_specs.authors[] entry
  credential    jsonb NOT NULL,                               -- snapshot {name, credentials} at grant
  scope         text NOT NULL CHECK (scope IN ('client','cluster','piece')),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,                                  -- nullable: no expiry
  revoked_at    timestamptz,                                  -- nullable: revocation is a new state, never a delete
  authorized_by uuid NOT NULL                                 -- the operator who recorded the authorization
);
CREATE INDEX IF NOT EXISTS byline_authorizations_client_idx ON public.byline_authorizations (client_id);
CREATE INDEX IF NOT EXISTS byline_authorizations_author_idx ON public.byline_authorizations (author_id);
-- active-authorization lookup (granted ∧ ¬revoked ∧ ¬expired)
CREATE INDEX IF NOT EXISTS byline_authorizations_active_idx ON public.byline_authorizations (client_id, author_id, revoked_at, expires_at);
ALTER TABLE public.byline_authorizations ENABLE ROW LEVEL SECURITY;  -- no anon policy

-- ADVISORY client/agency-contact approval — can NEVER release or supply a byline
CREATE TABLE IF NOT EXISTS public.client_signoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  client_id     uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  piece_id      uuid NOT NULL REFERENCES public.content_pieces(id)  ON DELETE RESTRICT,
  version       integer NOT NULL,
  release_type  text NOT NULL DEFAULT 'client_signoff'
                  CHECK (release_type = 'client_signoff'),   -- structurally fixed
  actor_id      uuid NOT NULL,                                -- the client/agency contact
  release_scope text NOT NULL CHECK (release_scope IN ('piece','section')),
  released_at   timestamptz NOT NULL DEFAULT now()
  -- NOTE: deliberately NO credential, NO authorization_id —
  -- a client_signoff cannot satisfy canPublish() nor populate a byline.
);
CREATE INDEX IF NOT EXISTS client_signoffs_piece_idx  ON public.client_signoffs (piece_id, version);
CREATE INDEX IF NOT EXISTS client_signoffs_client_idx ON public.client_signoffs (client_id);
ALTER TABLE public.client_signoffs ENABLE ROW LEVEL SECURITY;  -- no anon policy

-- The ONLY record that satisfies canPublish()'s human-release precondition (D6 reviewer)
CREATE TABLE IF NOT EXISTS public.credentialed_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  client_id       uuid NOT NULL REFERENCES public.content_clients(id) ON DELETE RESTRICT,
  piece_id        uuid NOT NULL REFERENCES public.content_pieces(id)  ON DELETE RESTRICT,
  version         integer NOT NULL,
  release_type    text NOT NULL DEFAULT 'credentialed_release'
                    CHECK (release_type = 'credentialed_release'),
  actor_id        uuid NOT NULL,            -- the credentialed reviewer (D6)
  credential      jsonb NOT NULL,           -- snapshot {name, credentials} at release (byline evidence)
  authorization_id uuid NOT NULL
                    REFERENCES public.byline_authorizations(id) ON DELETE RESTRICT,  -- FK -> §11.5 byline-authorization record
  release_scope   text NOT NULL CHECK (release_scope IN ('piece','section')),
  released_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credentialed_releases_piece_version_unique UNIQUE (piece_id, version)  -- one credentialed release per version
);
CREATE INDEX IF NOT EXISTS credentialed_releases_client_idx ON public.credentialed_releases (client_id);
CREATE INDEX IF NOT EXISTS credentialed_releases_auth_idx   ON public.credentialed_releases (authorization_id);
ALTER TABLE public.credentialed_releases ENABLE ROW LEVEL SECURITY;  -- no anon policy
