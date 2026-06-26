# DR-019 — vitest-config-include-shared-append

**Date:** 2026-06-26
**Run:** #009
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

PR 007 (P0.W.4) added `apps/seo/test/stream/sse-relay.test.ts`. Vitest only runs files matched by the `test.include` globs in `apps/seo/vitest.config.ts`; there is no CLI override that adds a directory without editing the config. So PR 007 added a 1-line `include` entry for `test/stream/**`. Without it, the spec-mandated test would be checked in but **silently never execute** — a green suite that doesn't run the new tests, the worst outcome. However, `vitest.config.ts` is listed in **PR 015's** write-scope, not PR 007's — a genuine write-scope/manifest ownership collision.

## Problem

Should a test-enablement edit to a shared config file (`vitest.config.ts`) by a PR that adds a new test directory be treated as in-scope, even when the file is nominally another PR's write-scope?

## Options considered

- **Option A: Bless an additive `include` carve-out — any PR that adds a new test directory may append (only append) to `vitest.config.ts`'s `include` array.**
  - Pros: test enablement is never gated by manifest ownership; the alternative (shipping a test that never runs) is strictly worse; the edit is 1 line, additive, non-behavioral.
  - Cons: weakens strict write-scope purity; two PRs can append to the same array (low conflict risk — append-only, distinct globs).
- **Option B: Reassign `vitest.config.ts` `include` to an explicit append-only shared file.**
  - Pros: formalizes shared ownership.
  - Cons: more machinery than the problem warrants at this phase.
- **Option C: Require each new test directory's enablement to wait for its owning PR (e.g. PR 015).**
  - Pros: strict ownership.
  - Cons: tests sit dormant/un-run for multiple runs — exactly the silent-skip failure the flywheel guards against.

## Chosen

**Option A** — additive `include` carve-out. Rationale: a checked-in test that never runs is a worse failure than a 1-line shared-config append; the edit is append-only and non-behavioral; the judge independently verified the suite executes the new tests after the change. The judge accepted the PR 007 edit on exactly this basis.

## Consequences

- Future PRs that add a new test directory MAY append (append-only) to `apps/seo/vitest.config.ts`'s `include` array, even if the file is nominally another PR's write-scope. Any OTHER change to `vitest.config.ts` remains out-of-scope and a judge flag.
- PR 015's write-scope on `vitest.config.ts` is reduced to "everything except append-only `include` entries already added by earlier PRs" — PR 015 should not re-add or fight the existing `test/stream/**` glob.

## Revisit if

- `vitest.config.ts` `include` edits start carrying behavioral changes (coverage config, environment, setup files) under the guise of "enablement" — then tighten back to strict ownership.

## Related

- Anchor sub-page: plans/seo-creator/flywheel/engineering-rfc.md (PR 007 + PR 015 write-scopes)
- PR that prompted: P0.W.4 (PR 007)

---

*Authored by /seo-creator-build · Run #009 · 2026-06-26*
