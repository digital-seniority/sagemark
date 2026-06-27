# DR-003 — auth-placeholder-seam

**Date:** 2026-06-25
**Run:** #001
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

PR 001's spec said `apps/seo/src/lib/auth.ts` should be "a re-export of
`apps/agents/src/lib/auth`". sagemark has no `apps/agents` and no Supabase wiring; the
flywheel-main agents auth is deeply coupled to `@supabase/supabase-js`, anonymous sessions,
and videogen credits/onboarding — unbuildable and out of scope here. (RFC line 140 itself
labels `apps/agents` a *convention reference*, not a present path.)

## Problem

How to provide the studio's operator/workspace auth chokepoint that PR 001's `(studio)` page
is wired against, when the specified re-export source doesn't exist in this repo.

## Options considered

- **Option A: Typed no-op placeholder seam with the same shape.** Stand up
  `Operator`/`Workspace` types + `getCurrentOperator`/`getCurrentWorkspace`/`requireOperator`
  returning null/no-op, documented for a later tenancy PR to fill.
  - Pros: Establishes the chokepoint now; the studio page resolves operator before rendering;
    later PRs swap the body behind a stable signature.
  - Cons: Auth is inert until the tenancy PR; a careless caller could mistake the no-op for real auth.
- **Option B: Omit auth.ts; introduce it in PR 004 (schema/tenancy).**
  - Cons: Loses the chokepoint the studio page already depends on; reorders the scaffold.
- **Option C: Port flywheel-main's Supabase-coupled auth now.**
  - Cons: Unbuildable here (no Supabase/credits/onboarding packages).

## Chosen

**Option A.** The seam shape is the durable contract; the body is filled by the
schema-tenancy lane (PR 004+) once Supabase/RLS land. Judge approved the deviation as
justified + documented.

## Consequences

- Convention established: **every studio surface resolves operator/workspace via
  `apps/seo/src/lib/auth.ts` before rendering.** Future studio pages must use this seam, not
  ad-hoc auth.
- The seam is a **no-op placeholder** until a schema-tenancy PR implements it against real
  Supabase auth + RLS. Until then, treat any "authenticated" studio surface as NOT actually
  access-controlled — do not ship a public deployment relying on it.
- The RFC's "re-export of apps/agents/src/lib/auth" wording is reconciled by this DR (no
  silent override).

## Revisit if

- A schema-tenancy PR (PR 004+) implements real auth → update this DR to point at it.
- An `apps/agents` equivalent is vendored into sagemark.

## Related

- Anchor sub-page: `plans/seo-creator/flywheel/engineering-rfc.md` (### PR 001)
- PR that prompted: P0.E.1
- Predecessor DRs: DR-001

---

*Authored by /seo-creator-build · Run #001 · 2026-06-25 19:40*
