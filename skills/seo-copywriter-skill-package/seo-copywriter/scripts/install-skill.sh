#!/usr/bin/env bash
# Install the seo-copywriter SUITE into ~/.claude/skills/ so Claude Code's skill
# loader picks up /seo-copywriter AND its four sub-skills (seo-strategist,
# seo-assistant, seo-blog-writer, seo-audit) — they live under this suite dir, so a single
# junction/symlink at the suite root resolves all of them from a fresh shell.
#
# Strategy:
#   - macOS / Linux        → POSIX symlink
#   - Windows (Git Bash)   → directory junction via cmd.exe `mklink /J`
#                            (works without admin; tracks live repo)
#
# Usage (run from the package root):
#   bash seo-copywriter/scripts/install-skill.sh --copy        # copy (recommended when received as a package)
#   bash seo-copywriter/scripts/install-skill.sh               # symlink/junction (tracks this folder; for local dev)
#   bash seo-copywriter/scripts/install-skill.sh --uninstall   # remove the install
#
# Re-running the script is safe: it removes the existing install before reinstalling.
#
# Self-contained: the static content-hub workflow needs no external service to install
# or run, other than a Pexels API key for image fetching (copy .env.local.example ->
# .env.local and paste your key). See SKILL.md / README.md.

set -euo pipefail

SKILL_NAME="seo-copywriter"
# Resolve script's source dir robustly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$HOME/.claude/skills/$SKILL_NAME"

MODE="link"
for arg in "$@"; do
  case "$arg" in
    --copy)      MODE="copy" ;;
    --uninstall) MODE="uninstall" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

# Detect OS for the link strategy
case "$(uname -s)" in
  Linux*|Darwin*) OS="posix" ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  *) OS="posix" ;;
esac

remove_existing() {
  if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    echo "Removing existing $DEST..."
    # On Windows, a junction shows up as a symlink in MSYS — rm -rf removes the
    # junction without recursing into the target. On POSIX, rm -rf on a symlink
    # behaves the same way. Safe in both cases.
    rm -rf "$DEST"
  fi
}

mkdir -p "$HOME/.claude/skills"

case "$MODE" in
  uninstall)
    remove_existing
    echo "Uninstalled $SKILL_NAME from $DEST."
    exit 0
    ;;
  link)
    remove_existing
    if [ "$OS" = "windows" ]; then
      # Convert to Windows paths. Inner quoting via bash → cmd is brittle, so
      # we write a temp .bat file and exec it — paths with spaces still work
      # because the .bat handles quoting natively. (Direct `cmd //c mklink /J`
      # from Git Bash gets the `/J` flag mangled by MSYS path conversion.)
      DEST_WIN="$(cygpath -w "$DEST")"
      SRC_WIN="$(cygpath -w "$SKILL_SRC")"
      BAT="$(mktemp -u --suffix=.bat 2>/dev/null || echo "/tmp/install-skill-$$.bat")"
      printf '@echo off\r\nmklink /J "%s" "%s"\r\n' "$DEST_WIN" "$SRC_WIN" > "$BAT"
      cmd //c "$(cygpath -w "$BAT")"
      rm -f "$BAT"
      echo "Installed $SKILL_NAME as Windows directory junction → $SKILL_SRC"
    else
      ln -s "$SKILL_SRC" "$DEST"
      echo "Installed $SKILL_NAME as symlink → $SKILL_SRC"
    fi
    ;;
  copy)
    remove_existing
    # Copy excluding node_modules + .git (keeps dest small + portable)
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude=node_modules --exclude=.git "$SKILL_SRC/" "$DEST/"
    else
      cp -r "$SKILL_SRC" "$DEST"
      rm -rf "$DEST/node_modules" "$DEST/.git" 2>/dev/null || true
    fi
    echo "Installed $SKILL_NAME as copy at $DEST"
    echo "Note: future edits to $SKILL_SRC will NOT propagate. Re-run this script (without --copy) for dev mode."
    ;;
esac

echo ""
echo "Verify: open Claude Code and check the skills list for 'seo-copywriter'"
echo "        (and its sub-skill seo-strategist)."
echo "Invoke: /seo-copywriter for <client>   (strategy -> author the hub -> static site -> deploy)"
echo ""
echo "Image fetching uses the Pexels API: cp .env.local.example .env.local and paste"
echo "your own key (free at https://www.pexels.com/api/). .env.local is gitignored."
