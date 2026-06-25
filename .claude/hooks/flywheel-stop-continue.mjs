#!/usr/bin/env node
/**
 * flywheel-stop-continue.mjs — Claude Code Stop hook (the auto-loop engine).
 *
 * Keeps the turn alive while an autonomous build loop has eligible work — and
 * ENFORCES the loop's bounds in code so they survive context compaction (the
 * orchestrator prose can't be relied on post-summary). The hook owns: wall-clock
 * budget, anti-runaway counters (reset on observed on-disk progress + hard
 * total-blocks ceiling), dependency + non-engineering-blocker eligibility, hard-stop
 * scanning (BLOCKED / REQUIRES_HUMAN_MERGE per the manifest's hard_stop_on), pause,
 * and stall/terminal surfacing.
 *
 * Session-scoped: one main conversation drives ONE build. With a session_id, the
 * hook only drives the loop this session owns (claim-on-first-block) and never
 * drives a loop owned by another session. Without a session_id (e.g. tests) it
 * falls back to driving all active loops.
 *
 * Project root via CLAUDE_PROJECT_DIR (stable across the orchestrator's mid-run
 * `cd`s) with input.cwd fallback. Fast no-op when no registry exists.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ADVANCEABLE = new Set(["NOT_STARTED", "INTERRUPTED", "IN_FLIGHT"]);
const ALL_STATUS = new Set([
  "NOT_STARTED", "INTERRUPTED", "IN_FLIGHT", "APPROVED_NOT_COMMITTED",
  "PR_CREATED", "MERGED", "BLOCKED", "REQUIRES_HUMAN_MERGE", "PREVIEW_FAILED",
]);

function readJsonSafe(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
function tryWrite(p, obj) {
  try { writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); } catch { /* best-effort */ }
}

// Parse STATE.md PR table → { byId: Map(id->status), parsed: bool }. Locates the
// Status (and ID) column from the header so it's robust to column order.
function parseState(md) {
  const lines = md.split(/\r?\n/);
  const rows = lines.filter((l) => l.trim().startsWith("|"));
  if (rows.length === 0) return { byId: new Map(), parsed: false };
  let statusCol = -1, idCol = -1;
  const header = rows.find((r) => /(^|\|)\s*status\s*(\||$)/i.test(r));
  if (header) {
    const cells = header.split("|").map((c) => c.trim().toLowerCase());
    statusCol = cells.findIndex((c) => c === "status");
    idCol = cells.findIndex((c) => c === "id");
  }
  const byId = new Map();
  let any = false;
  for (const r of rows) {
    const cells = r.split("|").map((c) => c.trim());
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue;
    let status, id;
    if (statusCol >= 0 && ALL_STATUS.has(cells[statusCol])) {
      status = cells[statusCol];
      id = idCol >= 0 ? cells[idCol] : cells.find((c) => /^[PAC]?\d+\.[A-Z]+\.\S+$/.test(c));
    } else {
      status = cells.find((c) => ALL_STATUS.has(c));
      id = cells.find((c) => /^[PAC]?\d+\.[A-Z]+\.\S+$/.test(c));
    }
    if (status) { any = true; if (id) byId.set(id, status); }
  }
  return { byId, parsed: any };
}

// Advanceable = PRs the loop can still START/advance, with REAL eligibility:
//   NOT_STARTED → deps all MERGED AND no unresolved non_engineering_blockers
//   INTERRUPTED / IN_FLIGHT → already started, count regardless
function countAdvanceable(byId, manifest) {
  const prMap = manifest && Array.isArray(manifest.pr_map) ? manifest.pr_map : null;
  if (!prMap) {
    let n = 0;
    for (const s of byId.values()) if (ADVANCEABLE.has(s)) n++;
    return n; // fallback: no manifest → can't evaluate deps/blockers
  }
  const depsById = new Map(prMap.map((pr) => [pr.id, pr.dependencies || []]));
  const blockersById = new Map(prMap.map((pr) => [pr.id, pr.non_engineering_blockers || []]));
  let n = 0;
  for (const [id, status] of byId.entries()) {
    if (!ADVANCEABLE.has(status)) continue;
    if (status === "NOT_STARTED") {
      const deps = depsById.get(id) || [];
      const blockers = blockersById.get(id) || [];
      if (blockers.length > 0) continue; // gated on a non-engineering blocker (counsel signoff, vendor, asset…)
      if (deps.every((d) => byId.get(d) === "MERGED")) n++;
    } else {
      n++;
    }
  }
  return n;
}
function countMerged(byId) {
  let n = 0; for (const s of byId.values()) if (s === "MERGED") n++; return n;
}
// Hard-stop scan: presence of a configured hard-stop status ends the loop even if
// other eligible work exists (the documented hard-stop policy, now hook-enforced).
function hardStopHit(byId, manifest) {
  const hs = (manifest && manifest.operations && manifest.operations.auto_loop && manifest.operations.auto_loop.hard_stop_on) || [];
  const seen = new Set(byId.values());
  if (hs.includes("blocked") && seen.has("BLOCKED")) return "BLOCKED";
  if (hs.includes("requires_human_merge") && seen.has("REQUIRES_HUMAN_MERGE")) return "REQUIRES_HUMAN_MERGE";
  return null;
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* no stdin */ }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const sessionId = input.session_id;
  const now = Date.now();

  const registryPath = join(projectDir, ".claude", "flywheel-autoloop-roots.json");
  if (!existsSync(registryPath)) return allow();

  const registry = readJsonSafe(registryPath, { roots: [] });

  // Collect drivable candidates: active, not hard-stopped, not paused.
  const candidates = [];
  for (const root of registry.roots || []) {
    const stateRoot = resolve(projectDir, root);
    const ctrlPath = join(stateRoot, ".auto-loop.json");
    if (!existsSync(ctrlPath)) continue;
    const ctrl = readJsonSafe(ctrlPath, null);
    if (!ctrl || ctrl.active !== true || ctrl.hard_stop) continue;
    if (ctrl.paused === true || existsSync(join(stateRoot, ".auto-loop.pause"))) continue;
    candidates.push({ root, stateRoot, ctrlPath, ctrl });
  }

  // Session ownership: one conversation drives one build (claim-on-first-block).
  let driveSet;
  if (sessionId) {
    const owned = candidates.filter((c) => c.ctrl.session_id === sessionId);
    if (owned.length) {
      driveSet = owned;
    } else {
      const unclaimed = candidates.find((c) => !c.ctrl.session_id);
      if (unclaimed) { unclaimed.ctrl.session_id = sessionId; tryWrite(unclaimed.ctrlPath, unclaimed.ctrl); driveSet = [unclaimed]; }
      else driveSet = []; // all active loops belong to other sessions
    }
  } else {
    driveSet = candidates; // legacy / no session_id
  }

  const blockReasons = [];
  const notices = [];

  for (const { root, stateRoot, ctrlPath, ctrl } of driveSet) {
    const slug = ctrl.slug || String(root).split(/[\\/]/).filter(Boolean).pop() || "build";

    // STATE.md must be parseable; else surface (don't silently "complete").
    const statePath = join(stateRoot, "STATE.md");
    const state = existsSync(statePath) ? parseState(readFileSync(statePath, "utf8")) : { byId: new Map(), parsed: false };
    if (!state.parsed) {
      ctrl.active = false; ctrl.terminal_reason = "state_unreadable";
      tryWrite(ctrlPath, ctrl);
      notices.push(`autoloop "${slug}": STATE.md missing/unparseable — loop halted for inspection (${root}/STATE.md).`);
      continue;
    }

    // Wall-clock budget.
    const maxHours = ctrl.budget && ctrl.budget.max_wall_clock_hours;
    if (maxHours && ctrl.started_at) {
      const elapsedH = (now - Date.parse(ctrl.started_at)) / 3.6e6;
      if (elapsedH > maxHours) {
        ctrl.active = false; ctrl.terminal_reason = "budget_wall_clock";
        tryWrite(ctrlPath, ctrl);
        notices.push(`autoloop "${slug}": wall-clock budget (${maxHours}h) reached — loop ended.`);
        continue;
      }
    }

    const manifest = ctrl.manifest_path ? readJsonSafe(resolve(projectDir, ctrl.manifest_path), null) : null;

    // Hard-stop scan (BLOCKED / REQUIRES_HUMAN_MERGE per manifest hard_stop_on).
    const hs = hardStopHit(state.byId, manifest);
    if (hs) {
      ctrl.active = false; ctrl.hard_stop = true; ctrl.terminal_reason = "hardstop:" + hs;
      tryWrite(ctrlPath, ctrl);
      notices.push(`autoloop "${slug}": hard-stop — a ${hs} PR needs a human. Loop halted; inspect ${root}/STATE.md.`);
      continue;
    }

    const advanceable = countAdvanceable(state.byId, manifest);
    const merged = countMerged(state.byId);

    // Progress detection (code): merged rose ⇒ reset stall counter.
    if (Number.isFinite(ctrl.last_merged_count) && merged > ctrl.last_merged_count) ctrl.consecutive_blocks = 0;
    ctrl.last_merged_count = merged;

    if (advanceable <= 0) {
      // No advanceable work AND the model is ending the turn → the loop is done. Mark it
      // terminal so a dangling `.auto-loop.json` isn't treated active by a future SessionStart.
      ctrl.active = false;
      ctrl.terminal_reason = ctrl.terminal_reason || "depleted";
      tryWrite(ctrlPath, ctrl);
      notices.push(`autoloop "${slug}": no advanceable work remains — loop complete.`);
      continue;
    }

    const cbLimit = Number.isFinite(ctrl.consecutive_block_limit) ? ctrl.consecutive_block_limit : 5;
    const maxIter = Number.isFinite(ctrl.max_iterations) ? ctrl.max_iterations : 8;
    const totalCeiling = Number.isFinite(ctrl.max_total_blocks) ? ctrl.max_total_blocks : maxIter * (cbLimit + 1) + 5;
    const totalBlocks = (Number.isFinite(ctrl.total_blocks) ? ctrl.total_blocks : 0) + 1;
    if (totalBlocks > totalCeiling) {
      ctrl.active = false; ctrl.terminal_reason = "max_blocks";
      tryWrite(ctrlPath, ctrl);
      notices.push(`autoloop "${slug}": hit hard block ceiling (${totalCeiling}) — loop ended; ${advanceable} PR(s) still advanceable. Re-invoke /${slug}-build auto to continue.`);
      continue;
    }
    ctrl.total_blocks = totalBlocks;

    const blocks = (Number.isFinite(ctrl.consecutive_blocks) ? ctrl.consecutive_blocks : 0) + 1;
    if (blocks > cbLimit) {
      ctrl.active = false; ctrl.stalled = true; ctrl.terminal_reason = "stalled";
      tryWrite(ctrlPath, ctrl);
      notices.push(`autoloop "${slug}": no merge progress in ${cbLimit} turns — STALLED. Loop halted; inspect ${root}/RESUME.md.`);
      continue;
    }
    ctrl.consecutive_blocks = blocks;
    tryWrite(ctrlPath, ctrl);

    blockReasons.push(
      `Build "${slug}" (iteration ${ctrl.iteration ?? "?"}/${maxIter}): ${advanceable} PR(s) eligible. ` +
      `Re-read ${root}/RESUME.md then ${root}/STATE.md and continue /${slug}-build auto.`
    );
  }

  if (blockReasons.length > 0) {
    const reason =
      "Autonomous build loop active — do NOT stop, do NOT restart, do NOT re-merge MERGED PRs.\n" +
      blockReasons.join("\n") +
      (notices.length ? "\n(also: " + notices.join(" ") + ")" : "") +
      "\nTo halt: delete the build's .auto-loop.json. To pause: create .auto-loop.pause next to it.";
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason,
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: reason },
    }));
    return done();
  }
  if (notices.length > 0) {
    process.stdout.write(JSON.stringify({ systemMessage: "[flywheel] " + notices.join(" ") }));
    return done();
  }
  return allow();
}

function allow() { process.exit(0); }
function done() { process.exit(0); }

main();
