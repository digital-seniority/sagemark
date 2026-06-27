# seo-copywriter skill suite

> **What you get:** for a content client, the agent plans the strategy, writes the
> articles, builds a brand-themed **static content-hub website**, and deploys it as
> its own **standalone Vercel project** — like the two bundled reference demos in
> [`examples/`](examples/). Lightweight and self-contained — **no app, database, or
> operator console** (image fetching uses your own Pexels API key).
> **Operators:** install once (below), then type `/seo-copywriter` in Claude Code.

## The deliverable: a static content hub

1. **Strategy** (`seo-strategist`) → an operator-approved `ContentStrategy`.
2. **Author the hub** — homepage + cornerstone articles + FAQ + printable checklist,
   to the quality bar (cited stats, GEO schema, E-E-A-T byline, locale-grounded).
3. **Build** a static site by mimicking the bundled reference template
   ([`examples/whispering-willows-demo`](examples/whispering-willows-demo/)) for
   *structure*, but **re-skin it to the client's own brand** — typography, palette,
   feel, and the client's **actual full logo** (download it from their site; check
   whether its wordmark is light or dark and set the badge background accordingly).
   Not just a palette swap; don't ship a clone.
4. **Fresh imagery** — pull new, on-brand, licensed photos from the **Pexels API** via
   `scripts/fetch-pexels-images.py`; never reuse the reference demo's photos.
5. **Ship it** — **ask first whether the client already has a content-demo repo/
   project.** If yes, add the pages to that repo and push (it redeploys); if no,
   create a new repo + its own Vercel project (framework **Other**, no build, output `.`).

The [`SKILL.md`](SKILL.md) holds the full operating procedure.

## Bundled reference examples

Two complete, deployed worked examples ship under [`examples/`](examples/):

- **`whispering-willows-demo`** — the canonical reference (Skagit County, WA memory
  care). Copy its structure (`styles.css`, `app.js`, page shapes, `sitemap.xml`/`robots.txt`).
- **`united-active-living-demo`** — the same structure re-skinned to a *different*
  brand (Calgary senior living: modern sans type, navy/gold, the client's real logo)
  and re-grounded in Alberta facts. Shows "same structure, different brand."

## Install

```bash
bash seo-copywriter/scripts/install-skill.sh --copy
```

This copies the suite — **and its bundled `examples/`** — into
`~/.claude/skills/seo-copywriter` (Windows: `C:\Users\<you>\.claude\skills\`), so
`/seo-copywriter` and its sub-skills resolve from any directory. `--copy` is the
right mode when you've received this as a package (it's self-contained and not a
working copy of a repo).

```bash
bash seo-copywriter/scripts/install-skill.sh --uninstall   # remove it
```

Re-running is safe — it removes the existing install before reinstalling. Restart
Claude Code afterwards (skills load at startup).

## Set your Pexels API key (for Step 4 imagery)

Image fetching needs a free Pexels key (<https://www.pexels.com/api/>). Each operator
uses their **own**:

```bash
cp seo-copywriter/.env.local.example seo-copywriter/.env.local   # then paste your key
```

`.env.local` is **gitignored** — never commit or share your key. The
`scripts/fetch-pexels-images.py` helper reads `PEXELS_API_KEY` from it.

## Invoke

```
/seo-copywriter for united-active-living   →   strategy → author the hub → themed static site → deploy
```

You (the agent) author and ship the hub directly; no external service is required
beyond the Pexels key and your own Vercel/GitHub for deployment.

## Folder contents

```
seo-copywriter/
├── SKILL.md                  # suite entry — the static content-hub operating procedure
├── README.md                 # this file
├── package.json              # metadata + install/uninstall scripts
├── .env.local.example        # template for your Pexels API key
├── scripts/
│   ├── install-skill.sh      # install into ~/.claude/skills/ (copy or symlink/junction)
│   └── fetch-pexels-images.py# fetch fresh on-brand photos from the Pexels API
├── seo-strategist/SKILL.md   # the strategy layer (core to this workflow)
├── seo-assistant/SKILL.md    # ┐
├── seo-blog-writer/SKILL.md  # ├ OPTIONAL internal "content engine" path (see note below)
├── seo-audit/SKILL.md        # ┘
└── examples/
    ├── whispering-willows-demo/      # canonical reference demo
    └── united-active-living-demo/    # second demo, different brand
```

## A note on the sub-skills

The static-demo workflow only needs **`seo-strategist`** + this parent skill — you
author and ship the hub directly. The other three sub-skills
(`seo-assistant` / `seo-blog-writer` / `seo-audit`) describe an **optional internal
"content engine"** — a kernel-backed brief→draft→audit→publish chain that drives a
separate multi-tenant web app with its own database and publish gate. That app is
**not part of this package** and isn't required; the sub-skills are included for
completeness. Ignore them unless you operate that internal engine.

## Troubleshooting

If `/seo-copywriter` doesn't appear:
1. Confirm `~/.claude/skills/seo-copywriter/SKILL.md` exists (re-run the installer).
2. Ensure the folder is named `seo-copywriter/` and contains `SKILL.md` + the sub-skill dirs.
3. Restart Claude Code (skills load at startup).
4. Fallback: point Claude at the file directly — *"Read ~/.claude/skills/seo-copywriter/SKILL.md and run me through it."*
