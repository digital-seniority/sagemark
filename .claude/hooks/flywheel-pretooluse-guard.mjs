#!/usr/bin/env node
/**
 * flywheel-pretooluse-guard.mjs — Claude Code PreToolUse hook (restart guard).
 *
 * The one destructive failure the Stop hook can't catch: a confused post-compaction
 * model that doesn't try to *stop* but instead *restarts* — re-bootstrapping STATE.md
 * back to all-NOT_STARTED and re-doing already-MERGED work. The Stop hook only fires
 * when the model ends a turn; this fires BEFORE a tool call and can deny it.
 *
 * Guard (only while an auto-loop is active): a `Write` to a build's STATE.md that
 * drops the MERGED count by >=2 is the destructive-restart signature — normal
 * operation only ever ADDS merges, and a single-PR self-verify correction (drop of 1)
 * still passes. Everything else is allowed; fast no-op when no loop is active.
 *
 * Project root via CLAUDE_PROJECT_DIR (fallback input.cwd).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ALL_STATUS = new Set([
  "NOT_STARTED", "INTERRUPTED", "IN_FLIGHT", "APPROVED_NOT_COMMITTED",
  "PR_CREATED", "MERGED", "BLOCKED", "REQUIRES_HUMAN_MERGE", "PREVIEW_FAILED",
]);
const RESTART_DROP_THRESHOLD = 2; // a drop of >=2 MERGED = wholesale restart, not a 1-PR correction

function readJsonSafe(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

// Count MERGED rows in a STATE.md body (positional Status column when a header
// exists, else "first known-status cell" fallback).
function countMerged(md) {
  if (!md) return 0;
  const rows = md.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  let statusCol = -1;
  const header = rows.find((r) => /(^|\|)\s*status\s*(\||$)/i.test(r));
  if (header) statusCol = header.split("|").map((c) => c.trim().toLowerCase()).findIndex((c) => c === "status");
  let n = 0;
  for (const r of rows) {
    const cells = r.split("|").map((c) => c.trim());
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue;
    const status = (statusCol >= 0 && ALL_STATUS.has(cells[statusCol])) ? cells[statusCol] : cells.find((c) => ALL_STATUS.has(c));
    if (status === "MERGED") n++;
  }
  return n;
}

// Apply an Edit's replacement to the current content so we can count MERGED in the
// post-edit result (the guard must cover Edit, not just full-file Write).
function applyEdit(current, toolInput) {
  const oldS = toolInput.old_string;
  const newS = toolInput.new_string ?? "";
  if (typeof oldS !== "string" || oldS === "") return current; // can't simulate → treat as unchanged
  if (toolInput.replace_all) return current.split(oldS).join(newS);
  const i = current.indexOf(oldS);
  return i < 0 ? current : current.slice(0, i) + newS + current.slice(i + oldS.length);
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* no stdin */ }
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return allow(); // guards STATE.md overwrites + edits

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const registryPath = join(projectDir, ".claude", "flywheel-autoloop-roots.json");
  if (!existsSync(registryPath)) return allow();

  const ti = input.tool_input || {};
  const filePath = ti.file_path;
  if (!filePath) return allow();
  const target = resolve(projectDir, filePath);

  const registry = readJsonSafe(registryPath, { roots: [] });
  for (const root of registry.roots || []) {
    const stateRoot = resolve(projectDir, root);
    const ctrl = readJsonSafe(join(stateRoot, ".auto-loop.json"), null);
    if (!ctrl || ctrl.active !== true) continue;
    if (target !== join(stateRoot, "STATE.md")) continue;

    const statePath = join(stateRoot, "STATE.md");
    const current = existsSync(statePath) ? readFileSync(statePath, "utf8") : "";
    const oldMerged = countMerged(current);
    // Write → new content is tool_input.content; Edit → simulate the replacement.
    const newContent = input.tool_name === "Write" ? (ti.content || "") : applyEdit(current, ti);
    const newMerged = countMerged(newContent);
    if (oldMerged - newMerged >= RESTART_DROP_THRESHOLD) {
      const slug = ctrl.slug || String(root).split(/[\\/]/).filter(Boolean).pop() || "build";
      return deny(
        `Auto-loop active for "${slug}": this ${input.tool_name} to STATE.md drops MERGED PRs from ${oldMerged} to ${newMerged} — that looks like a destructive RESTART (it would re-do already-merged work). ` +
        `Do NOT reset the ledger. Re-read ${root}/RESUME.md and continue /${slug}-build auto from the cursor. ` +
        `If you truly intend to reset this build, delete ${root}/.auto-loop.json first, then retry.`
      );
    }
    return allow(); // this is the target STATE.md and the write is safe
  }
  return allow();
}

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

main();
