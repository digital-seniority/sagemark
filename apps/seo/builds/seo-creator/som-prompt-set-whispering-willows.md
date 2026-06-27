# Share-of-Model prompt-set — Whispering Willows of Mount Vernon

**Status:** APPROVED INPUT (James, 2026-06-26) for **P1.C.4** (PR 021 — SoM citation-ingestion cron). Engines: ChatGPT · Claude · Gemini via the AI Gateway ([[DR-038]]). Each row → a `share_of_model.query`, run per engine on the cron; we record `cited` / `position` for the brand/domain.

**Client:** Whispering Willows of Mount Vernon — Specialized Memory / Dementia Care.
**Geo:** Mount Vernon, WA + the Skagit Valley / Skagit County, **including nearby towns** Burlington, Anacortes, Sedro-Woolley (+ La Conner). Most prompts are localized — local intent is where one community wins citations.
**Cite target (a "cited" hit):** the answer names **`Whispering Willows of Mount Vernon`** OR **`Whispering Willows`** OR links **`whisperingwillows.com`** (confirmed from the live site). Match case-insensitively; "Whispering Willows" alone counts (disambiguate by the Mount Vernon / memory-care context).
**Source:** site = https://www.whisperingwillows.com/ (homepage, /dementia-care, /community). Cluster = `apps/seo/golden/whispering-willows/`.
**Cadence:** ingestion cron + freshness cron; same prompt text to all 3 engines.

---

## Awareness  (pillar `memory care`, spoke-early-signs `early signs of dementia`, faq)
1. What are the early signs of dementia in an aging parent?
2. How do I know if my mom has dementia or just normal aging?
3. What is memory care and how is it different from a nursing home or assisted living?
4. Memory care and dementia resources for families in Skagit County, WA
5. Where can I learn about dementia care options near Mount Vernon, WA?

## Consideration  (vs-assisted-living, cost, signs-its-time, guilt)
6. What's the difference between memory care and assisted living?
7. When is it time to move a parent with dementia into memory care?
8. How much does memory care cost in Skagit County / Washington state?
9. How do families pay for memory care (Medicaid, VA benefits, long-term-care insurance) in WA?
10. Is it normal to feel guilty about moving a parent to memory care?
11. What should a good memory care community provide for someone with Alzheimer's?

## Decision  (location + choosing — highest SoM value)
12. Best memory care communities in Skagit County, WA
13. Memory care facilities in Mount Vernon, WA
14. Memory care near me in the Skagit Valley
15. Memory care in Burlington / Anacortes / Sedro-Woolley, WA
16. Dementia / Alzheimer's care communities near Mount Vernon that accept Medicaid
17. What should I look for — and what questions should I ask — when touring a memory care community in the Skagit Valley?
18. Specialized dementia care communities in Skagit County, WA

## Competitor-comparison  (James: include — uses real nearby competitors)
19. Whispering Willows of Mount Vernon vs Lighthouse Memory Care (Anacortes) — which memory care is better?
20. Whispering Willows vs Birchview Memory Care (Sedro-Woolley) for dementia care
21. Whispering Willows vs Where The Heart Is (Burlington) memory care
22. Best memory care in Mount Vernon: Whispering Willows vs The Bridge vs Fairmont Manor
23. How does Whispering Willows of Mount Vernon compare to other memory care communities in Skagit County?

## Brand-entity  (direct engine recall)
24. Is Whispering Willows of Mount Vernon a good memory care community?
25. Tell me about Whispering Willows memory care in Mount Vernon / Skagit County.
26. What do reviews say about Whispering Willows of Mount Vernon?

## Retention / post-decision  (James: keep)
27. How do families stay involved after a parent moves into memory care?
28. What support do memory care communities offer families of dementia residents?

---

### Field mapping (P1.C.4 ingestion)
Per row, per engine: `query` (normalized prompt) · `engine` (chatgpt|claude|gemini) · `cited` (brand/domain present?) · `position` (citation rank) · `cluster`/`piece_id` (the spoke it supports, for per-hub rollup) · `source_channel`='direct' · `locale`/`captured_at`. The brand/domain match list above is the `cited` oracle.

### Notes
- 28 prompts (was 25) — added the competitor set + a nearby-towns decision prompt; retention kept. Trim/extend per cost vs coverage.
- Competitor names are point-in-time (verified 2026-06; re-confirm on the freshness cron — facilities open/close).
- Brand confirmed live: "Whispering Willows of Mount Vernon" / "Whispering Willows" / whisperingwillows.com.
