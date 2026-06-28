#!/usr/bin/env node
/**
 * Create a Vercel Sandbox snapshot pre-loaded with the SEO worker.
 *
 * The snapshot installs system tools + npm deps + the compiled worker dist +
 * the vendored seo-copywriter skills so that every production run starts from
 * a warm image instead of an empty node24 VM.
 *
 * Prerequisites:
 *   1. Build the worker:  npm run build:worker   (from apps/seo/)
 *   2. Set credentials (if running locally — not needed on Vercel OIDC):
 *        VERCEL_TOKEN=<personal-access-token>
 *        VERCEL_TEAM_ID=team_vx4f514OCbQkrEUGgvm87nTc
 *        VERCEL_PROJECT_ID=prj_wd0r52tSJmtXppKUdMnzRwHwWj7i
 *
 * Run:
 *   npm run create-snapshot               (from apps/seo/)
 *   -- or --
 *   VERCEL_TOKEN=xxx ... node apps/seo/scripts/create-worker-snapshot.mjs
 *
 * Output: SEO_WORKER_SNAPSHOT_ID=snap_xxxx
 *   → Set this on Vercel (prod + preview) and redeploy.
 */

import { Sandbox } from "@vercel/sandbox";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ──────────────────────────────────────────────────────────────────────

const SEO_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(SEO_ROOT, "dist");
// Skills are two levels up from apps/seo/ at the monorepo root.
const SKILLS_SRC = path.resolve(SEO_ROOT, "../../skills/seo-copywriter-skill-package/seo-copywriter");
// Only copy the skill subdirectories the worker loads — not examples/, scripts/, or
// other tooling (which contain large binary files and are irrelevant to the runner).
const SKILL_NAMES = ["seo-strategist", "seo-assistant", "seo-blog-writer", "seo-audit"];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Recursively walk a directory and yield file paths. */
function* walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

/**
 * Write a local file to a path inside the sandbox.
 *
 * The file content is base64-encoded on the host and decoded via `printf |
 * base64 -d` inside the sandbox. Base64's alphabet [A-Za-z0-9+/=] contains no
 * single-quote characters so single-quoting the encoded string in shell is safe
 * — no quoting or injection risk even for binary/JavaScript source files.
 */
async function writeToSandbox(sandbox, localPath, remotePath) {
  const b64 = fs.readFileSync(localPath).toString("base64");
  const dir = path.posix.dirname(remotePath);
  await sandbox.runCommand("sh", [
    "-c",
    `mkdir -p '${dir}' && printf '%s' '${b64}' | base64 -d > '${remotePath}'`,
  ]);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Pre-flight checks.
  if (!fs.existsSync(DIST_DIR)) {
    console.error("ERROR: apps/seo/dist/ not found.");
    console.error("       Run first: cd apps/seo && npm run build:worker");
    process.exit(1);
  }
  if (!fs.existsSync(SKILLS_SRC)) {
    console.error(`ERROR: skills not found at ${SKILLS_SRC}`);
    console.error("       Ensure skills/seo-copywriter-skill-package/ exists in the repo root.");
    process.exit(1);
  }
  for (const name of SKILL_NAMES) {
    const skillFile = path.join(SKILLS_SRC, name, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      console.error(`ERROR: ${name}/SKILL.md not found at ${skillFile}`);
      process.exit(1);
    }
  }

  // Vercel credentials — only needed locally; on Vercel OIDC handles auth.
  const creds =
    process.env.VERCEL_TOKEN
      ? {
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          projectId: process.env.VERCEL_PROJECT_ID,
        }
      : {};

  // ── 1. Create a bare node24 sandbox ─────────────────────────────────────────
  console.log("Creating bare node24 sandbox (timeout 10 min)...");
  const sandbox = await Sandbox.create({
    ...creds,
    runtime: "node24",
    timeout: 600_000,
  });
  console.log("✓ Sandbox created");

  // ── 2. Install system tools ──────────────────────────────────────────────────
  // The production hardenSandbox() runs `iptables` (MMDS DROP, DR-010) and
  // `curl` (read-back probe) on every run — they must be pre-installed in the
  // snapshot. Amazon Linux (the node24 base) uses `dnf`.
  console.log("Installing system tools (iptables, curl, ca-certificates)...");
  await sandbox.runCommand("sh", [
    "-c",
    "sudo dnf install -y iptables curl ca-certificates 2>&1 | tail -5",
  ]);
  console.log("✓ System tools installed");

  // ── 3. Set up /home/worker directory structure ───────────────────────────────
  // /home/worker/app  — the worker's app root (process.cwd() at runtime)
  // /home/worker/run  — the ephemeral workdir jail (WORKER_WORKDIR)
  console.log("Setting up /home/worker directories...");
  await sandbox.runCommand("sh", [
    "-c",
    // Create as root so the path is reachable, then chown to the current user
    // so subsequent non-sudo writes succeed.
    "sudo mkdir -p /home/worker/app /home/worker/run && sudo chown -R $(id -u):$(id -g) /home/worker",
  ]);
  console.log("✓ Directories ready");

  // ── 4. Write a minimal package.json + npm install runtime deps ───────────────
  // The worker only needs two runtime packages: zod (static import compiled into
  // dist/worker/agent-worker.js) and @anthropic-ai/claude-agent-sdk (dynamically
  // imported in agent-worker.ts for the query() + tool() APIs). The full
  // apps/seo/package.json is NOT used here because it carries workspace:* refs
  // (@sagemark/core etc.) that npm cannot resolve outside the monorepo.
  console.log("Installing npm dependencies (claude-agent-sdk + zod, may take ~1 min)...");
  // Read the exact versions from the main package.json so the snapshot matches.
  const mainPkg = JSON.parse(fs.readFileSync(path.join(SEO_ROOT, "package.json"), "utf-8"));
  const workerPkg = {
    name: "seo-worker",
    version: mainPkg.version ?? "0.1.0",
    private: true,
    dependencies: {
      "@anthropic-ai/claude-agent-sdk": mainPkg.dependencies["@anthropic-ai/claude-agent-sdk"],
      "zod": mainPkg.dependencies["zod"],
    },
  };
  const pkgB64 = Buffer.from(JSON.stringify(workerPkg, null, 2)).toString("base64");
  await sandbox.runCommand("sh", [
    "-c",
    `printf '%s' '${pkgB64}' | base64 -d > /home/worker/app/package.json`,
  ]);
  await sandbox.runCommand("sh", [
    "-c",
    "cd /home/worker/app && npm install --no-fund --no-audit 2>&1 | tail -8",
  ]);
  console.log("✓ npm dependencies installed");

  // ── 5. Write compiled worker dist ───────────────────────────────────────────
  const distFiles = [...walkDir(DIST_DIR)];
  console.log(`Writing ${distFiles.length} compiled worker files...`);
  for (const localPath of distFiles) {
    const rel = path.relative(DIST_DIR, localPath).replace(/\\/g, "/");
    process.stdout.write(`  dist/${rel}\n`);
    await writeToSandbox(sandbox, localPath, `/home/worker/app/dist/${rel}`);
  }
  console.log("✓ Worker dist written");

  // ── 6. Write vendored seo-copywriter skills ──────────────────────────────────
  // The loader (skills/load-suite.ts) resolves these relative to process.cwd()
  // (= /home/worker/app) as: skills/seo-copywriter-skill-package/seo-copywriter/
  // Matches the SUITE_PACKAGE_REL_ROOT constant and the Dockerfile COPY (A.011.9).
  // Write both the parent SKILL.md (used by standalone-strategy + standalone-author
  // modes via loadParentSkillMarkdown) and the four kernel-backed sub-skill SKILL.mds.
  console.log(`Writing skill SKILL.md files (parent + ${SKILL_NAMES.join(", ")})...`);
  // Parent seo-copywriter/SKILL.md (standalone hub methodology).
  const parentSkillLocal = path.join(SKILLS_SRC, "SKILL.md");
  const parentSkillRemote = `/home/worker/app/skills/seo-copywriter-skill-package/seo-copywriter/SKILL.md`;
  if (fs.existsSync(parentSkillLocal)) {
    process.stdout.write(`  seo-copywriter/SKILL.md\n`);
    await writeToSandbox(sandbox, parentSkillLocal, parentSkillRemote);
  } else {
    console.warn(`  WARN: parent SKILL.md not found at ${parentSkillLocal} — standalone modes won't work`);
  }
  // Four kernel-backed sub-skill SKILL.mds.
  for (const name of SKILL_NAMES) {
    const localPath = path.join(SKILLS_SRC, name, "SKILL.md");
    const remotePath = `/home/worker/app/skills/seo-copywriter-skill-package/seo-copywriter/${name}/SKILL.md`;
    process.stdout.write(`  seo-copywriter/${name}/SKILL.md\n`);
    await writeToSandbox(sandbox, localPath, remotePath);
  }
  console.log("✓ Skills written");

  // ── 7. Verify key paths are in place ────────────────────────────────────────
  console.log("Verifying...");
  const check = await sandbox.runCommand("sh", [
    "-c",
    "echo '--- dist/worker/ ---' && ls /home/worker/app/dist/worker/ && echo '--- skills/seo-copywriter/ ---' && ls /home/worker/app/skills/seo-copywriter-skill-package/seo-copywriter/",
  ]);
  console.log(await check.stdout());

  // ── 8. Snapshot (also stops the sandbox) ────────────────────────────────────
  console.log("Creating snapshot (stops the sandbox; may take ~30s)...");
  const snapshot = await sandbox.snapshot();
  const snapshotId = snapshot.snapshotId;

  console.log(`\n✅  SEO_WORKER_SNAPSHOT_ID=${snapshotId}\n`);
  console.log("Next steps:");
  console.log(
    "  1. Set the env var on Vercel (prod + preview) — the Vercel CLI must be\n" +
      "     scoped to the digital-seniority team:\n" +
      `       vercel env add SEO_WORKER_SNAPSHOT_ID production --scope digital-seniority\n` +
      `         → ${snapshotId}\n` +
      `       vercel env add SEO_WORKER_SNAPSHOT_ID preview --scope digital-seniority\n` +
      `         → ${snapshotId}`,
  );
  console.log("  2. Redeploy: vercel --prod --scope digital-seniority");
  console.log("  3. Test a live run from the studio.");
}

main().catch((err) => {
  console.error("\nSnapshot creation failed:", err?.message ?? err);
  process.exit(1);
});
