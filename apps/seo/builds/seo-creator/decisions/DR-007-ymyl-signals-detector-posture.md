# DR-007 — ymyl-signals-detector-posture

**Date:** 2026-06-25
**Run:** #003
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.E.3 (PR 003) criterion 2 required `VETO_YMYL_MISCLASSIFIED` to fire when medical-claim
signals appear in a body whose `is_ymyl=false` (the YMYL false-negative guard). The flywheel-main
source has no body-level detector (its ymyl-classifier operates on the topic), so the agent
authored a net-new `ymylSignals` detector inside `seo-gate.ts` — a ~22-term, case-insensitive,
flat **substring** matcher using the conservative ymyl-classifier category lexicon.

The judge approved the port (5/5 process, 4/5 product) but flagged this detector as the one
place a YMYL safety miss can originate: substring matching false-positives ("therapyx",
"patient-relations-blog") and, more importantly, any medical phrasing outside the ~22-term
list is a false-NEGATIVE — a medical piece that dodges the byline veto. RFC line 458 already
mandates release-blocking change-control + golden-set re-regression for any change to the
medical detector, but that golden-set lands in a later PR.

## Problem

What posture does the interim `ymylSignals` detector commit to, and what gate governs changes
to it, given a miss is a safety failure (YMYL content published without a credentialed byline)?

## Chosen

**High-precision, deliberately-conservative-recall substring detector as the INTERIM guard,
bound to the RFC:458 change-control gate.** The detector is a backstop layered on top of the
topic-level `is_ymyl` row flag + the Stage-A `VETO_YMYL_NO_BYLINE` veto + `canPublish()`'s
credentialed-release requirement — it is not the sole YMYL control. Its recall is knowingly
incomplete; it exists to catch the obvious misclassification, not to be the authoritative YMYL
classifier.

## Consequences

- Any change to the `ymylSignals` lexicon/logic is **release-blocking change-control** and MUST
  re-regress against the YMYL golden set (RFC:458) once that golden set exists.
- The detector's recall gap is an ACCEPTED interim risk. The defense-in-depth (row `is_ymyl` +
  byline veto + credentialed-release in canPublish) means a single detector miss does not alone
  publish YMYL content without a byline — but the team should not treat `ymylSignals` as a
  complete classifier.
- **Escalation (carried to the user):** decide whether to pull the RFC:458 golden-set /
  change-control gate forward as a hard dependency before this detector is relied on in the live
  publish path, or accept the interim substring posture for Phase 0/1. (Surfaced in the run-003
  checkpoint + STATE.md.)
- Future improvement candidates (recorded, not adopted now): word-boundary/token matching,
  a scored threshold instead of any-hit, or deferring body-level detection to the topic-level
  ymyl-classifier.

## Revisit if

- The YMYL golden set lands → re-regress + potentially upgrade the detector (then supersede this DR).
- A YMYL false-negative is observed in review/production.

## Related

- Anchor: engineering-rfc.md (### PR 003 criterion 2; line 458 change-control), prd.md §YMYL, DECISIONS.md
- PR that prompted: P0.E.3 · Predecessor DRs: DR-001, DR-003 (auth seam), DR-005 (composer)

---

*Authored by /seo-creator-build · Run #003 · 2026-06-25 20:25*
