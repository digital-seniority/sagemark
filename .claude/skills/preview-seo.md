---
name: preview-seo
description: Ship a feature branch to preview in the Sagemark SEO repo — commit, typecheck + test, push, open a PR targeting preview, then squash-merge. Use when work is ready to land on the preview branch.
---

# Preview-SEO — Ship to Preview (Sagemark)

Ship the current feature branch to the `preview` branch for the **Sagemark SEO repo** (`C:/Users/stone/Code/sagemark`). Execute every step in order. Stop and fix if any step fails.

> Sagemark analogue of `/preview-alfred`. The everyday path to `main` is: ship to `preview` via this skill, then promote with `/promote-seo`.

## Step 1: Pre-flight

Confirm you are on a feature branch (NOT `main`, NOT `preview`). If on `main` or `preview`, STOP — ask the user which branch to use or create.

Sync with remote:

```bash
cd C:/Users/stone/Code/sagemark
git fetch origin
git rebase -X ours origin/main
```

This auto-resolves conflicts in favor of the feature branch. If the rebase still fails, resolve manually preferring the feature branch version.

## Step 2: Stage and Commit

Review uncommitted changes:

```bash
git status
git diff
```

If there are no changes to commit, skip to Step 3.

Stage relevant files (never stage `.env`, `.env.local`, or credential files):

```bash
git add <specific files>
```

Commit with a clear conventional-commit message. If `$ARGUMENTS` provided a title, use it:

```bash
git commit -m "<message>"
```

## Step 3: Typecheck + Tests

```bash
cd C:/Users/stone/Code/sagemark/apps/seo
npx tsc --noEmit
npx vitest run
```

Treat failures as blocking — fix and re-commit before proceeding. Expired-JWT tests (`bridge-auth.test.ts`, `model/proxy.test.ts`) are known-flaky; ignore only those specific 5 failures.

## Step 4: Push

```bash
cd C:/Users/stone/Code/sagemark
git push -u origin HEAD
```

## Step 5: Create PR targeting preview

```bash
gh pr create --base preview --title "<title>" --body "<summary>"
```

Use `$ARGUMENTS` as the title if supplied; otherwise derive one from the commit message.

## Step 6: Squash-Merge into preview

```bash
gh pr merge --squash --delete-branch
```

Squash-merges into `preview` and deletes the remote feature branch. Do NOT merge into `main`. Only `/promote-seo` does that.

## Step 7: Confirm

Output:

```
## Merged to Preview (Sagemark SEO)

**Branch:** <branch-name>
**PR:** <PR URL>
**Merged to:** preview (squash)
**Preview URL:** https://sagemark-seo-git-preview-digital-seniority.vercel.app
**Status:** Live on preview — run `/promote-seo` when ready for production
```
