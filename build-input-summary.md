# Build-flywheel input summary

**Input kind:** plan_flywheel_output (best case)
**Input path:** C:/Users/stone/Code/sagemark/plans/seo-creator/flywheel/
**Output dir:** C:/Users/stone/Code/sagemark/plans/seo-creator/build/
**Agent:** SEO Creator (slug: seo-creator) → emits `/seo-creator-build`

**Detected files:**
- flywheel.manifest.json — canonical plan state (status=complete, mode=commercial, trust 0.85)
- prd.md — strategic + product spec (17 sections, 47 bible cites)
- engineering-rfc.md — technical RFC; **23 PR slices** (`### PR 000`–`### PR 021` incl. `006b`) across 6 lanes
- journeys.md — 12 behavioral journeys (Phase-1 ship gate)
- HANDOFF.md — engineering summary

**Plan-manifest:** flywheel.manifest.json (schema 1.0)
**Shape variables seeded:** 7 / 7 (from plan manifest — no gaps)
**RFC PR slices found:** 23 (drives initial pr_map[] size)
**JOURNEYS scenarios found:** 12

**Lanes (from RFC §5):** engine-port · worker-runtime · schema-tenancy · agent-ui · render-geo · client-review

**Key build facts to honor:**
- Run the existing `seo-copywriter` suite skills DIRECTLY via a Claude Agent SDK worker on Vercel Sandbox (seo-strategist → seo-assistant → seo-blog-writer → seo-audit).
- PORT the deterministic kernel + stand up the `/content/api/{brief,draft,audit,publish}` route contract in `apps/seo` (from flywheel-main origin/preview) — do not reinvent.
- The non-compensatory gate is host-enforced; the agent has no publish tool.

**Compile state:** seeded → discovery
