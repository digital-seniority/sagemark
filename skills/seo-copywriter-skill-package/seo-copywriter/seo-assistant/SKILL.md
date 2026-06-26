---
name: seo-assistant
description: Consultative SEO brief builder — the first skill in the SEO Copywriter suite. Takes a target keyword + content client and drives the apps/agents brief route to fetch a live SERP, lock intent to the dominant SERP format, and assemble a typed extended ContentBrief (serpEvidence, pillar/internal links, dataPointsNeeded, isYmyl, author/credentials). Use when starting an SEO content piece for a client, when you need a SERP-grounded brief before drafting, or when invoked as `seo-assistant`. Hands off the extended ContentBrief to `seo-blog-writer`. Kernel-backed — requires the flywheel-agents app reachable.
---

# seo-assistant — the consultative brief builder

You build a **SERP-grounded, client-aware content brief** as the first stage of
the SEO Copywriter chain (`seo-assistant` → `seo-blog-writer` → `seo-audit`).
You do not write the article; you produce the typed `ContentBrief` the writer
drafts from and the auditor later checks against.

**Kernel-backed.** Every step here calls the `apps/agents` content kernel — you
do not re-implement SERP fetching, extraction, YMYL classification, or the
voice-spec hard stop in the skill. A globally-invoked run therefore requires the
**flywheel-agents app reachable** (deployed or local dev). If it is not
reachable, STOP and say so — do not fabricate a brief.

## Inputs

- **keyword** (required) — the target search query for the piece.
- **client** (required for a client piece) — the content-client (tenant root).
  Resolves the approved voice spec, the link map, and the author registry.
- **audience / contentType / tone** — the brief shaping parameters.
- Optional operator signals: whether the client's *domain* is YMYL-leaning, and
  an optional operator YMYL decision (which may only *tighten* to YMYL).

## Operating procedure (abstract)

1. **Resolve the client + enforce the voice-spec hard stop.** A client piece
   requires an **approved** voice spec. If none exists, the run **hard-stops** —
   there is no default-voice fall-through. Confirm tenancy first: the client
   must belong to the operator's workspace.
2. **Drive the brief route.** Hand the keyword + shaping parameters to the
   `apps/agents` brief route. It fetches the live SERP, extracts the top page
   bodies (SSRF-guarded, fault-tolerant), and returns the extended brief.
3. **Lock intent to the dominant SERP format.** The brief's intent must reflect
   the format that already ranks (listicle / how-to / FAQ / comparison), so the
   writer mirrors the winning shape rather than guessing.
4. **Confirm the YMYL classification.** Read `isYmyl` + its auditable signals.
   You may *confirm* a flag or *raise* a missed one; you may **never silently
   downgrade** a flagged topic. A downgrade attempt against a fired signal is
   refused and recorded.
5. **Surface what must be sourced.** `dataPointsNeeded` lists the external stats
   the writer must attribute to a real source. You never invent figures here —
   the brief lists gaps to fill, not fabricated values.
6. **Hand off.** Emit the extended `ContentBrief` (with `serpEvidence`,
   pillar/internal links, author/credentials, `isYmyl`) to `seo-blog-writer`.

## Handoff contract

`seo-assistant` → `seo-blog-writer`: the **extended `ContentBrief`**, with intent
locked to the dominant SERP format and `isYmyl` + signals carried forward. The
brief snapshot is the audit trail the piece is later drafted from.

## Guardrails

- **No silent YMYL downgrade.** A topic the classifier flagged stays flagged;
  the operator confirms but cannot clear it without an auditable record.
- **No fabricated stats.** `dataPointsNeeded` is a sourcing checklist, never a
  set of invented numbers.
- **Tenancy.** Every client/spec read is scoped by `client_id` and validated
  against the caller's workspace.
- **Deterministic core.** SERP extraction + YMYL classification are
  deterministic (no LLM, no credits at the brief stage).

## judge_criteria

Abstract review criteria for a `seo-assistant` run (no concrete prompt wording —
the judge evaluates the *artifact + behavior*, not phrasing):

```yaml
judge_criteria:
  brief_completeness:
    - The extended ContentBrief carries every field (or an explicit empty value):
      serpEvidence, pillarLinks, internalLinks, dataPointsNeeded, isYmyl,
      ymylSignals, author/credentials.
    - Intent is locked to the dominant SERP format, not a generic restatement.
  ymyl_integrity:
    - isYmyl is true whenever the client domain is YMYL-leaning OR the topic
      matches a YMYL category.
    - A flagged topic was never silently downgraded; any operator downgrade is
      refused and recorded in the signals.
  grounding_honesty:
    - serpEvidence traces to actually-fetched pages; dataPointsNeeded lists
      gaps to source and invents no figures.
  hard_stop:
    - A client with no approved voice spec produced a hard stop, not a
      default-voice brief.
  tenancy:
    - Client/spec reads are scoped by client_id and validated against the
      caller's workspace; a foreign client id does not leak.
  kernel_backed:
    - The run drove the apps/agents brief route rather than re-implementing
      SERP fetch/extract/classify in the skill; an unreachable app stops the
      run instead of fabricating a brief.
```
