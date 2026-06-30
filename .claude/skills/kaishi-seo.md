---
name: kaishi-seo
description: Session start ritual for the Sagemark SEO repo — sync local main and preview with remote, rebase the current working branch, clean up stale worktrees, and report status. Run at the beginning of every Sagemark SEO session.
---

# Kaishi-SEO (開始) — Session Start (Sagemark)

Sync local branches with remote and prepare the working environment for the **Sagemark SEO repo** (`C:/Users/stone/Code/sagemark`). Run this at the start of every session.

Keywords: kaishi-seo, start, sync, begin, session start, sagemark, seo start

Input: $ARGUMENTS (optional: branch name to rebase, or "status" for read-only check)

## Step 1: Fetch Remote

```bash
cd C:/Users/stone/Code/sagemark && git fetch origin --prune
```

## Step 2: Sync Local Main & Preview

Force-update local `main` and `preview` to match remote.

```bash
cd C:/Users/stone/Code/sagemark

CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$CURRENT" = "main" ]; then
  git checkout --detach HEAD 2>/dev/null
  git branch -f main origin/main
  git branch -f preview origin/preview 2>/dev/null || echo "WARN: preview may be checked out in a worktree"
  git checkout main
elif [ "$CURRENT" = "preview" ]; then
  git checkout --detach HEAD 2>/dev/null
  git branch -f main origin/main 2>/dev/null || echo "WARN: main may be checked out in a worktree"
  git branch -f preview origin/preview
  git checkout preview
else
  git branch -f main origin/main 2>/dev/null || echo "WARN: main may be checked out in a worktree"
  git branch -f preview origin/preview 2>/dev/null || echo "WARN: preview may be checked out in a worktree"
fi
```

## Step 3: Rebase Current Branch

If on a feature branch, rebase onto `origin/main`:

```bash
git rebase origin/main
```

If there are conflicts:
- **3 or fewer files, all in files you modified**: auto-resolve with `git rebase -X theirs origin/main`
- **More than 3 files, or conflicts in package.json/lock files**: STOP and show the user the conflicting files.

If `$ARGUMENTS` specifies a branch name, check out and rebase that branch instead.

## Step 4: Report Status

```
## Kaishi-SEO Status

| Branch  | Local   | Remote  | Status       |
|---------|---------|---------|--------------|
| main    | <sha7>  | <sha7>  | ✅ synced    |
| preview | <sha7>  | <sha7>  | ✅ synced    |
| <curr>  | <sha7>  | —       | ✅ rebased   |
```

If `$ARGUMENTS` is "status", run only Steps 1 and 4 (read-only, no mutations).

## Step 5: Read Memory

After syncing, read `C:/Users/stone/.claude/projects/C--Users-stone-Code-sagemark/memory/MEMORY.md` and summarize the last 3 notable project states so the user knows where things stand.
