/**
 * load-suite — load the seo-copywriter suite SKILL.md skills into the worker
 * (PR 008 / P0.W.5, lane worker-runtime).
 *
 * THE SKILL IS RUN DIRECTLY, NOT RE-AUTHORED. This module is the seam that hands
 * the Agent-SDK worker the REAL, vendored `SKILL.md` skills from the in-repo
 * package (DR-022) — it loads the markdown verbatim off disk, it does NOT
 * re-author the methodology as a prompt and it does NOT re-implement the kernel
 * (the markdown-drift anti-pattern). The skill's job is to ORCHESTRATE the
 * `apps/seo` `/content/api/*` route contract (the kernel); this loader points the
 * skill's kernel-host base URL at exactly that contract so a globally-invoked run
 * drives the host route rather than re-implementing scoring/persistence.
 *
 * CANONICAL SOURCE (DR-022). The suite lives in-repo, vendored, at
 * `skills/seo-copywriter-skill-package/seo-copywriter/`. NOT `~/.claude/skills`,
 * NOT the RFC's stale `learnings/SKILLS/...` path. The worker `Dockerfile` COPYs
 * this tree into the Sandbox image (audit A.011.9) so the load resolves in the VM
 * (it must not rely on `settingSources:["project"]`, which won't resolve there).
 *
 * THINNEST SLICE (PR 008). This PR registers ONLY `seo-blog-writer` (the
 * single-drafter path). The full strategist -> assistant -> audit chain is PR 014;
 * the suite root + all four sub-skills are present on disk, but the loaded set is
 * the explicit `requested` list (default: `[seo-blog-writer]`).
 *
 * PURE-ISH / ISOMORPHIC: imports only `node:fs`/`node:path` + the shared kernel
 * route enum. No Next APIs, no DB, no SDK import (the SDK consumes the loaded
 * descriptors; this module produces them). The fs read is injectable so the load
 * + kernel-drive logic is unit-testable without a live Sandbox. Clean ASCII/UTF-8.
 */

import { readFileSync, existsSync } from "node:fs";

import { KERNEL_ROUTES } from "../../lib/content/contract";

// ── Canonical in-repo suite location (DR-022) ──────────────────────────────────

/**
 * The canonical in-repo suite package root, RELATIVE to the apps/seo app root
 * (DR-022). In the Sandbox image the Dockerfile COPYs this exact subtree to the
 * same relative location under the worker app root, so one constant resolves both
 * in CI/worktree and in the VM.
 */
export const SUITE_PACKAGE_REL_ROOT =
  "skills/seo-copywriter-skill-package/seo-copywriter";

/** The skill the single-drafter slice loads + runs directly (PR 008). */
export const SINGLE_DRAFTER_SKILL = "seo-blog-writer";

/** Every suite skill present in the vendored package (PR 014 loads the full chain). */
export const SUITE_SKILLS = [
  "seo-strategist",
  "seo-assistant",
  "seo-blog-writer",
  "seo-audit",
] as const;

export type SuiteSkillName = (typeof SUITE_SKILLS)[number];

// ── Loaded descriptor ──────────────────────────────────────────────────────────

/**
 * One loaded suite skill — the REAL `SKILL.md` read verbatim off disk plus the
 * resolved file path + parsed front-matter name. The `SKILL.md` body is NOT
 * rewritten; `markdown` is the bytes on disk.
 */
export interface LoadedSkill {
  /** The skill's directory name under the suite root (e.g. `seo-blog-writer`). */
  name: SuiteSkillName;
  /** Absolute path to the loaded `SKILL.md`. */
  skillPath: string;
  /** The `name:` from the `SKILL.md` YAML front-matter (proves we read the real file). */
  frontMatterName: string;
  /** The full `SKILL.md` markdown, verbatim (never re-authored). */
  markdown: string;
}

/**
 * The result of loading the suite for one run: the loaded skill descriptors plus
 * the kernel-host wiring the skills must drive. The `kernelBaseUrl` +
 * `kernelRoutes` are what makes the skill kernel-backed: the skill calls the
 * `apps/seo` `/content/api/*` routes, never re-implements them.
 */
export interface LoadedSuite {
  /** The loaded skill descriptors (the REAL SKILL.md bytes). */
  skills: LoadedSkill[];
  /** The `apps/seo` host base URL the skills' kernel calls target (DR-022). */
  kernelBaseUrl: string;
  /** The kernel route map the skill drives (the routes ARE the toolset). */
  kernelRoutes: typeof KERNEL_ROUTES;
  /** The names the Agent SDK should activate (mirrors `skills`). */
  skillNames: SuiteSkillName[];
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface LoadSuiteOptions {
  /**
   * The `apps/seo` host base URL the skills' kernel calls target. The skill is
   * pointed HERE (DR-022) so it drives the `/content/api/*` contract — never a
   * re-implemented kernel. Required (fail-closed: no default host).
   */
  kernelBaseUrl: string;
  /**
   * App root the `SUITE_PACKAGE_REL_ROOT` is resolved against. Defaults to the
   * apps/seo app root inferred from this module's location, so the same call
   * works in the worktree, in CI, and in the Sandbox image.
   */
  appRoot?: string;
  /** Which suite skills to load (default: the PR 008 single-drafter `[seo-blog-writer]`). */
  requested?: readonly SuiteSkillName[];
  /** Injectable file reader (default: `node:fs.readFileSync`). For unit tests. */
  readFileImpl?: (absPath: string) => string;
  /** Injectable existence check (default: `node:fs.existsSync`). For unit tests. */
  existsImpl?: (absPath: string) => boolean;
  /** Injectable path joiner (default: POSIX-style join). For unit tests. */
  joinImpl?: (...segments: string[]) => string;
}

// ── Front-matter parse (name only; we never rewrite the body) ──────────────────

/**
 * Pull the `name:` out of a `SKILL.md`'s YAML front-matter. We read the REAL file
 * and confirm its declared name matches the directory we loaded it from — proof
 * the worker runs the authored skill, not a re-authored copy. Throws on a missing
 * front-matter (a malformed skill is a load refusal, never a silent skip).
 */
export function parseSkillName(markdown: string): string {
  const fm = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !fm[1]) {
    throw new Error("SKILL.md is missing its YAML front-matter (cannot confirm skill identity)");
  }
  const nameLine = fm[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l));
  if (!nameLine) {
    throw new Error("SKILL.md front-matter has no `name:` field (cannot confirm skill identity)");
  }
  return nameLine.replace(/^name\s*:/, "").trim();
}

// ── Loader ─────────────────────────────────────────────────────────────────────

/** Infer the apps/seo app root. */
function inferAppRoot(): string {
  // This file compiles to dist/worker/skills/load-suite.js in the image and runs
  // from src/worker/skills/load-suite.ts in CI. The worker ENTRYPOINT runs from
  // the app root (/home/worker/app), so process.cwd() is the robust default;
  // callers pass an explicit appRoot when needed (tests, custom layouts).
  return process.cwd();
}

/**
 * Load the suite skills for one run and wire their kernel host. Reads each
 * requested skill's REAL `SKILL.md` verbatim from the vendored package (DR-022),
 * confirms its front-matter identity, and returns the loaded descriptors plus the
 * kernel base URL + route map the skills drive. Fail-closed: a missing skill file
 * or an unknown requested skill throws (never a degraded, partial suite).
 */
export function loadSuite(opts: LoadSuiteOptions): LoadedSuite {
  if (!opts.kernelBaseUrl) {
    throw new Error("loadSuite requires a kernelBaseUrl (the apps/seo /content/api host) — fail-closed");
  }

  const join =
    opts.joinImpl ??
    ((...segments: string[]) =>
      segments
        .join("/")
        .replace(/\/{2,}/g, "/"));
  const readFileImpl = opts.readFileImpl ?? ((absPath: string) => readFileSync(absPath, "utf8"));
  const existsImpl = opts.existsImpl ?? ((absPath: string) => existsSync(absPath));

  const appRoot = opts.appRoot ?? inferAppRoot();
  const requested = opts.requested ?? [SINGLE_DRAFTER_SKILL];

  const suiteRoot = join(appRoot, SUITE_PACKAGE_REL_ROOT);

  const skills: LoadedSkill[] = requested.map((name) => {
    if (!(SUITE_SKILLS as readonly string[]).includes(name)) {
      throw new Error(
        `loadSuite: '${name}' is not a known suite skill (known: ${SUITE_SKILLS.join(", ")})`,
      );
    }
    const skillPath = join(suiteRoot, name, "SKILL.md");
    if (!existsImpl(skillPath)) {
      throw new Error(
        `loadSuite: SKILL.md not found at '${skillPath}'. The vendored suite (DR-022) must be ` +
          "present (in the worktree/CI, and COPY'd into the Sandbox image by the Dockerfile).",
      );
    }
    const markdown = readFileImpl(skillPath);
    const frontMatterName = parseSkillName(markdown);
    if (frontMatterName !== name) {
      throw new Error(
        `loadSuite: SKILL.md at '${skillPath}' declares name='${frontMatterName}' ` +
          `but lives in '${name}/' — refusing to load a mismatched skill (DR-022 identity check).`,
      );
    }
    return { name: name as SuiteSkillName, skillPath, frontMatterName, markdown };
  });

  return {
    skills,
    kernelBaseUrl: opts.kernelBaseUrl.replace(/\/+$/, ""),
    kernelRoutes: KERNEL_ROUTES,
    skillNames: skills.map((s) => s.name),
  };
}

/**
 * Assert a loaded suite is kernel-backed: it points at the apps/seo
 * `/content/api/draft` route (the kernel the skill drives) and did NOT swallow
 * the route map. This is the structural proof for AC2 — the skill orchestrates
 * the kernel route, it does not re-implement scoring/persistence in markdown. A
 * non-empty return lists the violations (empty == kernel-backed).
 */
export function assertSuiteIsKernelBacked(suite: LoadedSuite): string[] {
  const violations: string[] = [];
  if (suite.kernelRoutes.draft !== KERNEL_ROUTES.draft) {
    violations.push("kernelRoutes.draft does not equal the canonical /content/api/draft route");
  }
  if (!suite.kernelBaseUrl) {
    violations.push("kernelBaseUrl is empty — the skill has no host to drive");
  }
  // The drafter skill must be loaded as the REAL SKILL.md (markdown present + the
  // kernel-backed contract phrased in it), not a stub.
  const drafter = suite.skills.find((s) => s.name === SINGLE_DRAFTER_SKILL);
  if (!drafter) {
    violations.push(`the single-drafter skill '${SINGLE_DRAFTER_SKILL}' is not loaded`);
  } else if (!/kernel-backed/i.test(drafter.markdown) || !/draft route/i.test(drafter.markdown)) {
    violations.push(
      "the loaded seo-blog-writer SKILL.md does not declare the kernel-backed draft-route contract " +
        "(it may be a re-authored copy, not the real skill)",
    );
  }
  return violations;
}
