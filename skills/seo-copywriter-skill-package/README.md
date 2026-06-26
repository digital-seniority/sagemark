# SEO Copywriter — Claude Code skill (standalone package)

A self-contained Claude Code skill that turns a content client into a **published
SEO/GEO content-hub website**: the agent plans the strategy, writes the articles,
builds a brand-themed static site (mimicking the bundled reference demos, re-skinned
to the client), pulls fresh on-brand images from Pexels, and deploys it as the
client's own Vercel project.

Hand this folder (or the `.zip`) to anyone using Claude Code — nothing here is tied to
a private app or anyone else's machine.

## Install (2 minutes)

From this folder:

```bash
# 1. Install the skill into ~/.claude/skills/ (copies it + the bundled examples)
bash seo-copywriter/scripts/install-skill.sh --copy

# 2. Add your own free Pexels API key (for image fetching)
cp seo-copywriter/.env.local.example ~/.claude/skills/seo-copywriter/.env.local
#    …then edit that .env.local and paste your key (get one at https://www.pexels.com/api/)
```

Restart Claude Code, then type **`/seo-copywriter`** and name a client to begin.

> On macOS/Linux the installer uses a symlink; on Windows (Git Bash) a directory
> junction. `--copy` makes a standalone copy — the right choice when you've received
> this as a package. `--uninstall` removes it.

## What's inside

```
seo-copywriter-skill-package/
├── README.md                       ← you are here
└── seo-copywriter/                 ← the installable skill
    ├── SKILL.md                    ← the operating procedure (start here)
    ├── README.md                   ← skill docs (install, sub-skills, troubleshooting)
    ├── .env.local.example          ← Pexels key template
    ├── scripts/                    ← install-skill.sh + fetch-pexels-images.py
    ├── seo-strategist/             ← the strategy layer (core)
    ├── seo-assistant/ · seo-blog-writer/ · seo-audit/   ← optional internal "content engine" path
    └── examples/
        ├── whispering-willows-demo/        ← canonical reference demo
        └── united-active-living-demo/      ← second demo (different brand)
```

## The workflow in one line

**Strategy → author the hub (homepage + articles + FAQ + checklist, cited & schema'd) →
build a static site re-skinned to the client's brand & logo → fresh Pexels images →
deploy as the client's own Vercel project.**

Full detail in [`seo-copywriter/SKILL.md`](seo-copywriter/SKILL.md).

## Notes

- **Bring your own Pexels key** — free, instant, at <https://www.pexels.com/api/>. It
  lives in a gitignored `.env.local`; never commit it.
- **Deployment** uses the operator's own GitHub + Vercel (a one-click import at
  vercel.com/new, framework preset *Other*).
- The `seo-assistant` / `seo-blog-writer` / `seo-audit` sub-skills describe an optional
  internal "content engine" (a separate web app) and are **not required** for this
  standalone workflow — they're included for completeness.
