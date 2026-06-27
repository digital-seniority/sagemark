# DR-022 — in-repo-suite-package-is-canonical-source

**Date:** 2026-06-26
**Run:** #010.5 (user-directed integration, between Run #010 and the Run #011 unattended batch)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.W.5 (PR 008) was blocked on two non-engineering questions (Run #009/#010 finding): (1) how the `seo-copywriter` suite `SKILL.md` files reach the Sandbox worker (they lived only at `~/.claude/skills/seo-copywriter/…`, not in-repo, and NOT at the RFC's `learnings/SKILLS/seo-copywriter/*` path), and (2) where the human-labeled Whispering Willows golden corpus comes from. James resolved both by adding a self-contained skill package into the repo at `skills/seo-copywriter-skill-package/` and directing "track it and integrate."

## Problem

What is the canonical in-repo source the worker loads the suite from, and what is the golden-corpus content source — now that the package is in the repo?

## Options considered

- **Option A: Treat `skills/seo-copywriter-skill-package/seo-copywriter/` as the canonical in-repo suite + golden source; the worker vendors from it.**
  - Pros: in-repo (versioned, reviewable, reproducible); a self-contained package with `SKILL.md` + the four sub-skills + reference demos; survives Sandbox (COPY into the image) with no dependency on `~/.claude`.
  - Cons: 5MB of vendored content in the app repo; a second copy of skills that also exist at `~/.claude/skills`.
- **Option B: Load from `~/.claude/skills/seo-copywriter/` at runtime.**
  - Cons: not in the repo, not reproducible in CI/Sandbox, machine-specific — rejected.
- **Option C: Symlink/submodule to flywheel-main.**
  - Cons: the suite isn't fully there; cross-repo coupling; rejected.

## Chosen

**Option A.** Rationale: James explicitly placed the package in-repo and asked to integrate it; in-repo vendoring is the only reproducible path for a Sandbox worker + CI. The 5MB cost is acceptable for a versioned, auditable suite source.

## Consequences

- **Canonical suite source:** `skills/seo-copywriter-skill-package/seo-copywriter/{seo-blog-writer,seo-strategist,seo-assistant,seo-audit}/SKILL.md` (+ the top-level `SKILL.md`). P0.W.5's `load-suite.ts` loads from here; the worker `Dockerfile` must COPY this tree into the Sandbox image.
- **Golden-corpus source:** `skills/seo-copywriter-skill-package/seo-copywriter/examples/whispering-willows-demo/` (index + ~7 articles + faq + checklist). P0.W.5 derives the golden set from this real reference content: cluster role / funnel stage labeled from the content + sitemap; expected Stage-A verdicts + Stage-B dimension scores **captured by running the real ported `@sagemark/core` kernel** against each piece (a characterization baseline — deterministic, not fabricated). Human label CERTIFICATION (expert sign-off that the captured baseline is correct ground truth) remains a follow-up NEEDS-INPUT, but the regression tripwire is fully buildable from the captured baseline.
- Do NOT reference `~/.claude/skills/...` or the RFC's `learnings/SKILLS/` path going forward (pre-integration locations).
- `__pycache__/`/`*.pyc` are gitignored; the package's own `.gitignore` keeps `.env*.local` + node_modules out.

## Revisit if

- The vendored suite drifts from the `~/.claude/skills` / flywheel-main copy (decide a sync mechanism).
- The expert golden-label certification arrives (promote the captured baseline to certified ground truth).

## Related

- Anchor sub-page: plans/seo-creator/flywheel/engineering-rfc.md (PR 008), prd.md §12 (golden set), §17 ch.05 (suite run directly)
- Predecessor DRs: [[DR-001]] (port-source-root), [[DR-018]] (bridge auth)
- PR that prompted: P0.W.5 prep (user integration)

---

*Authored by /seo-creator-build · user-directed integration · 2026-06-26*
