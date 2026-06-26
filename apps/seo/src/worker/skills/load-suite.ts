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
 * FULL CHAIN (PR 014 / P1.W.1). PR 008 registered ONLY `seo-blog-writer` (the
 * single-drafter path). PR 014 wires the remaining three suite skills —
 * `seo-strategist`, `seo-assistant`, `seo-audit` — loaded + run DIRECTLY (NOT
 * re-authored), completing the typed-handoff chain:
 *
 *     seo-strategist --ContentStrategy--> seo-assistant --ContentBrief-->
 *       seo-blog-writer --ContentDraft--> seo-audit --AuditResult-->
 *
 * Each chain stage drives ITS kernel route (the routes ARE the toolset; no skill
 * re-implements the kernel in markdown — the cardinal sin): strategist + assistant
 * drive `/content/api/brief`, the writer drives `/content/api/draft`, the auditor
 * drives `/content/api/audit` + `/content/api/publish`. The loaded set is still the
 * explicit `requested` list; `SUITE_CHAIN` is the canonical full-chain ordering
 * the worker requests for an end-to-end run (default remains the PR 008
 * single-drafter `[seo-blog-writer]` for back-compat).
 *
 * PURE-ISH / ISOMORPHIC: imports only `node:fs`/`node:path` + the shared kernel
 * route enum. No Next APIs, no DB, no SDK import (the SDK consumes the loaded
 * descriptors; this module produces them). The fs read is injectable so the load
 * + kernel-drive logic is unit-testable without a live Sandbox. Clean ASCII/UTF-8.
 */

import { readFileSync, existsSync } from "node:fs";

import { KERNEL_ROUTES, type KernelRouteName } from "../../lib/content/contract";

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

/**
 * The canonical full self-revising chain ordering (PR 014). This is the order the
 * typed handoff flows (`ContentStrategy -> ContentBrief -> ContentDraft ->
 * AuditResult`) and the set the worker requests for an end-to-end run. The order
 * is load-bearing: the strategist (Stage 0, human-gated) precedes the assistant,
 * and the auditor is last (it owns the publish gate).
 */
export const SUITE_CHAIN = [
  "seo-strategist",
  "seo-assistant",
  "seo-blog-writer",
  "seo-audit",
] as const;

/**
 * The kernel route(s) each suite skill DRIVES, plus the phrase its REAL SKILL.md
 * uses to declare the contract. `assertSuiteIsKernelBacked` checks the loaded
 * markdown declares BOTH `kernel-backed` AND the route phrase, so a re-authored
 * stub (which would drop the contract language) is rejected — the structural proof
 * for AC1/AC2 that each stage orchestrates its kernel route rather than
 * re-implementing the kernel in markdown.
 *
 * The phrases are the verbatim substrings the vendored SKILL.md files carry
 * (case-insensitive): the strategist + assistant say "brief route", the writer
 * "draft route", the auditor "audit route" + "publish route" (it drives both).
 */
export const SKILL_KERNEL_CONTRACT: Record<
  SuiteSkillName,
  { routes: KernelRouteName[]; markdownRoutePhrases: RegExp[] }
> = {
  "seo-strategist": { routes: ["brief"], markdownRoutePhrases: [/brief route/i] },
  "seo-assistant": { routes: ["brief"], markdownRoutePhrases: [/brief route/i] },
  "seo-blog-writer": { routes: ["draft"], markdownRoutePhrases: [/draft route/i] },
  "seo-audit": {
    routes: ["audit", "publish"],
    markdownRoutePhrases: [/audit route/i, /publish route/i],
  },
};

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
 * Assert a loaded suite is kernel-backed: it points at the canonical apps/seo
 * `/content/api/*` routes (the kernel the skills drive) and did NOT swallow the
 * route map. This is the structural proof for AC1/AC2 — EVERY loaded skill
 * orchestrates ITS kernel route(s); none re-implements scoring/persistence in
 * markdown. A non-empty return lists the violations (empty == kernel-backed).
 *
 * Generalized over the full chain (PR 014): each loaded skill's REAL SKILL.md
 * must declare both `kernel-backed` AND the route phrase(s) for the route(s) it
 * drives (per `SKILL_KERNEL_CONTRACT`), and the corresponding `kernelRoutes`
 * entry must equal the canonical route. The PR 008 drafter-only invariant is the
 * special case where only `seo-blog-writer` is loaded.
 */
export function assertSuiteIsKernelBacked(suite: LoadedSuite): string[] {
  const violations: string[] = [];
  if (!suite.kernelBaseUrl) {
    violations.push("kernelBaseUrl is empty — the skill has no host to drive");
  }

  if (suite.skills.length === 0) {
    violations.push("no skills are loaded — there is nothing to drive the kernel");
  }

  for (const skill of suite.skills) {
    const contract = SKILL_KERNEL_CONTRACT[skill.name];
    // Each route the skill drives must be wired to its canonical /content/api path.
    for (const route of contract.routes) {
      if (suite.kernelRoutes[route] !== KERNEL_ROUTES[route]) {
        violations.push(
          `kernelRoutes.${route} does not equal the canonical ${KERNEL_ROUTES[route]} route ` +
            `(driven by '${skill.name}')`,
        );
      }
    }
    // The loaded SKILL.md must be the REAL file (declares kernel-backed + its route
    // phrase), not a re-authored stub that dropped the contract language.
    if (!/kernel-backed/i.test(skill.markdown)) {
      violations.push(
        `the loaded ${skill.name} SKILL.md does not declare 'kernel-backed' ` +
          "(it may be a re-authored copy, not the real skill)",
      );
    }
    for (const phrase of contract.markdownRoutePhrases) {
      if (!phrase.test(skill.markdown)) {
        violations.push(
          `the loaded ${skill.name} SKILL.md does not declare its kernel route contract ` +
            `(missing ${phrase} — it may be a re-authored copy that re-implements the kernel)`,
        );
      }
    }
  }
  return violations;
}
