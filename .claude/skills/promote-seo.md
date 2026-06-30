---
name: promote-seo
description: Production promotion for the Sagemark SEO repo — open a PR from preview to main and merge it with a merge commit (history preserved). ALWAYS lists every commit being released and REQUIRES explicit user confirmation first. Use when the user wants to promote preview to production main.
---

# Promote-SEO — Promote preview → main (Sagemark)

Promote the full `preview` branch to production `main` for the **Sagemark SEO repo** (`C:/Users/stone/Code/sagemark`, remote `digital-seniority/sagemark`). This is a **production release**. Execute in order; the confirmation gate in Step 2 is mandatory and must never be skipped.

> Sagemark analogue of `/promo-alfred`. The everyday path is: ship to `preview` via `/preview-seo`, then promote here.

## Step 1: Pre-flight — show exactly what will be released

```bash
cd C:/Users/stone/Code/sagemark
git fetch origin
echo "Commits preview is ahead of main:"
git rev-list --count origin/main..origin/preview
git log --oneline origin/main..origin/preview
```

Read the list carefully. Promotion releases **every one of these commits** to production, not just the most recent work.

**Watch for parallel activity:** `preview` is a shared branch and may have advanced from other sessions. If the list contains commits you don't recognize or that look unrelated to the user's intent, call them out explicitly before proceeding.

If `git rev-list --count origin/main..origin/preview` is `0`, there is nothing to promote — stop and say so.

## Step 2: Confirmation Gate (MANDATORY)

Present the user a concise summary of what promotion will release:
- the commit count,
- a grouped, plain-English summary of what's in the set (features, migrations, env var changes, anything risky),
- an explicit note that this goes to **production `main`** (sagemark-seo.vercel.app).

Then **STOP and require explicit user confirmation.** Do not promote on an implied or stale "yes."

If the user only wants a **subset** on `main`, this is NOT a promotion — instead cut a branch from `main`, cherry-pick those files, and open a PR `<branch> → main` directly. Offer that as the alternative.

## Step 3: Create the Promotion PR

```bash
gh pr create --base main --head preview \
  --title "Promote preview → main (<N> commits)" \
  --body "<grouped summary of what's being released>"
```

## Step 4: Merge with a Merge Commit (preserve history)

```bash
gh pr merge <pr-number> --merge
```

Use `--merge`, **not `--squash`** — squashing would collapse all of `preview`'s history into a single opaque commit on `main`.

If branch protection blocks the merge, report what's blocking. Do **not** bypass with `--admin` unless the user explicitly asks.

## Step 5: Verify

```bash
cd C:/Users/stone/Code/sagemark
git fetch origin
echo "Content parity (expect 0):"; git rev-list --count origin/main..origin/preview
echo "main HEAD:"; git log --oneline -1 origin/main
```

`origin/main..origin/preview` should be `0`. It's normal for `main` to be 1 commit ahead of `preview` — that's the merge commit itself.

## Step 6: Confirm

Output:

```
## Promoted to Production (Sagemark SEO)

**PR:** <PR URL>
**Released:** <N> commits (preview → main, merge commit)
**main HEAD:** <hash + subject>
**Production URL:** https://sagemark-seo.vercel.app
**Parity:** preview content == main
**Note:** <anything to watch post-release — new env vars, migrations, snapshot rebuilds, etc.>
```

## Notes

- Promotion does **not** re-run the full test suite; promoted commits carry whatever status they earned when each PR merged into `preview`.
- **Worker snapshots:** if the worker bundle changed (apps/seo/src/worker/**), the Vercel Sandbox snapshot needs to be rebuilt. Call this out explicitly in the confirmation step.
- Never promote with uncommitted local changes you assume are on `preview` — only what's on `origin/preview` gets released.
- **Env vars via REST API only.** Never set Vercel env vars via `"val" | vercel env add` (injects a U+FEFF BOM). Use the Vercel REST API with a JSON body.
