#!/usr/bin/env node
/**
 * flywheel-sessionstart-resume.mjs — Claude Code SessionStart hook.
 *
 * With matcher "compact|resume" it runs right after a context compaction
 * (source=compact) or a session resume. If an autonomous build loop is active, it
 * injects additionalContext re-pointing the model at the durable RESUME cursor.
 *
 * NOTE: a known Claude Code bug (#15174) sometimes drops SessionStart
 * additionalContext post-compaction. This hook is therefore ONE of three
 * reinforcing carriers of the resume pointer — the Stop hook's reason text and the
 * CLAUDE.md "Compact Instructions" block carry it too. Defense in depth.
 *
 * Project root via CLAUDE_PROJECT_DIR (fallback input.cwd). Registry-driven +
 * instant no-op when no autoloop is active.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function readJsonSafe(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* no stdin */ }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const source = input.source || "compact";

  const registryPath = join(projectDir, ".claude", "flywheel-autoloop-roots.json");
  if (!existsSync(registryPath)) process.exit(0);

  const registry = readJsonSafe(registryPath, { roots: [] });
  for (const root of registry.roots || []) {
    const stateRoot = resolve(projectDir, root);
    const ctrlPath = join(stateRoot, ".auto-loop.json");
    if (!existsSync(ctrlPath)) continue;
    const ctrl = readJsonSafe(ctrlPath, null);
    if (!ctrl || ctrl.active !== true) continue;
    // Respect pause — don't nag the model back into a paused loop.
    if (ctrl.paused === true || existsSync(join(stateRoot, ".auto-loop.pause"))) continue;
    // Session ownership: don't point THIS session at a loop another session owns.
    if (input.session_id && ctrl.session_id && ctrl.session_id !== input.session_id) continue;

    const slug = ctrl.slug || String(root).split(/[\\/]/).filter(Boolean).pop() || "build";
    const ctx =
      `An autonomous build loop for "${slug}" is ACTIVE (run #${ctrl.run_number ?? "?"}, iteration ${ctrl.iteration ?? "?"}/${ctrl.max_iterations ?? "?"}). ` +
      `The session was just restored (${source}). ` +
      `Re-read ${root}/RESUME.md (the intra-run cursor) then ${root}/STATE.md, and CONTINUE /${slug}-build auto from the recorded cursor. ` +
      `Do NOT restart the run, do NOT re-do MERGED PRs. To halt, delete ${root}/.auto-loop.json.`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
    }));
    process.exit(0);
  }
  process.exit(0);
}

main();
