# DR-006 — schema-flywheel-drift-and-supabase-ci

**Date:** 2026-06-25
**Run:** #002
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.S.1 (PR 004) bootstrapped `@sagemark/schema-flywheel` with hand-written migrations
(0030–0032) as the apply-path and `src/content.ts` as the typed source-of-truth, and a
`rls-contract.test.ts` that runs Tier-1 static + Tier-2 live (Docker Postgres 16, 17/17 green).
Two structural realities the judge flagged (non-blocking; PR approved 5/5/5):

1. **No committed drizzle `meta/` snapshot.** "drizzle:generate produces no drift" was
   satisfied by DDL-equivalence inspection, not by the tool — without a `meta/` baseline,
   `drizzle-kit generate` always re-emits a fresh `0000`, so it can never report "no changes."
2. **RLS is invisible to drizzle.** Fail-closed RLS lives only in the hand-written SQL; the
   Drizzle source-of-truth can't regression-guard it. So `rls-contract.test.ts` is the SOLE
   guard for the #1 (tenant-leak) risk — and it cleanly SKIPS when no DB is present.
3. **Validated on bare Docker pg, not real Supabase.** The test self-creates the `anon` role +
   grants; real Supabase has `anon` pre-wired with different GUC/JWT plumbing.

## Chosen / decisions recorded

- **Drift:** accept DDL-equivalence for now; a follow-up should commit a drizzle `meta/`
  baseline (or add a `drizzle generate --check` CI step) so drift is tool-enforced. Until then,
  a column added to `src/content.ts` but not to a migration (or vice-versa) passes silently —
  the schema-tenancy lane must keep migrations + `content.ts` in lockstep by hand.
- **RLS CI gate:** `apps/seo/test/tenancy/rls-contract.test.ts` must become a **required,
  non-skippable** CI check against a real Postgres (Supabase branch or service container)
  before this schema backs paid-tenant data. A skipped contract test in CI = no tenant-leak
  guard. This is the same class of "fails-the-build wiring is owed" gap as PR 001's worker-env
  lint — both block on the repo having no CI harness yet.
- **Supabase-branch validation:** run the contract test once against an actual Supabase branch
  (`DATABASE_URL=…`) before paid data; docker-green is sufficient to MERGE Phase-0/1 schema, not
  to declare production tenant-isolation confidence.

## Consequences

- Future schema-tenancy PRs replicate the RLS-on/no-anon-policy + denormalized-`client_id`
  pattern (incl. the net-new `review_comments`, DR-flagged here as the established pattern).
- A CI-bootstrap PR (or the worker-runtime lane that provisions infra) owes: (a) the drizzle
  drift check, (b) the non-skippable rls-contract gate, (c) one Supabase-branch run. Tracked
  in STATE.md "blocked/awaiting input" as a non-engineering/infra follow-up, NOT a blocker for
  the current dependency-eligible engineering work.

## Revisit if

- A CI harness lands (then wire the two gates).
- The team vendors a Supabase project into sagemark.

## Related

- Anchor: engineering-rfc.md (### PR 004), prd.md §4.5/§11.4 (tenancy)
- PR that prompted: P0.S.1 · Predecessor DRs: DR-001
- Related gap: PR 001 AC#3 (worker-env CI lint not wired — same no-CI-harness root)

---

*Authored by /seo-creator-build · Run #002 · 2026-06-25 20:05*
