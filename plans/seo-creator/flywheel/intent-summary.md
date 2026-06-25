# Intent Summary — SEO Creator

*Phase 1 output. Captured 2026-06-25. Canonical state: `flywheel.manifest.json`.*

## Product

**SEO Creator** (`seo-creator`) — an **agent-driven engine that produces and governs
SEO/GEO content hubs** (a pillar page + a funnel-staged cluster of long-form,
E-E-A-T-grade guides) for agency clients, beginning in the senior-living / memory-care
vertical. It lives at **`apps/seo`** in the Sagemark monorepo.

**Positioning:** the model is the replaceable middle; the *harness* is the moat — a
non-compensatory publish gate, a cross-model faithfulness check, a fail-closed
lifecycle FSM, and per-tenant voice/corpus isolation that a "fast printer" competitor
does not ship. The deliverable is a durable, crawlable, schema-marked asset that
compounds (served to humans, search crawlers, and AI answer engines).

Reference artifact: <https://whispering-willows-content-demo.vercel.app/>

## Mode & modifier

- **Mode:** `commercial` — a going-to-market agency product with real paying clients.
- **Regulated:** `false`. The build/system processes no PHI and is in no hard
  regulatory regime. The content is YMYL (memory-care), so YMYL governance — the hard
  fail-closed gate, a credentialed reviewer, citations to named authorities,
  disclaimers — is carried as a **hard product requirement** in the PRD risk/safety
  section, not as a regulatory regime on the engineering plan. The credentialed
  reviewer gates content *publish* (a product feature), not plan approval.

## Shape

| Variable | Value | Note |
|---|---|---|
| multi_tenant | **yes** | agency serving many clients; `workspace_id` + `client_id` scoping, fail-closed RLS |
| public_by_default | **no** | system is access-controlled by default; publish is an explicit, gated, fail-closed transition (drafts/management private) |
| sensitive_pii | **no** | generates educational/marketing content; stores business data (clients, voice specs, content pieces), no individual PHI/financial records |
| existing_portfolio | **yes** | Sagemark monorepo (`apps/*`, `packages/*`, `@sagemark/core`) |
| per_customer_brand | **yes** | per-client voice specs drive tone/lexicon/facts |
| greenfield_repo | **existing** | new `apps/seo` service inside an existing pnpm+turbo monorepo |
| regulatory_regime | **[]** | none at the system level |

> Note carried into the risk section regardless of `public_by_default=no`: the brief
> route fetches the public web (DuckDuckGo scraping, D3) — a real **public ingestion
> surface** (SSRF + prompt-injection-from-fetched-pages), and published pages are a
> public output surface. Both get explicit coverage in the RFC even though the system
> is private-by-default.

## Locked product decisions carried in (from `../DECISIONS.md`)

D1 full autonomous loop · D2 hard fail-closed gate · D3 keep free DDG scraping (with
the D2×D3 grounding tension instrumented) · D5 **Claude Agent SDK self-hosted worker**
· D7 generate the hub homepage in v1 · D9 **Vercel Sandbox** as the worker host.
Deterministic engine (`seo-gate`, `lifecycle-fsm`, 22 scorers, `content_pieces`
schema) is **ported** from flywheel-main `origin/preview`, not reinvented.

## Runtime

- **Profile:** `claude-code` · **Platform:** `win32`
- **Capabilities:** background_subagent, ask_user_question, edit_tool, worktree,
  web_fetch, fs, gh, mcp, schema_validation, computer_use

## Output

`C:\Users\stone\Code\sagemark\plans\seo-creator\flywheel\`

## Bible

agentic-bible **v1.0.0** (all chapters at sha `2c02fe80`). Pre-load set for this shape
recorded in the manifest (`research.bible_chapters_loaded`).
