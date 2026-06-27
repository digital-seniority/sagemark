# DR-015 — supabase-project-redirected-to-sagemark

**Date:** 2026-06-26
**Run:** manual (post-Run #007, Supabase redirect)
**Status:** active
**Supersedes:** [[DR-012]] (DSN as the Supabase project)
**Build phase:** Phase 0 — Foundations

## Context

DR-012 made **DSN** (`gshcdvcfgbzpzwhvlxmg`, Flywheel Labs org) the SEO Creator Supabase
project. The user then redirected to a **different, dedicated project**:

- **Name:** `Sagemark`
- **Ref:** `rilaycjkksfosnxvenzt`
- **URL:** `https://rilaycjkksfosnxvenzt.supabase.co`
- **Org:** `dbukahlorzsipthfpwda` (a DIFFERENT org/account than Flywheel Labs — the Supabase
  MCP token had to be re-scoped to reach it; `get_project` initially returned permission-denied
  until the user updated the MCP token).
- Region us-west-2, Postgres 17, created 2026-06-26.

## Decision

**The SEO Creator Supabase project is `Sagemark` / `rilaycjkksfosnxvenzt`** (replaces DSN).

Applied to the new (empty) project, identical to the DSN setup:
- Migrations `0030`–`0033` applied (additive; project was empty). All 8 content/release tables
  exist with RLS enabled.
- **RLS verified behaviorally as `anon`** (seeded + rolled back): `content_clients` + the 5
  internal/release tables → 0 rows to anon; `content_pieces` → published-only. The
  `content_clients` fix (A.005.1) holds here too.
- Advisor: 7 `rls_enabled_no_policy` INFO (by-design fail-closed); the pre-existing
  `public.rls_auto_enable()` SECURITY-DEFINER event trigger had anon/authenticated `EXECUTE`
  **revoked** (advisor WARN 0028/0029) — same hardening as DSN.

## Wiring

`.claude/settings.local.json` (gitignored) re-pointed to the new project:
`SUPABASE_PROJECT_REF=rilaycjkksfosnxvenzt`,
`NEXT_PUBLIC_SUPABASE_URL=https://rilaycjkksfosnxvenzt.supabase.co`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_cmvPHoOORj5P1Kh3SJrutA_XGAOs5Id` (publishable).
The service-role key + a direct `DATABASE_URL` remain **human/CI secrets** (still needed for
the CI RLS Tier-2 / A.005.4's `DATABASE_URL` GitHub secret — now point it at THIS project).

## Consequences

- **DSN (`gshcdvcfgbzpzwhvlxmg`) is now orphaned** for SEO Creator — it carries the same
  `0030`–`0033` schema (no data). Leave as-is or drop the tables; not used going forward.
  (User was asked; pending preference — harmless either way.)
- The A.005.4 CI workflow's `DATABASE_URL` secret (PR #16 / DR-014) must be set to the
  **Sagemark** project's connection string, not DSN.
- P0.S.2 / worker persistence (P0.W.2/W.5) target `rilaycjkksfosnxvenzt`. Apply future
  migrations (`0034+`) there.
- The MCP token is now scoped to BOTH the Flywheel Labs org and the new `dbukahlorzsipthfpwda`
  org.

Links: [[DR-012]] (superseded), [[DR-014]] (CI `DATABASE_URL` secret → repoint to Sagemark), [[DR-006]] (schema drift + Supabase CI).
