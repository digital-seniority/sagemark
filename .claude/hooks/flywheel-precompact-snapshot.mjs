#!/usr/bin/env node
/**
 * flywheel-precompact-snapshot.mjs — Claude Code PreCompact hook.
 *
 * Fires right before the conversation is compacted (auto or manual). PreCompact
 * output is NOT injected into the post-compaction context, so this hook only
 * GUARANTEES a durable on-disk breadcrumb at the compaction boundary. RESUME.md is
 * already kept current by the orchestrator; this is belt-and-suspenders. Never
 * blocks compaction (always exit 0).
 *
 * Project root via CLAUDE_PROJECT_DIR (fallback input.cwd). Registry-driven +
 * instant no-op when no autoloop is active.
 */
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function readJsonSafe(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* no stdin */ }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const trigger = input.trigger || input.matcher || "auto";
  const stamp = new Date().toISOString();

  const registryPath = join(projectDir, ".claude", "flywheel-autoloop-roots.json");
  if (!existsSync(registryPath)) process.exit(0);

  const registry = readJsonSafe(registryPath, { roots: [] });
  for (const root of registry.roots || []) {
    const stateRoot = resolve(projectDir, root);
    const ctrlPath = join(stateRoot, ".auto-loop.json");
    if (!existsSync(ctrlPath)) continue;
    const ctrl = readJsonSafe(ctrlPath, null);
    if (!ctrl || ctrl.active !== true) continue;

    // Phase is owned by .run-lock.json (the canonical resume pointer) — read it
    // from there rather than duplicating it in .auto-loop.json.
    const lock = readJsonSafe(join(stateRoot, ".run-lock.json"), {});
    const phase = lock.phase ?? "?";

    const runLog = join(stateRoot, "run-log.md");
    const marker =
      `\n<!-- COMPACTION BOUNDARY @ ${stamp} | trigger=${trigger} | run=${ctrl.run_number ?? "?"} ` +
      `iter=${ctrl.iteration ?? "?"} phase=${phase} | resume: ${root}/RESUME.md -->\n`;
    try { if (existsSync(runLog)) appendFileSync(runLog, marker, "utf8"); } catch { /* best-effort */ }

    // Re-check existence right before writeback: if the orchestrator deleted the
    // control file (loop ended) between our read and now, do NOT resurrect it.
    if (!existsSync(ctrlPath)) continue;
    ctrl.compactions = (Number.isFinite(ctrl.compactions) ? ctrl.compactions : 0) + 1;
    ctrl.last_compaction_at = stamp;
    try { writeFileSync(ctrlPath, JSON.stringify(ctrl, null, 2) + "\n", "utf8"); } catch { /* best-effort */ }
  }
  process.exit(0); // never block compaction
}

main();
