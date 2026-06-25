# DR-001 — port-source-root-is-flywheel-main

**Date:** 2026-06-25
**Run:** #001
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

Phase 0 of the SEO Creator build is fundamentally a **port**: the engineering-rfc.md
PRs say "copy verbatim from `apps/trailhead/src/lib/ai.ts`", "port the 22 scorers from
`apps/agents/src/lib/content/*`", "port `seo-gate`/`lifecycle-fsm` from `origin/preview`",
"reuse the existing `apps/agents` StudioCanvas", etc.

On Run #001 preflight the orchestrator discovered **none of those source paths exist in
the sagemark repo**. The apps present here are only `imagegen, intelligence, ppc, seo,
videogen` — there is no `apps/trailhead` and no `apps/agents`.

A filesystem search located the sources in a **sibling repo on the same machine**:
`C:/Users/stone/Code/flywheel-main/`. Confirmed present there:
- `C:/Users/stone/Code/flywheel-main/apps/trailhead/src/lib/ai.ts` (the provider seam — full Vercel AI Gateway wiring, model ids, per-request cost ceiling, spend tracker)
- `C:/Users/stone/Code/flywheel-main/apps/agents/src/lib/auth.ts` (auth guard to re-export)
- `C:/Users/stone/Code/flywheel-main/apps/agents/src/lib/content/*` (scorer library + gates — port source for PR 002/003)

## Problem

The RFC's source paths (`apps/trailhead/...`, `apps/agents/...`) are written relative to a
repo that is NOT this one. Without resolving the root, unattended Phase-3 agents would
either fail to find the sources or fabricate "verbatim ports" of files that don't exist —
exactly the markdown-drift / reinvention anti-pattern the build forbids.

## Options considered

- **Option A: Treat RFC source paths as relative to `C:/Users/stone/Code/flywheel-main/`.**
  - Pros: Sources demonstrably exist there; matches the blueprint's reference orchestrators (VideoGen/AgeWise/Jarvis all live under flywheel-main); zero plan rewrite. Worktree-isolated agents can read absolute sibling-repo paths (isolation is git-tree-only, not a filesystem jail).
  - Cons: Cross-repo dependency on a path outside the repo; not reproducible on a machine without flywheel-main checked out; agents must be told the absolute root explicitly.
- **Option B: Re-implement each Phase-0 module fresh against the acceptance criteria, ignoring "verbatim".**
  - Pros: Self-contained repo.
  - Cons: Violates the explicit "no reinvention / no markdown drift" lane mandate; loses the ported production bug-fix scars the criteria depend on; the scorer/gate suites are the product — re-deriving them is how subtle regressions enter.
- **Option C: STOP the build and ask the user to vendor the sources into sagemark first.**
  - Pros: Cleanest long-term repo hygiene.
  - Cons: Blocks the explicitly-authorized unattended run on something the orchestrator can resolve itself; the sources are already on disk.

## Chosen

**Option A.** Rationale: the sources exist and are authoritative at the flywheel-main
path; the build's whole Phase-0 intent is to port them verbatim, so reading them from
their real location honors the spec rather than rewriting it. Agents are given the
absolute `PORT_SOURCE_ROOT = C:/Users/stone/Code/flywheel-main/` in their prompt and port
into sagemark's `packages/core` / `apps/seo` write-scopes. (Option B is the forbidden
reinvention path; C needlessly blocks an authorized run.)

## Consequences

- Every Phase-3 agent prompt for a "port" PR includes `PORT_SOURCE_ROOT = C:/Users/stone/Code/flywheel-main/` and the absolute source path to copy from.
- The ported code lives in sagemark; the flywheel-main path is a **read-only source**, never a write target or a runtime dependency.
- Future runs / a fresh machine without flywheel-main checked out cannot reproduce Phase-0 ports — a later PR should vendor a snapshot or the team should document the source pin. (Flagged for a Phase-0-close audit.)
- The judge should verify ports are faithful to the flywheel-main source (not re-derived), per the lane mandate.

## Revisit if

- The sources get vendored into sagemark (then root flips to in-repo and this DR is superseded).
- flywheel-main's layout changes or those files move.
- A CI/reproducibility requirement makes the external path untenable.

## Related

- Anchor sub-page: `plans/seo-creator/flywheel/engineering-rfc.md` (this DR resolves an unstated precondition of every Phase-0 port PR)
- PR that prompted: P0.E.1 (PR 001 — provider-seam port); applies to P0.E.2/P0.E.3/P0.S.1 and the agent-ui StudioCanvas reuse
- Audit that surfaced: n/a (orchestrator preflight, Run #001)

---

*Authored by /seo-creator-build · Run #001 · 2026-06-25 19:24*
