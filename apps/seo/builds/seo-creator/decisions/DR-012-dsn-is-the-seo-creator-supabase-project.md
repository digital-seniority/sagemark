# DR-012 — dsn-is-the-seo-creator-supabase-project

**Date:** 2026-06-26
**Run:** manual (post-Run #006, Supabase wiring)
**Status:** SUPERSEDED by [[DR-015]] (2026-06-26) — the project was redirected from DSN to `Sagemark`/`rilaycjkksfosnxvenzt`. DSN is now orphaned (same schema, no data). The setup process below still describes how the schema/RLS were applied + verified (identical steps were re-run on the new project).
**Build phase:** Phase 0 — Foundations

## Context

Through Run #006 the SEO Creator build had **no Supabase project wired** — the tenancy
schema (`packages/schema-flywheel/drizzle/0030`–`0033`) existed only as hand-authored SQL
that had never been applied anywhere, and the RLS contract test's Tier-2 (behavioral)
assertions skipped for lack of a `DATABASE_URL` (audit-001 finding **A.005.5**). Earlier
DR notes recorded "No Supabase wired → test with a mocked data layer or local Docker pg."

The Supabase MCP exposes 5 projects under the `pqhrgjxaxlgjuppwewvs` org (Sidekind,
NextSchool, **DSN**, Flywheel, Prestige School). The GitHub org is `digital-seniority` and
the Vercel team is "Digital Seniority," so **DSN** (`gshcdvcfgbzpzwhvlxmg`, us-west-2,
created 2026-06-19) is the natural home. The user explicitly chose DSN.

## Decision

**DSN (`gshcdvcfgbzpzwhvlxmg`) is the SEO Creator Supabase project.**

- Migrations `0030`–`0033` were applied to DSN (it was empty — zero tables/migrations, so
  additive + safe; no branch needed). All 8 content/release tables exist with RLS enabled.
- **RLS verified behaviorally as the `anon` role** (seeded + rolled back, nothing persisted):
  `content_clients` and the 5 internal/release tables → 0 rows to anon; `content_pieces` →
  only `status='published'` rows (drafts hidden). This is real Tier-2 evidence for the
  `content_clients` fix (A.005.1, PR #13) and partially closes A.005.5.
- The Supabase security advisor's `rls_enabled_no_policy` notices on the 7 internal tables
  are **INFO and by-design** (fail-closed: RLS on, no anon policy = no anon access).

## Wiring

- `.claude/settings.local.json` now carries the **public** DSN connection values:
  `SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_URL` (`https://gshcdvcfgbzpzwhvlxmg.supabase.co`),
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). These are publishable by design.
- **NOT stored by the agent (human/CI secrets):** the service-role key and a direct-Postgres
  `DATABASE_URL`. The RLS contract test's Tier-2 needs `DATABASE_URL` — a human/CI must set it
  (this is the remaining half of A.005.5 / A.005.4's CI work). App-runtime wiring (Vercel env
  vars / `.env.local`) is likewise human-set when the app deploys.

## Consequences

- A.005.5 (RLS Tier-2 unproven) is **partially resolved**: the schema + RLS are now real and
  behaviorally verified against DSN via the MCP; the remaining gap is wiring `DATABASE_URL`
  into CI so the test *file* (not just the MCP) executes Tier-2 — folds into **A.005.4** (CI).
- P0.S.2 (DB-backed publish endpoint) and the worker persistence path (P0.W.2/P0.W.5) now have
  a concrete target DB. Apply future migrations (`0034+`) to DSN as they land.
- **Security hygiene applied this session:** a pre-existing DSN helper `public.rls_auto_enable()`
  (a beneficial SECURITY-DEFINER event trigger that auto-enables RLS on new public tables) was
  RPC-executable by anon/authenticated (advisor WARN 0028/0029); `EXECUTE` was revoked from
  anon/authenticated/PUBLIC. Event-trigger behavior is unaffected.

Links: [[DR-006]] (schema drift + Supabase CI), [[DR-003]] (auth placeholder seam — tenancy
not yet enforced at the app layer), [[DR-011]] (no-shell worker — the worker has no direct DB creds).
