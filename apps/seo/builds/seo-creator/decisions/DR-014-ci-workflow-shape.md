# DR-014 — ci-workflow-shape

**Date:** 2026-06-26
**Run:** #007
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

Audit-001 finding A.005.4: the repo had **no CI** — no `.github/` workflow, no root `test`
script, the `node:test` RLS contract suite invoked by nothing, and `worker-env-lint` never
run ("AC#3 fails-the-build" half-delivered). Nothing guarded against a regression landing.
PR #16 (Run #007, judge APPROVED 4/5·5/5) stood up the first CI workflow.

## Decision

**`.github/workflows/ci.yml` is the canonical CI shape** every future workflow/lane copies:

- Trigger: `pull_request` + `push` to `preview` and `main`. (`"on":` is QUOTED to avoid the
  YAML-1.1 `on→true` boolean-coercion bug.)
- Steps: checkout → `pnpm/action-setup` (pnpm 10) + Node 24 with `cache: pnpm` →
  `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`
  (`turbo run test`) → explicit `node --test apps/seo/test/tenancy/rls-contract.test.ts`
  (belt-and-suspenders for the node:test RLS suite) → `pnpm build` (the DR-008 consuming-app
  build) → **worker-env-lint step** (`assertWorkerEnvClean` → non-zero on a Gateway-bypass
  env; this is the AC#3 "fails-the-build" wiring).
- `DATABASE_URL: ${{ secrets.DATABASE_URL }}` in the test env so RLS **Tier-2** runs against
  DSN (DR-012) once the secret is set; Tier-2 skips cleanly when unset (never a false pass).

Single turbo job (cache reuse) over a per-package matrix. Root `package.json` exposes
`"test": "turbo run test"`; `apps/seo` `test` runs vitest **and** the node:test RLS file.

## Open / action (escalated to the user)

**A human must set the GitHub Actions repo secret `DATABASE_URL`** to the DSN connection
string for RLS **Tier-2** (cross-tenant / FK / CHECK / anon-isolation) to execute in CI.
Until then Tier-2 SKIPS on every run — Tier-1 static assertions still gate, but the
behavioral tenant-isolation guarantees (the #1 SEO-Creator risk) are not exercised in CI.
This is the remaining half of A.005.5.

## Consequences

- A.005.4 active risk resolved pending merge of PR #16; A.005.5 reduced to "set the CI
  `DATABASE_URL` secret."
- Future CI changes extend this file rather than forking a new shape.
- Judge follow-up: add an in-pipeline NEGATIVE worker-env-lint assertion (a test that a
  planted bypass makes `assertWorkerEnvClean` throw) so a future refactor that neuters the
  lint is caught by CI itself, not only by a manual check.

Links: [[DR-012]] (DSN — the Tier-2 target), [[DR-008]] (consuming-app build in CI), [[DR-006]] (schema drift + Supabase CI), [[audit-001]] (finding A.005.4 / A.005.5).
