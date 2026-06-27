---
name: seo-copywriter
description: For a content client, the agent plans the SEO/GEO content strategy, writes the articles, builds a brand-themed static content-hub website, and deploys it as its own standalone Vercel project — like the two bundled reference demos (examples/whispering-willows-demo and examples/united-active-living-demo). Lightweight and self-contained — no app, database, or operator console required (image fetching uses a Pexels API key you supply). Starts with the human-gated seo-strategist strategy layer (cluster map, gap analysis, E-E-A-T/named-author plan, conversion architecture, prioritized roadmap), then authors + ships the hub. Use when planning or producing a client's content program/hub, or when invoked as `seo-copywriter`. (The seo-assistant/seo-blog-writer/seo-audit sub-skills are an OPTIONAL internal "content engine" path that requires a separate web app and are not needed for this standalone workflow.)
---

# seo-copywriter — the suite entry

**What this skill delivers.** For a content client, this skill produces a
**publish-ready content hub, shipped as a polished standalone static website** — its
own Vercel project, exactly like the two bundled reference demos under
[`examples/`](examples/). **You, the agent, do the work directly:** plan the
strategy, write the articles, build a brand-themed static site, and deploy it. No
app, no database, no operator console — the only external dependency is a **Pexels
API key** (you supply your own; see *Image fetching* below). It is lightweight and
self-contained.

## The delivery pattern (the default)

A run produces an **operator-approved strategy** plus a **deployed static content hub**:

1. **Strategy (`seo-strategist`).** Run the strategy layer → an approved
   `ContentStrategy` (objective/audience/market, topic-cluster map across the
   funnel, gap-first competitive analysis, E-E-A-T/named-author plan, conversion
   architecture, prioritized roadmap). **Human-approved before any page is written.**
2. **Author the hub.** Write the pages the roadmap calls for — a topic-cluster
   **homepage**, the cornerstone **articles**, an **FAQ**, and a printable
   **checklist** — to the quality bar: every statistic cited to a named source (no
   fabrication), self-contained quick-answers + `Article`/`FAQPage`/`BreadcrumbList`
   schema for AI answer engines, a named-reviewer **E-E-A-T byline**, internal links
   to the pillar and to the conversion CTA, and YMYL-safe framing + a disclaimer
   where the topic warrants it. **Ground the content in the client's real
   locale/regulatory context** (e.g. Alberta continuing-care funding for a Calgary
   client — never copy another market's facts).
3. **Build the static site — re-skinned to the client's brand, NOT a clone.** Copy
   the shared template for **structure + quality** (`examples/whispering-willows-demo`
   is the canonical reference: `styles.css`, `app.js`, page structure, `sitemap.xml`,
   `robots.txt`, `images/`) but **tailor the visual style to the client's own brand so
   the result does not look like the reference demo.** Check the client's real website
   and adapt the **typography** (e.g. serif vs modern sans), the **`:root` palette**,
   the background/feel, and the button treatment — *a palette swap alone is not
   enough.* **Use the client's actual full logo**, not just a text wordmark: download
   it from their site / brand assets, place it in the brand badge (topbar + footer),
   and **check its colour treatment** — a logo with a white wordmark needs a dark
   badge; a dark logo needs a light one (inspect the SVG/PNG before assuming). Update
   NAP / phone / schema / canonical. Plain HTML/CSS/JS, no build step.
4. **Use fresh, on-brand imagery — NEVER the reference demo's photos.** Pull new,
   relevant, properly-licensed photos from the **Pexels API** for this client (e.g.
   active, vibrant imagery for an active-living brand). Run
   [`scripts/fetch-pexels-images.py`](scripts/fetch-pexels-images.py) — it reads
   `PEXELS_API_KEY` from the gitignored `.env.local` in this skill dir, takes the
   client's `images/` dir + a `{filename: search-query}` map, and downloads a landscape
   result per query (keeping filenames, so no markup changes). Pick queries that fit the
   client's vibe and **spot-check the results** (the Read tool renders images) before
   shipping.
5. **Verify.** No fabricated stats; no leaked facts *or photos* from the reference
   client; consistent header/footer/nav; no broken internal links; valid schema; renders.
6. **Ship it — to the client's existing repo if one exists, else a new one.**
   **First ask the operator: does this client already have a content-demo repo /
   Vercel project?** (Check too via `gh repo list` and the Vercel project list.)
   - **Yes →** clone/pull that repo, **add or update** the pages there, commit, and
     push — its existing Vercel project redeploys automatically. Do not create a
     duplicate site.
   - **No →** `git init` a new repo (`<client>-content-demo`), push, and deploy it as
     its own Vercel project (framework preset **Other**, no build command, output dir
     `.`) via `vercel deploy`, a one-click import at vercel.com/new, or git integration.

## Reference examples (bundled — mimic these)

Two complete, deployed worked examples ship in [`examples/`](examples/):

- **`examples/whispering-willows-demo`** — the canonical reference (a Skagit County,
  WA memory-care hub). Copy its **structure** (`styles.css`, `app.js`, the page
  shapes, `sitemap.xml`/`robots.txt`).
- **`examples/united-active-living-demo`** — a Calgary senior-living hub, re-skinned to
  a different brand (modern sans typography, navy/gold, the client's real logo) and
  re-grounded in Alberta facts. Shows what "same structure, different brand" looks like.

Same structure + quality bar; **re-skin (style + imagery + logo) and re-ground per
client** — never ship a recognizable copy of another client's demo. The two honest
pre-handoff caveats each demo carries: **swap the licensed Pexels stock photos for the
client's own real community images**, and **swap the team-placeholder byline for a
named credentialed reviewer**.

## Image fetching (Pexels)

`scripts/fetch-pexels-images.py` pulls fresh, on-brand, licensed photos from the
Pexels API. Each operator supplies their **own** Pexels key (free at
<https://www.pexels.com/api/>):

```bash
cp seo-copywriter/.env.local.example seo-copywriter/.env.local   # then paste your key
# usage: PEXELS_API_KEY=… python seo-copywriter/scripts/fetch-pexels-images.py <images_dir> '<{"file.jpg":"query",…}>'
```

`.env.local` is gitignored — never commit your key.

## The sub-skills

| Sub-skill | Role | Needed for the static-demo workflow? |
|---|---|---|
| **`seo-strategist`** | The human-gated strategy layer (Step 1) — cluster map, gap analysis, E-E-A-T/author plan, conversion architecture, roadmap. | **Yes — core.** |
| `seo-assistant` · `seo-blog-writer` · `seo-audit` | An **optional internal "content engine" path**: a kernel-backed brief→draft→audit→publish chain that drives a separate multi-tenant web app (with a Supabase store + a non-compensatory publish gate). | **No** — included for completeness; requires that internal app, which is **not** part of this standalone package. Ignore unless you have it. |

For the standalone workflow you only need **`seo-strategist`** + this parent skill;
you (the agent) author and ship the hub directly.

## Install

```bash
bash seo-copywriter/scripts/install-skill.sh --copy
```

This copies the suite (and its bundled `examples/`) into
`~/.claude/skills/seo-copywriter`, so `/seo-copywriter` and its sub-skills resolve
from any directory in Claude Code. `--uninstall` removes it. See
[`README.md`](README.md) for details.

## judge_criteria

Abstract review criteria for a `seo-copywriter` run (the judge evaluates the
*artifact + behaviour*, not phrasing):

```yaml
judge_criteria:
  strategy_first:
    - The run started at seo-strategist and produced an operator-approved
      ContentStrategy (cluster map + gap-first analysis + E-E-A-T/author plan +
      conversion architecture + prioritized roadmap) before any page was written.
  grounded_quality:
    - Every statistic traces to a named, cited source (no fabrication); content is
      grounded in the client's real locale/regulatory context; YMYL topics carry a
      named-reviewer byline + disclaimer.
  geo_ready:
    - Pages lead with self-contained quick-answers and emit Article/FAQPage/
      BreadcrumbList schema so AI answer engines can lift a clean, attributed passage.
  client_branded_not_cloned:
    - The site re-skins the reference template to the CLIENT's brand — typography,
      palette, feel, and the client's real full logo — and uses fresh per-client
      Pexels imagery; it is not a recognizable copy of another client's demo.
  shipped_standalone:
    - The result is a self-contained static site deployed as its own Vercel project
      (or added to the client's existing repo), with sitemap/robots and no build step.
```
