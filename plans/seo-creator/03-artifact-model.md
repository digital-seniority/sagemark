# The Output Artifact

The Sagemark SEO Creator does **not** produce a website. It produces a **multi-page SEO/GEO content hub**: one *pillar* page plus a *cluster* of long-form, E-E-A-T-grade guides, internally linked across the buyer funnel (Awareness → Consideration → Decision), each one engineered to be read by four consumers at once — humans, Google's crawler, AI answer engines (GPTBot / ClaudeBot / PerplexityBot), and the agency's own future RAG.

The ground truth for "done" is the live demo at `https://whispering-willows-content-demo.vercel.app/`: a memory-care provider's resource library — a pillar ("Memory Care in Skagit County, WA") surrounded by ~8 funnel-staged guides ("Memory Care vs. Assisted Living", "Paying for Memory Care", "Signs It's Time", "12 Questions to Ask", "10 Early Signs of Dementia", an FAQ, and a printable "12-Question Tour Checklist"), all carrying a named credentialed byline, source-grounding to the Alzheimer's Association / NIA, a medical disclaimer, and a DSHS license badge.

The unit is a **content piece**. The deliverable is a **cluster of pieces forming a hub**. Everything else in this document — the data shape, the gate, the render route, the fine-tune loop, the export surface — exists to produce and govern that one artifact.

This is a different artifact from the removed retirement-pilot brochure site. A brochure is single-tenant marketing copy with no cluster model, no gate, and no YMYL governance. This artifact *is* the gate, the cluster, and the governance — they are intrinsic, not decoration.

---

## 1. The two-level shape: hub → piece

```
ContentHub (a cluster — a strategy artifact + a render template, NOT one table)
 ├─ pillar piece            "Memory Care in Skagit County, WA"   (clusterRole=pillar)
 ├─ cluster guide (spoke)   "Memory Care vs. Assisted Living"    (funnelStage=awareness)
 ├─ cluster guide (spoke)   "Signs It's Time for Memory Care"    (funnelStage=consideration)
 ├─ cluster guide (spoke)   "Paying for Memory Care: Medicaid"   (funnelStage=consideration)
 ├─ cluster guide (spoke)   "Choosing Memory Care: 12 Questions" (funnelStage=decision)
 ├─ FAQ piece               "Memory Care FAQ"                    (clusterRole=faq)
 └─ checklist piece         "12-Question Tour Checklist"         (clusterRole=checklist)
```

The **hub is not a database table** in the ported engine — it is a *strategy-layer* artifact (the `seo-strategist` `ContentStrategy`: a topic-cluster map of pillar + cornerstones + funnel-staged spokes with explicit spoke→pillar link edges). Cluster membership rides along in each piece's `brief_snapshot` and is physically realized as internal links in the markdown body, plus a curated resource-library homepage that the engine on `origin/preview` **does not yet render**.

**Decision — promote `clusterRole` and `funnelStage` to first-class columns on `content_pieces` in Phase 1.** *Rationale:* the demo's homepage (the three-stage cluster section, the guide-card grid) and a related-guides nav need a queryable hub graph; the current schema persists neither the role nor the pillar↔spoke edge, so they cannot drive a template. *Alternative considered:* keep them in `brief_snapshot` jsonb as today — rejected because you cannot build a homepage or a related-guides rail off a value buried in an unindexed jsonb blob, and the demo homepage is squarely in scope. This is the single schema change the artifact model forces on the ported engine (see §10).

---

## 2. The piece data shape

The piece is a `content_pieces` row (ported verbatim from `packages/schema-flywheel/drizzle/0030_content_pieces.sql`, `origin/preview`). The persisted columns are the contract — the Creator never invents fields the render route can't read:

| Field | Type | Role in the artifact |
|---|---|---|
| `id` | uuid | identity |
| `client_id` | uuid → `content_clients` ON DELETE RESTRICT | **tenancy boundary** — a piece is always owned by exactly one client |
| `slug` | text, UNIQUE per client | public URL segment; `(client_id, slug)` is unique |
| `title` | text | H1 + SEO/OG title |
| `body` | text (markdown) | the article — full long-form prose with H2/H3 headings, lists, tables, internal links, and `[photo:…]` / `[cta:…]` placeholders |
| `excerpt` | text | card summary on the hub homepage |
| `meta_description` | text | the SEO `<meta>` + SERP snippet |
| `status` | enum `draft·review·approved·published·archived` | lifecycle state (§6) |
| `version` | integer | monotonic; bumped on every forward FSM move |
| `is_ymyl` | boolean | persisted at brief time from auditable `ymylSignals`; read **authoritatively** at gate/FSM time, never re-derived |
| `author_id` | uuid (soft ref into voice-spec author registry) | the E-E-A-T named byline |
| `eval_score` | integer (nullable) | Stage-B composite 0–100; **null when a Stage-A veto fired** |
| `verdict` | enum `PUBLISH·REVIEW·REVISE·REJECT` | gate outcome |
| `dimensions` | jsonb | the 8-dimension scorecard |
| `faq_data` | jsonb | the FAQ entries → `FAQPage` JSON-LD |
| `brief_snapshot` | jsonb | the grounding brief: sources, entities, `clusterRole`/`funnelStage` context, `assets`/`ctas` for placeholder resolution |
| `published_at` | timestamptz | render ordering + sitemap |

What this shape gives you, mapped to the demo's intrinsic requirements:

- **Sections / headings / key-takeaways** — live in `body` as markdown structure (H2 question-style headings with answer-first capsules below each, the GEO on-page pattern the gate scores).
- **FAQ** — `faq_data` jsonb, rendered to schema.org `FAQPage` JSON-LD at render time (`buildFaqJsonLd`).
- **Citations / source-grounding** — `brief_snapshot.sources` is the grounding contract; the faithfulness gate verifies every claim traces to one of them ("every figure traces to a named authority").
- **Named byline + credentials** — `author_id` resolves to `voice_specs.spec.authors[]` (each `{id, name, credentials}`). This is the E-E-A-T accountable byline.
- **Disclaimers / trust badge** — disclaimer text and the license badge ("Deficiency-free 2025 Washington State DSHS annual inspection · License #2726") are voice-spec / brief-snapshot data resolved into the body, not free-floating prose.
- **SEO meta + schema** — `meta_description` + `title` drive `<meta>`/OG; `faq_data` drives JSON-LD.
- **Internal links** — markdown links in `body`, sourced from the voice spec's `pillarLinks` / `internalLinks` so a spoke is *never* an orphan by construction.
- **Reading-grade control** — not a stored field; a *gate dimension*. Flesch-Kincaid runs deterministically (`apps/agents/src/lib/content/flesch-kincaid.ts`) as part of the readability sub-score, keeping the demo's "jargon-light, reassuring, never alarmist" tone honest.

---

## 3. Piece archetypes

Four archetypes, distinguished by `clusterRole`. They share the same row shape and the same gate — the archetype tunes the **brief template and the gate emphasis**, not the storage.

| Archetype | `clusterRole` | What it is | Gate emphasis |
|---|---|---|---|
| **Pillar** | `pillar` | The hub's anchor — broad, geo-targeted, links out to every spoke ("Memory Care in Skagit County, WA"). | Structure + internal-link completeness (every spoke must have ≥1 inbound link). |
| **Cluster guide (spoke)** | `cornerstone` \| `spoke` | A funnel-staged long-form guide. The workhorse. | Faithfulness + GEO citation + E-E-A-T (the dominant dimensions). |
| **FAQ** | `faq` | A question-set piece; the highest-density `FAQPage` JSON-LD surface. | GEO self-containment (each answer must stand alone for an AI quote). |
| **Checklist** | `checklist` | A scannable, printable decision aid ("12-Question Tour Checklist"). | Structure + conversion architecture; relaxed prose-length floor. |

*Decision:* archetype is a **first-class column**, not an inferred attribute. *Rationale:* the homepage groups by funnel stage and labels role; the related-guides nav needs role to pick siblings; the checklist needs a relaxed thin-content floor that the gate must key off a known role rather than guessing. *Alternative:* infer role from word count / structure — rejected as fragile and unqueryable.

There is **no separate "printable PDF" artifact type**. The demo's printable checklist is just a `checklist` piece rendered as HTML; a print/PDF leave-behind is a *secondary export* (§8), not a distinct artifact.

---

## 4. Storage & versioning

System of record is **Supabase Postgres**, mirroring the `origin/preview` Drizzle schema — *not* the shipped wizard's `localStorage` (`library.ts`, cap 50), which cannot do multi-tenant agency work and whose cross-tenant leakage is the flagged agency-ending bug.

Three tables carry the artifact:

- **`content_clients`** — the tenant root: `name`, `blog_slug` (UNIQUE, the public URL namespace), `workspace_id` (the workspace→client bridge). Deliberately separate from the accounting `clients` table.
- **`content_pieces`** — the piece (§2).
- **`content_piece_versions`** — immutable forward-move snapshots: `{piece_id, client_id, version, body, dimensions, verdict, snapshot_at}`. Written **before every forward FSM move** (`requiresSnapshot()` in `lifecycle-fsm.ts` defines exactly three: draft→review, review→approved, approved→published).

**Tenancy is fail-closed RLS, not application convention.** From the ported migration: RLS is enabled on all three content tables; the *only* anon policy is `content_pieces_public_read` — `FOR SELECT TO anon USING (status = 'published')`. `voice_specs` and `content_piece_versions` have **no anon policy at all** (drafts, scorecards, and brand voice are never publicly readable). Every operator query runs service-role and scopes by `workspace_id`/`client_id`. The version table denormalizes `client_id` specifically to keep a future tenant-RLS path open.

*Versioning model:* the engine favors **regenerate-and-resnapshot over field-level diffs**. The body is a single markdown text edited in place while `status='draft'`; re-auditing re-runs the full gate and writes a new immutable version + bumps `version`. A "client-approved" state is a **named, undeletable version** recording approver identity (which also supplies the E-E-A-T byline for the audit trail).

---

## 5. How it's rendered — the SSR route

The published artifact is served at **`/clients/[client]/blog/[slug]`** (`apps/site/src/app/clients/[client]/blog/[slug]/page.tsx`, `origin/preview`). The render contract is non-negotiable and CI-gated, because **CSR is lethal to the entire GEO thesis** — AI answer crawlers largely do not execute JavaScript, so a client-rendered body is simply absent from the indexes that feed ChatGPT / Perplexity / Claude.

The route, exactly as ported:

1. Resolves `<client>` → `content_clients.blog_slug` → `client_id` (`getClientByBlogSlug` in `apps/site/src/lib/client-blog.ts`). A slug from another client resolves to `null` and **404s** — it can never render under the wrong namespace.
2. Fetches the piece scoped by `(client_id, slug, status='published')`. The `status='published'` filter is load-bearing: draft/review/approved/archived rows are never returned to the public surface.
3. Renders the **full body in the initial server HTML** (`remark` + GFM + `remark-html`, `dangerouslySetInnerHTML`) — no client-side fetch.
4. Emits schema.org **`FAQPage` JSON-LD** from `faq_data` via `buildFaqJsonLd()`.
5. Resolves `[photo:slug]` / `[cta:type]` placeholders from `brief_snapshot.assets`/`.ctas`; **unresolved tokens are stripped, never leaked** as literal `[photo:…]` text.
6. Per-client **`sitemap.xml`** (`force-dynamic`, lists only published rows) + **`robots.txt`** complete the crawl surface.

**The gap to close — the resource-library homepage.** The ported engine renders *individual pieces + sitemap*. It does **not** render the demo's curated homepage: the hero ("Clear answers for the hardest decision you'll make"), the 7.2M-statistic callout, the explicit three-stage cluster section, the guide-card grid ("Read the guide"), the quality section, and the tour CTA with phone + address + license badge. That homepage is the *hub-as-an-artifact*, and it is **net-new build** (Phase 3), fed by the `clusterRole`/`funnelStage` columns promoted in §1. Until it exists, the deliverable is a flat list of pieces — not the hub the artifact ground-truth requires.

---

## 6. Lifecycle & the gate that attaches to it

The artifact's spine is a **fail-closed lifecycle FSM** (`lifecycle-fsm.ts`, pure, no I/O, exhaustively unit-tested):

```
draft ─→ review ─→ approved ─→ published ─→ archived
  ↑         │          │            │
  └─revise──┘     (unpublish reverts render)      archived = terminal
```

`canPublish()` permits `published` **only** when the publish kill-switch is on **AND** `verdict==='PUBLISH'` **AND** `evalRan===true` **AND** a recorded `humanRelease` exists **AND** (if `is_ymyl`) a named author + credentials + citations are present. A skipped/thrown/timed-out eval **blocks** (this fixes the NextSchool ER-4 non-fatal-publish bug). There is no autopilot. Rejections return stable machine codes (`ILLEGAL_EDGE`, `EVAL_DID_NOT_RUN`, `NO_HUMAN_RELEASE`, `YMYL_NO_BYLINE`), never prose.

**The non-compensatory gate** (`seo-gate.ts`) is what makes each piece an *asset, not slop*. It runs in two strictly ordered stages:

**Stage A — ordered hard vetoes.** The first veto short-circuits to `REJECT/REVISE`, sets `score=null`, and **the Stage-B composite is never computed**. The exact ported order:

1. `VETO_BROKEN_CHUNK` — information-island / unrenderable chunk
2. `VETO_UNSOURCED_STAT` — faithfulness `UNFAITHFUL`, or any `UNSOURCED`/`CONTRADICTED` claim; **for a YMYL piece, a *skipped* faithfulness gate is itself a hard block** (you cannot publish a memory-care claim you could not verify)
3. `VETO_KEYWORD_STUFF` — keyword-density `status==='stuffed'`
4. `VETO_YMYL_NO_BYLINE` — YMYL piece without a named author + credentials
5. `VETO_YMYL_NO_REVIEW` — YMYL piece without a recorded human review
6. `VETO_THIN_CONTENT` — originality (`Content Density`) at the floor (≤20)
7. `VETO_BANNED_LEXICON` — AI-slop / client banned terms
8. `VETO_VOICE_FAIL` — brand-voice contradiction
9. `VETO_EVAL_FAILED` — any deterministic scorer threw (fail-closed)

**Stage B — only if Stage A is clean.** An 8-dimension weighted 0–100 composite → `PUBLISH ≥85 / REVIEW 70–84 / REVISE 50–69 / REJECT <50`. The weights (`STAGE_B_WEIGHTS`) sum to exactly 1.0 with **faithfulness strictly heaviest (0.20)** — the confident-but-wrong / CNET failure is the costliest. Exact magnitudes are config (OQ-3 open), the faithfulness-strictly-max invariant is fixed.

| Dimension | Weight | What it scores |
|---|---|---|
| faithfulness | 0.20 | every claim traces to a brief source (cross-model: sonnet drafter vs haiku verifier) |
| voice | 0.15 | adherence to the approved voice spec |
| geo | 0.15 | answer-first capsules, quotable fact sentences, self-contained FAQ answers |
| readability | 0.10 | Flesch-Kincaid grade control |
| keyword | 0.10 | density without stuffing |
| structure | 0.10 | headings, lists, internal links |
| originality | 0.10 | unique data / non-duplicate |
| eeat | 0.10 | byline, credentials, disclaimer, trust signals |

**Where the gate lives relative to the agent (non-negotiable):** Stage-A vetoes and `canPublish()` are enforced in **host code outside the agent loop**. The agent gets a **read-only `runGate` tool** only. *Rationale:* a perfect eval score makes a draft *eligible*, not *published*; if vetoes lived inside the LLM loop, a persuasive fine-tune instruction ("just drop the disclaimer") could talk past a YMYL/faithfulness/thin-content veto. Hard gates are un-overridable canon; per-client thresholds and voice are instance overrides.

---

## 7. How a section is partially edited / regenerated (fine-tune)

Editing is legal **only while `status='draft'`**. The body is single markdown text; the model favors regenerate-and-resnapshot over field-level section diffs.

The fine-tune loop, ported and adapted from videogen's chat-edit (`apps/agents/src/app/videogen/api/chat-edit/route.ts`):

1. An instruction ("soften the dementia-signs intro", "add a Medicaid eligibility table", "drop the alarmist line in section 03") arrives — typed in chat **or** routed automatically from a client's "Request changes" comment.
2. The agent emits a **bounded body diff** scoped to the named markdown region (an SEO-specific constrained-edit contract — *not* videogen's scene-prop diff, which does not generalize to markdown).
3. The diff is applied as a **new auto-version** (`content_piece_versions` snapshot + `version` bump), guarded by **SHA-256 stale-edit check (409)** + **per-tenant rate limit (429)** + **workspace-ownership check (403)**.
4. **The full gate re-runs** on the edited body. A fine-tune that breaks faithfulness or trips a Stage-A veto **cannot advance toward publish** — the edit is recorded as a version, but the verdict gates release.
5. The agent streams a one-line "what changed" summary into the activity feed.

The N=3 audit→revise cap (`MAX_REVISE_CYCLES`) applies; the 4th failure holds the piece at `review` (`forcedToHumanReview`). Every edit is an auditable, reversible version — feedback becomes a diff, not an email.

---

## 8. Export & handoff

The **primary deliverable is the rendered hub itself** — there is no file export in the engine's critical path. Handoff happens at three granularities:

| Surface | What it is | Who it's for |
|---|---|---|
| **Tokenized hosted live preview** | The actual SSR-rendered piece/hub in a same-origin sandboxed iframe, scoped to exactly one client's page/version, paired with a SERP-snippet preview | **Client review** — judged exactly as Google / readers / AI crawlers see it (full-body HTML, FAQ JSON-LD, the resource-library homepage). The client surface is deliberately separate from the operator surface: no credits, no Improve-Draft, no raw markdown. |
| **Published web hub** | The live `/clients/[client]/blog/[slug]` pages + sitemap + robots | **Crawlers + the public** — this is the crawlable, schema-marked asset the GEO thesis targets. |
| **Markdown / HTML / print** | `body` markdown, rendered HTML, or a print-styled `checklist` piece (the "12-Question Tour Checklist" leave-behind) | **Secondary** — a CMS paste or a PDF leave-behind, never the review surface (a client can't judge a raw `.md` file the way Google will). |

The client review surface carries two feedback granularities on the preview itself: free-form **pinned comments** anchored to page elements (reusing videogen's `PinOverlay` + `PreviewClickHandler` + `useIframePinDrop`) and section-level **Approve / Request-changes** verbs on each H2 (reusing `ApprovalBeat`). A "Request changes" comment routes straight into the §7 edit loop. **Client approval is advisory on hard gates** — a client can never approve past a YMYL / faithfulness / thin-content veto, which stays canon held by the credentialed reviewer.

---

## 9. Reusable template vs client-specific content

The architecture splits cleanly into a shared engine and per-tenant data. This split is what lets the moat compound per client while the engine is built once.

| Reusable TEMPLATE / platform primitive (shared) | Client-specific CONTENT (per-tenant data) |
|---|---|
| The 22 deterministic scorers (`apps/agents/src/lib/content/*`: flesch-kincaid, keyword-density, passive-voice, content-score, broken-chunk-linter, banned-lexicon-linter, geo-citation, faq/meta/og generators) | The `content_clients` row (name, `blog_slug`, workspace) |
| The non-compensatory gate composer (`seo-gate.ts`) + failure codes | The `voice_specs` row: tone, register, audience, `bannedLexicon`, `authors[]` registry, `pillarLinks`, `internalLinks`, `attributionSources`, `samplePassages` |
| The fail-closed FSM (`lifecycle-fsm.ts`) | The `content_pieces` (the actual articles) + their `content_piece_versions` |
| The cross-model faithfulness gate (sonnet drafter ≠ haiku verifier — an invariant; collapsing it makes the gate a self-consistency check) | The `is_ymyl` flag + `ymylSignals` per piece |
| The SSR render route + prose theme (`@flywheel/ui-marketing` Container) + JSON-LD builder + sitemap/robots | The cluster map / `ContentStrategy` (pillar + funnel-staged spokes) |
| The four producer prompts (strategist / assistant / writer / audit), re-authored as AI SDK v6 system prompts + typed tools | Per-client gate-threshold and voice instance overrides (which never touch hard-gate canon) |
| The net-new resource-library homepage template (Phase 3) | The hero copy, statistic callout, guide cards, tour CTA, license badge — *data fed into* the homepage template |

**How the voice spec attaches.** `voice_specs` is per-client JSONB (`VoiceSpecV1`). A row with `approved_at IS NULL` is a **draft**; `requireApprovedVoiceSpec()` is a **HARD STOP** — the pipeline refuses to generate for a client with no approved spec (no default-voice fallback). The spec feeds the gate two ways: `bannedLexicon` extends the built-in slop floor that the `VETO_BANNED_LEXICON` veto checks, and a brand-style-guide markdown rendered from the spec feeds the LLM voice gate. The `authors[]` registry (`{id, name, credentials}`) is the byline source `author_id` resolves to.

**How the gate attaches.** The gate is engine-agnostic and runs as a host-side primitive at the `review` boundary; the FSM consults its `verdict`/`evalRan` outputs at the `published` boundary. Neither lives in the agent loop. Per-client data tunes only the soft dimensions and the `bannedLexicon` extension; the Stage-A veto order and `canPublish()` are read-only canon.

---

## 10. Relation to the Whispering Willows demo, and the gap to close

The demo *is* the golden set. Capture it as a human-labeled reference **before any prompt is written** (Phase 0) so methodology-fidelity regression — the re-authored prompts quietly producing lower-quality content than the original SKILL.md harness, invisible to CI — is caught on every prompt/model bump.

What the ported engine already produces toward the demo:

- ✅ The piece shape (E-E-A-T markdown + meta + faq_data + scorecard + brief_snapshot).
- ✅ The non-compensatory gate, the fail-closed FSM, the cross-model faithfulness gate.
- ✅ Per-client SSR render with full-body HTML + `FAQPage` JSON-LD + placeholder stripping + sitemap/robots.
- ✅ The YMYL governance (named byline + credentials + citations + recorded human review, all veto-enforced).

**The gaps to close to reach demo quality:**

| Gap | Why it matters | Phase |
|---|---|---|
| **Resource-library homepage** | The demo's hub homepage (hero, 7.2M statistic, three-stage cluster section, guide-card grid, quality section, tour CTA + license badge) is **not rendered** by the engine, which ships individual pieces + sitemap only. This is the hub-as-artifact. | 3 |
| **`clusterRole` / `funnelStage` as first-class columns** | The pillar↔spoke edge and funnel stage live only in `brief_snapshot` jsonb — you cannot drive a homepage or related-guides nav off them. Promote to indexed columns. | 1 |
| **YMYL byline trust hole** | The `origin/preview` publish path trusts `request.author` rather than resolving `author_id` → voice-spec registry server-side. For memory-care content an uncredentialed byline could ship. Close it: resolve the byline from persisted data at publish. | 3 |
| **Render-surface test coverage** | `apps/site` has **no vitest** and the 24 client-blog render tests were omitted. Placeholder stripping, JSON-LD, and `status='published'` filtering are under-tested — and a single CSR slip makes the body invisible to AI crawlers. Harden behind a CI reachability gate (sitemap == published-and-indexable set, both directions) before any client depends on it. | 3 |
| **Grounding quality** | Faithfulness is bounded by `brief.sources`, which today is 3 DuckDuckGo-scraped pages (first 2000 chars each). The demo's "every figure traces to a named authority" bar needs better retrieval. | open decision (budget/key) |

The artifact is not the words. The words are the replaceable middle. The artifact is the **governed, crawlable, versioned, per-tenant hub** — the gate, the grounding contract, the fail-closed FSM, the SSR surface, and the cluster graph. Build those first; the prose is bookkeeping once the brief and the gate are right.
