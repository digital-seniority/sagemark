#!/usr/bin/env node
/**
 * install-autoloop-hooks.mjs — wire the auto-loop compaction-continuity hooks
 * into THIS repo's Claude Code config. Idempotent and non-destructive: it merges
 * into existing files, never clobbers them. Re-running is safe.
 *
 * What it does:
 *   1. Adds the three flywheel hooks (Stop / PreCompact / SessionStart) to
 *      .claude/settings.json — only if not already present.
 *   2. Registers this build's state root in .claude/flywheel-autoloop-roots.json
 *      so the (generic) hooks can find active loops cheaply.
 *   3. Appends a "Compact Instructions" block to CLAUDE.md so the resume pointer
 *      survives compaction even if the SessionStart hook injection misses (#15174).
 *
 * The hook SCRIPTS themselves are emitted alongside this file in .claude/hooks/.
 * Run once after compiling the build skill (start-flywheel runs it automatically
 * before an auto first-run):  node .claude/hooks/install-autoloop-hooks.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This script lives at <repo>/.claude/hooks/install-autoloop-hooks.mjs
const REPO_ROOT = resolve(__dirname, "..", "..");
const CLAUDE_DIR = join(REPO_ROOT, ".claude");
const STATE_ROOT_REL = "apps/seo/builds/seo-creator";
const SLUG = "seo-creator";

// Validate the interpolated values before they flow into settings.json / the
// registry / CLAUDE.md. These come from the plan/manifest (model-defaulted in
// unattended mode), so a malformed slug or a `..` in the state root would mean
// path traversal in where the hooks look, or junk injected into CLAUDE.md.
if (!/^[a-z][a-z0-9-]{1,30}$/.test(SLUG)) {
  console.error(`Refusing to install: invalid slug "${SLUG}" (must match ^[a-z][a-z0-9-]{1,30}$).`);
  process.exit(2);
}
if (/^([a-zA-Z]:[\\/]|[\\/])/.test(STATE_ROOT_REL) || STATE_ROOT_REL.split(/[\\/]/).includes("..")) {
  console.error(`Refusing to install: build_state_root "${STATE_ROOT_REL}" must be repo-relative with no "..".`);
  process.exit(2);
}

// Exec form (command + args) — avoids shell tokenization and the Git-Bash-vs-PowerShell
// ambiguity of shell-form commands on Windows. ${CLAUDE_PROJECT_DIR} is expanded by Claude Code.
const HOOK_ARG = (file) => `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${file}`;
// True if a settings hooks-entry references our hook file (command or any arg).
const refsFile = (entry, file) =>
  (entry.hooks || []).some((h) =>
    (typeof h.command === "string" && h.command.includes(file)) ||
    (Array.isArray(h.args) && h.args.some((a) => typeof a === "string" && a.includes(file)))
  );
const HOOKS = {
  Stop: { file: "flywheel-stop-continue.mjs", matcher: null },
  PreCompact: { file: "flywheel-precompact-snapshot.mjs", matcher: "auto|manual" },
  SessionStart: { file: "flywheel-sessionstart-resume.mjs", matcher: "compact|resume" },
  PreToolUse: { file: "flywheel-pretooluse-guard.mjs", matcher: "Edit|Write" },
};

function readJsonSafe(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

let changed = [];

// Don't wire a hook into settings.json unless its script actually exists on disk.
const HOOKS_DIR = join(CLAUDE_DIR, "hooks");
const missing = Object.values(HOOKS).map((h) => h.file).filter((f) => !existsSync(join(HOOKS_DIR, f)));
if (missing.length) {
  console.error(`Refusing to install: hook script(s) missing from ${HOOKS_DIR}: ${missing.join(", ")}. Re-run the renderer to emit them first.`);
  process.exit(2);
}

// ── 1. settings.json hook merge (CONVERGENT — upgrades, not just idempotent) ───
// Remove any prior flywheel entry for each file (old matcher / old shell-form command)
// then re-add the current exec-form entry. Re-running converges to the current contract.
const settingsPath = join(CLAUDE_DIR, "settings.json");
const settings = readJsonSafe(settingsPath, {});
settings.hooks = settings.hooks || {};
for (const [event, { file, matcher }] of Object.entries(HOOKS)) {
  const arr = (settings.hooks[event] = settings.hooks[event] || []);
  const want = { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: "node", args: [HOOK_ARG(file)] }] };
  const idx = arr.findIndex((entry) => refsFile(entry, file));
  if (idx >= 0) {
    if (JSON.stringify(arr[idx]) === JSON.stringify(want)) continue; // already current
    arr[idx] = want;
    changed.push(`settings.json: ~ ${event} hook (${file}) upgraded`);
  } else {
    arr.push(want);
    changed.push(`settings.json: + ${event} hook (${file})`);
  }
}
if (changed.some((c) => c.startsWith("settings.json"))) writeJson(settingsPath, settings);

// ── 2. autoloop roots registry (dedup) ────────────────────────────────────────
const registryPath = join(CLAUDE_DIR, "flywheel-autoloop-roots.json");
const registry = readJsonSafe(registryPath, { roots: [] });
registry.roots = registry.roots || [];
if (!registry.roots.includes(STATE_ROOT_REL)) {
  registry.roots.push(STATE_ROOT_REL);
  writeJson(registryPath, registry);
  changed.push(`flywheel-autoloop-roots.json: + ${STATE_ROOT_REL}`);
}

// ── 3. CLAUDE.md compact-instructions block (CONVERGENT — replace on re-run) ───
// Delimited by start+end markers so re-running REPLACES stale content. Legacy blocks
// (start marker only, appended at EOF by pre-1.0.9 installers) are migrated.
const START = "<!-- flywheel-autoloop:compact-instructions -->";
const END = "<!-- /flywheel-autoloop:compact-instructions -->";
const claudeMdPath = join(REPO_ROOT, "CLAUDE.md");
const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : "";
// Generic across ALL builds in this repo — point at the registry, not one slug/root.
const block =
  `${START}\n` +
  `## Compact Instructions\n\n` +
  `If any autonomous build loop is active, ALWAYS preserve this across compaction: ` +
  `read \`.claude/flywheel-autoloop-roots.json\`; for each listed build state root whose \`.auto-loop.json\` has \`"active": true\`, ` +
  `an autonomous \`/<slug>-build auto\` run is in progress — on resume, re-read that root's \`RESUME.md\` then \`STATE.md\` and CONTINUE from the recorded cursor. ` +
  `Do NOT restart a run or re-merge MERGED PRs.\n` +
  `${END}\n`;
let nextMd = claudeMd;
const si = claudeMd.indexOf(START);
if (si >= 0 && claudeMd.includes(END)) {
  const ei = claudeMd.indexOf(END) + END.length;
  nextMd = claudeMd.slice(0, si) + block + claudeMd.slice(ei).replace(/^\n/, "");
} else if (si >= 0) {
  // legacy: old block ran from START to EOF — replace it wholesale
  nextMd = claudeMd.slice(0, si) + block;
} else {
  nextMd = (claudeMd ? claudeMd.replace(/\n*$/, "\n") : "") + "\n" + block;
}
if (nextMd !== claudeMd) {
  writeFileSync(claudeMdPath, nextMd, "utf8");
  changed.push(si >= 0 ? "CLAUDE.md: ~ Compact Instructions block updated" : "CLAUDE.md: + Compact Instructions block");
}

// ── Report ────────────────────────────────────────────────────────────────────
if (changed.length === 0) {
  console.log(`auto-loop hooks already installed for ${SLUG} — no changes.`);
} else {
  console.log(`Installed auto-loop hooks for ${SLUG}:`);
  for (const c of changed) console.log(`  ${c}`);
  console.log(`\nHalt an active loop anytime by deleting ${STATE_ROOT_REL}/.auto-loop.json.`);
}
