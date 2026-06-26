# DR-024 — golden-baseline-honest-all-veto

**Date:** 2026-06-26
**Run:** #012 (P0.W.5 / PR 008, after judge fix-pass)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.W.5 builds the golden-set regression harness from the Whispering Willows reference demo (`skills/seo-copywriter-skill-package/seo-copywriter/examples/whispering-willows-demo/`). The first implementation normalized em-dashes (`—`→` - `) during HTML→body extraction; the judge proved this MASKED a real `VETO_BANNED_LEXICON` Stage-A veto (the demo prose carries 8–46 em-dashes/piece; `@sagemark/core`'s banned-lexicon-linter vetoes ≥3). The fix removed the mask and re-captured the baseline from the raw bodies.

## Problem

With the mask removed, all 10 demo pieces are Stage-A-vetoed (`VETO_BANNED_LEXICON`), so the checked-in golden corpus has NO Stage-A-clean piece. How should the golden tripwire be anchored?

## Options considered

- **Option A (chosen): Score raw → honest all-veto baseline + synthesize a clean draft at test time for Stage-B drift.**
  - Pros: the corpus records exactly what the kernel emits on the source (AC3 faithful); the masking class is structurally barred (anti-masking meta-check); AC5/AC6 still exercise the full Stage-B composite + drift detection via a test-time de-slopped clean draft (kernel-confirmed clean); strictly more honest than the masked baseline.
  - Cons: no checked-in clean Stage-B regression anchor (the clean case is synthesized in-test, not stored).
- **Option B: De-slop the checked-in corpus to a clean variant.**
  - Cons: re-introduces a transform that diverges the golden from what the kernel sees on source — the exact masking the judge rejected.
- **Option C: Edit the vendored demo prose to pass the gate.**
  - Cons: vendored data is read-only/out of scope; conflates "fix the content" with "characterize the kernel."

## Chosen

**Option A** — honest all-veto baseline + test-time clean synthesis. Rationale: the golden set's job is to catch methodology drift by recording the kernel's REAL behavior; masking or editing the input defeats that. The synthesized clean draft (de-slopped real body, re-gated until clean, test-only) preserves Stage-B drift coverage without storing a sanitized corpus. The anti-masking meta-check enforces that no extraction transform changes a captured veto.

## Consequences

- Golden corpus = real kernel output on raw demo bodies (all 10 currently `VETO_BANNED_LEXICON`). Any extraction transform that changes a captured Stage-A outcome must fail the meta-check.
- AC5/AC6 clean-path coverage is a test-time synthesized draft, not a stored fixture — acceptable, documented.
- **Surfaces a cross-lane tension (active risk):** the canonical "good" reference demo is itself gate-vetoed for em-dash density. Either the demo prose needs de-slopping to pass the org's own gate, OR the banned-lexicon em-dash threshold is too aggressive for legitimate editorial prose. Cross-lane decision (content lane ↔ gate lane) — NOT resolved here.
- Expert certification of the injected LLM-gate baseline (faithfulness/voice) remains the DR-022 NEEDS-INPUT.

## Revisit if

- The cross-lane em-dash-threshold-vs-demo-prose decision lands (may add a stored clean piece).
- A real drafter's output (not the demo) becomes available as a cleaner golden source.

## Related

- Anchor sub-page: plans/seo-creator/flywheel/prd.md §12 (golden-set discipline), §14 (methodology drift)
- Predecessor DRs: [[DR-022]] (vendored suite + golden source)
- PR that prompted: P0.W.5 (PR 008)

---

*Authored by /seo-creator-build · Run #012 · 2026-06-26*
