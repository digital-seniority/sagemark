-- seed/0038_pilot_placeholder_reviewer.sql — DR-037 PILOT placeholder reviewer.
--
-- A SEED, NOT A MIGRATION. This file is applied OUT-OF-BAND by a human into the
-- PILOT workspace only. It is deliberately NOT a numbered migration under
-- drizzle/*.sql, so the auto-applied schema-migration set never seeds a release
-- authority — seeding a reviewer is an operational act, gated on the pilot
-- workspace, never an automatic schema change.
--
-- WHAT IT SEEDS (DR-037): the PLACEHOLDER credentialed reviewer authorization that
-- unblocks P1.C.2 engineering/test WITHOUT a real E-E-A-T person:
--   name:       "Pending Clinical Reviewer"   (the recognizable sentinel)
--   credential: "RN"                           (placeholder)
--   scope:      'client'                        (the YMYL release scope)
--   status:     active (granted_at set, revoked_at NULL, expires_at NULL)
--   placeholder: TRUE                           (the 0038 go-live-guard flag)
--
-- THE GO-LIVE GUARD (load-bearing): because `placeholder = true`,
-- apps/seo/src/lib/review/signoff.ts REFUSES to write a `credentialed_releases`
-- row backed by this authorization in any NON-pilot/production context. A REAL
-- credentialed reviewer (real name + verifiable credential + authorization +
-- client relationship) MUST replace this row before any production YMYL publish;
-- the live-publish flag stays OFF until then.
--
-- PARAMETERS — replace the placeholders below before applying:
--   :workspace_id   the PILOT workspace uuid
--   :client_id      a content_clients.id in that workspace (FK target)
--   :author_id      the voice_specs.authors[] entry id the byline references
--   :authorized_by  the operator uuid recording the authorization
--
-- IDEMPOTENT: guarded by NOT EXISTS on the recognizable placeholder credential
-- name within the (workspace, client), so re-running does not insert duplicates.
--
-- MIGRATION-ROLE NOTE: writes ONLY the `public` schema; a single INSERT. NO event
-- trigger, NO SET ROLE, NO GRANT, NO superuser-only construct — the live POOLED
-- role can run it. RLS on byline_authorizations is service-role-only (0032), which
-- is the access path a human seed uses.

INSERT INTO public.byline_authorizations
  (workspace_id, client_id, author_id, credential, scope,
   granted_at, expires_at, revoked_at, authorized_by, placeholder)
SELECT
  :'workspace_id'::uuid,
  :'client_id'::uuid,
  :'author_id'::uuid,
  '{"name":"Pending Clinical Reviewer","credentials":"RN"}'::jsonb,
  'client',
  now(),
  NULL,           -- no expiry
  NULL,           -- not revoked -> active
  :'authorized_by'::uuid,
  true            -- placeholder: the DR-037 go-live guard flag
WHERE NOT EXISTS (
  SELECT 1 FROM public.byline_authorizations b
  WHERE b.workspace_id = :'workspace_id'::uuid
    AND b.client_id    = :'client_id'::uuid
    AND b.placeholder  = true
    AND b.credential ->> 'name' = 'Pending Clinical Reviewer'
);
