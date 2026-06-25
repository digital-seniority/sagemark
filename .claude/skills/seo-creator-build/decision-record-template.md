# Decision record template

Written to `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/decisions/DR-NNN-<slug>.md` when one of:

- The judge verdict flags a PR as "decision-worthy" (new pattern established, spec deviation accepted, convention chosen, hard tradeoff made)
- A spec-reconciler audit finds drift that needs adjudication
- A phase-boundary audit ratifies a major architectural choice

DRs are read by Phase 3 agents whose PR scope keywords match — see the orchestrator's agent prompt §"DECISION RECORDS".

Agents must NEVER write DRs. Only the orchestrator (this skill) writes here.

---

```markdown
# DR-NNN — <kebab-case-slug>

**Date:** YYYY-MM-DD
**Run:** #NNN (or `audit-NNN` if from audit, or `phase-NNN-close` if from phase boundary)
**Status:** active | superseded by DR-MMM | retired-by-canonicalization
**Build phase:** <Phase 0 — Foundations | Phase 1 — Pilot | ...>

## Context

What was happening when this decision was made? (Conditions, constraints, prior decisions that mattered.)

## Problem

What needed to be decided? (One-sentence problem statement; the alternatives that mattered.)

## Options considered

- **Option A: <name>**
  - Pros: <list>
  - Cons: <list>
- **Option B: <name>**
  - Pros: <list>
  - Cons: <list>
- **Option C: <name>** (if applicable)
  - Pros: <list>
  - Cons: <list>

## Chosen

**<Option name>.** Rationale: <2-3 sentences. Why this option over the others; what tradeoff we accepted.>

## Consequences

What changes downstream? What's now constrained?

- <Code surface change>
- <Convention change>
- <New pattern that other PRs should follow>
- <Pattern that's now off-limits>

## Revisit if

- <Condition 1 that would justify reconsidering>
- <Condition 2>
- <Time-based trigger, e.g., "if the team grows past N">

## Related

- Anchor sub-page: <path> (this DR honors / extends / supersedes the anchor)
- Predecessor DRs: <list, if any>
- PR that prompted: <PR id>
- Audit that surfaced: <audit id, if any>

---

*Authored by /seo-creator-build · Run #NNN · YYYY-MM-DD HH:MM*
```
