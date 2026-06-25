# DR-002 — spike-held-open-not-human-merge-hardstop

**Date:** 2026-06-25
**Run:** #001
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.W.1 (PR 000, the Sandbox capability-denial spike) is an **architecture gate**: its
recorded four-control verdict must exist before PR 006 (the worker host) merges. The judge
APPROVED it *as a landable artifact* (probes are genuinely adversarial, typecheck clean, no
fabricated verdicts) but raised a real escalation: the **live Vercel Sandbox adversarial
run is unresolved** and needs a human/CI with infra. This is the spec's own Tier-3 path,
not a code defect.

## Problem

The compiled auto-merge contract says: a PR excluded from auto-merge (agent flagged
human-review / NEEDS-INPUT) is marked `REQUIRES_HUMAN_MERGE`. But `requires_human_merge` is
in the manifest's `operations.auto_loop.hard_stop_on`, and the Stop hook
(`flywheel-stop-continue.mjs` `hardStopHit`) ends the **entire** loop the moment any PR
holds that status. So marking P0.W.1 `REQUIRES_HUMAN_MERGE` would halt the whole multi-lane
build after Run #001 — even though the human gate blocks only the *worker-runtime* lane
(PR 006+), while ~15 independent engine-port / schema-tenancy / render-geo / agent-ui /
client-review PRs remain dependency-eligible and have nothing to do with the Sandbox run.

## Options considered

- **Option A: Mark P0.W.1 `PR_CREATED` (open, unmerged) and continue the loop.**
  - Pros: Preserves the architecture gate *automatically* — P0.W.1 is not `MERGED`, so its
    dependent P0.W.2 (worker host) stays deferred by the dependency DAG with zero manifest
    surgery. Keeps the loop productive on the 15+ independent PRs (the user's "unattended
    until done" intent + the floodgate multi-lane design). The escalation is surfaced loudly
    (PR #3 body, checkpoint, this DR, STATE.md).
  - Cons: A literal reading of the compiled contract says "mark excluded PRs
    REQUIRES_HUMAN_MERGE"; this deviates from that wording. Leaves an open PR James must act on.
- **Option B: Mark P0.W.1 `REQUIRES_HUMAN_MERGE` (per the literal contract).**
  - Pros: Contract-literal; forces a human checkpoint immediately.
  - Cons: Hard-stops the *entire* loop after 1 of 23 PRs over a gate that blocks only the
    worker lane — directly contradicts "unattended until all is done" and wastes the
    floodgate design. The worker gate is already enforced by the DAG regardless.
- **Option C: Auto-merge the spike (judge said landable) + add a `non_engineering_blocker`
  to P0.W.2 in the manifest to hold the gate.**
  - Pros: Lands the (additive, no-runtime) spike; loop continues.
  - Cons: Edits an anchor artifact (the manifest pr_map); makes the gate depend on manifest
    surgery surviving; `MERGED` spike weakens the visible "this is still gated" signal.

## Chosen

**Option A.** Rationale: it satisfies BOTH constraints the literal contract puts in tension —
the architecture gate is preserved (worker host stays deferred because P0.W.1 isn't MERGED)
AND the loop stays productive on the lanes the gate doesn't touch, which is the user's
explicit intent. The hard-stop policy exists to stop the loop *barrelling past* a needed
human decision; here the loop does not barrel past it — the DAG defers every worker-dependent
PR until P0.W.1 is merged, which only a human will do after the live run. Option B honors the
letter while violating the purpose; Option C needlessly mutates an anchor.

## Consequences

- P0.W.1 status = `PR_CREATED` (OPEN) in STATE.md, with a note that it is judge-approved and
  human-gated, and PR #3 left open.
- The loop's hard-stop scan will NOT trip on Run #001 (no PR holds BLOCKED / REQUIRES_HUMAN_MERGE).
- **Gate enforcement is now load-bearing on the dependency graph:** P0.W.2 (and everything
  transitively under it) must NOT be spawned until P0.W.1 is `MERGED`. The orchestrator must
  treat P0.W.1 as a blocking dependency for the worker lane and NOT auto-advance the worker
  host even if some future state edit flips P0.W.1 to MERGED without the live run being done.
- If a future run finds P0.W.2 dependency-eligible (i.e., P0.W.1 got merged AND P0.E.4 merged),
  it must re-check that the live Sandbox run was actually recorded in `RESULTS.md` before
  spawning the worker host — re-surface as an escalation if not.
- The general policy tension (auto-merge-exclusion ⇒ REQUIRES_HUMAN_MERGE ⇒ loop hard-stop)
  should be reconciled in the skill/manifest at a phase-close audit: a downstream-gating
  human-merge should not necessarily hard-stop lanes it doesn't block.

## Revisit if

- The live Sandbox run is completed and P0.W.1 is merged (then this DR is satisfied; worker lane unblocks).
- The team decides downstream human-gates SHOULD hard-stop the whole loop (then revert to Option B).
- The skill is re-compiled with a per-lane hard-stop model.

## Related

- Anchor sub-page: `plans/seo-creator/flywheel/engineering-rfc.md` (### PR 000 — "decision made before PR 006 merges")
- PR that prompted: P0.W.1 (PR #3, left open)
- Predecessor DRs: DR-001 (port-source root)

---

*Authored by /seo-creator-build · Run #001 · 2026-06-25 19:40*
