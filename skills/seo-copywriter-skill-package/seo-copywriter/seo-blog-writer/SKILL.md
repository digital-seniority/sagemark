---
name: seo-blog-writer
description: Grounded SEO draft generator — the second skill in the SEO Copywriter suite. Takes the extended ContentBrief from seo-assistant plus a content client and drives the apps/agents draft route to render the per-client approved voice spec to a brand guide, generate a grounded long-form draft (every stat/quote traced to a supplied source or omitted), emit [photo:]/[cta:] placeholders, and return a structured self-contained FAQ block for JSON-LD. Persists the result as a content_pieces row in draft status. Use after seo-assistant has produced a brief and before seo-audit. Hands off the extended ContentDraft to seo-audit. Kernel-backed — requires the flywheel-agents app reachable.
---

# seo-blog-writer — the grounded draft generator

You turn an extended `ContentBrief` into a **grounded, client-voiced draft** as
the second stage of the SEO Copywriter chain (`seo-assistant` → `seo-blog-writer`
→ `seo-audit`). You do not invent facts and you do not run the publish gate; you
produce the typed `ContentDraft` (with `faqData` + placeholders) that `seo-audit`
later scores and the pipeline persists as a `content_pieces` row.

**Kernel-backed.** Every step here calls the `apps/agents` content kernel (the
draft route) — you do not re-implement the LLM call, the voice-spec render, the
grounding constraint, the credit ledger, or the persistence in the skill. A
globally-invoked run therefore requires the **flywheel-agents app reachable**
(deployed or local dev). If it is not reachable, STOP and say so — do not
fabricate a draft.

## Inputs

- **brief** (required) — the extended `ContentBrief` from `seo-assistant`
  (keyword, intent locked to the dominant SERP format, sources, `dataPoints`,
  and the PR007 fields incl. `isYmyl` + signals).
- **client** (required for a client piece) — the content-client (tenant root).
  Resolves the **approved** voice spec, the link map, and the author registry.
- **audience / contentType / tone** — the draft shaping parameters.
- Optional descriptors — `brand` / `vertical` / `geo` surfaced to the writer.

## Operating procedure (abstract)

1. **Confirm tenancy + the voice-spec hard stop.** A client piece requires an
   **approved** voice spec. The route validates the client belongs to the
   operator's workspace *before any write*, then resolves the approved spec or
   **hard-stops** — there is no default-voice fall-through and no empty brand
   guide that silently no-ops the voice gate.
2. **Render the spec to a brand guide.** The approved voice spec (tone, register,
   audience, banned lexicon, attribution sources, authors/credentials, sample
   passages) is rendered deterministically to the Markdown brand guide the voice
   gate checks the draft against. You never hand-write this — it derives from the
   spec so the agentic path and the console path never fork.
3. **Drive the draft route.** Hand the brief + shaping parameters to the
   `apps/agents` draft route. It reserves the draft credits *before* generation
   and refunds them on any generation failure, then produces the long-form draft.
4. **Hold the grounding line.** Every statistic, quote, or claim must trace to a
   supplied or attributed source, or be omitted — inherited verbatim from the
   draft route. You never weaken this; an unsourced figure is dropped, not
   invented.
5. **Emit placeholders + a self-contained FAQ.** The body carries `[photo:]` and
   `[cta:]` placeholders (resolved at render, never real images/links), and a
   separate `faqData[]` of self-contained question/answer pairs whose answers
   stand alone for `FAQPage` JSON-LD and AI-answer citation.
6. **Persist + hand off.** On success the route persists a `content_pieces` row
   in `draft` status (scoped by `client_id`, with the `brief_snapshot` audit
   record + `is_ymyl`), then emits the extended `ContentDraft` to `seo-audit`.

## Handoff contract

`seo-blog-writer` → `seo-audit`: the **extended `ContentDraft`** — the grounded
body with `[photo:]`/`[cta:]` placeholders, the structured `faqData[]`, and the
persisted `content_pieces` draft row (its `brief_snapshot` is the audit trail the
gate reads). `seo-audit` scores it and, only on a PUBLISH verdict + a recorded
human release, transitions it to `published`.

## Guardrails

- **No fabrication.** The grounding constraint is inherited verbatim from the
  draft route: every stat/quote traces to a supplied or attributed source, or is
  omitted. This is never relaxed for a client voice or a YMYL topic.
- **Hard stop, not silent skip.** A client requiring a voice spec with none
  approved blocks the draft — no default voice, no empty brand guide that no-ops
  the voice gate.
- **Credits.** The draft credits are reserved before generation and refunded on
  generation failure; the ledger stays workspace-keyed.
- **Tenancy.** The client is validated against the caller's workspace *before any
  write*; the `content_pieces` row is scoped by `client_id`; a forged/foreign
  client id is rejected and never leaks.
- **Voice from the spec, not the prompt.** The brand guide is rendered from the
  per-client approved spec — never hand-authored brand values in the skill.

## judge_criteria

Abstract review criteria for a `seo-blog-writer` run (no concrete prompt
wording — the judge evaluates the *artifact + behavior*, not phrasing):

```yaml
judge_criteria:
  grounding_integrity:
    - Every statistic/quote in the body AND in every FAQ answer traces to a
      supplied or attributed source; unsourced figures are omitted, not invented.
    - The grounding constraint matches the draft route's verbatim (not weakened
      for client voice or YMYL).
  draft_shape:
    - The ContentDraft body contains [photo:] and [cta:] placeholders (resolved
      at render, not real images/links).
    - faqData[] is present with self-contained {question, answer} entries whose
      answers stand alone (no "see above") for JSON-LD.
  voice_fidelity:
    - The brand guide the voice gate ran against was RENDERED from the client's
      approved voice spec (tone/register/audience/banned-lexicon/authors), not
      hand-authored in the skill.
  hard_stop:
    - A client with no approved voice spec produced a hard stop, not a
      default-voice draft or an empty brand guide that no-ops the gate.
  credits:
    - The draft credits were reserved before generation and refunded on a
      generation failure; the ledger stayed workspace-keyed.
  persistence:
    - On success a content_pieces row was persisted in draft status, scoped by
      client_id, carrying the brief_snapshot + is_ymyl.
  tenancy:
    - The client was validated against the caller's workspace before any write;
      a foreign client id was rejected and did not leak.
  kernel_backed:
    - The run drove the apps/agents draft route rather than re-implementing
      generation/voice-render/persistence in the skill; an unreachable app
      stopped the run instead of fabricating a draft.
```
