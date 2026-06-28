/**
 * Worker runtime capability-denial profile (PR 006b / P0.W.3, lane worker-runtime).
 *
 * THE STANDING SAFETY PROFILE. This module is the single, named home of the
 * fail-closed runtime capability controls the Sandbox worker boots under. It
 * makes the "the agent has ONLY typed host tools (serpFetch/runGate/persistPiece)
 * and no raw HTTP/publish" safety claim (PRD §11.3) a RUNTIME-ENFORCED fact, not
 * a paper convention — because the Agent SDK actually spawns a real `claude` CLI
 * subprocess with a general-purpose shell + an on-disk workspace, the gap between
 * "what the SDK hands the worker by default" and "what the safety model permits"
 * is closed HERE, before the loop starts.
 *
 * PR 006 (#17) proved each control inline in `sandbox-launch.ts`; PR 000 (#3)
 * proved each control enforceable on real Firecracker VMs. PR 006b EXTRACTS those
 * proven controls into this profile module so:
 *   - `sandbox-launch.ts` imports + applies the named profile (one source of truth);
 *   - the adversarial confinement suite (capability-denial.test.ts /
 *     egress-allowlist.test.ts) regresses the profile directly;
 *   - a future runtime change must change ONE profile, not scattered constants.
 *
 * THE FOUR CONTROLS (each fail-closed; a missing control ⇒ boot refusal):
 *   1. EGRESS  — default-deny SDK `networkPolicy` allowlisting ONLY the Gateway +
 *      the apps/seo host-tool bridge, PLUS an in-VM iptables DROP on the
 *      link-local MMDS range ([[DR-010]]). IP-literal egress (IMDS / RFC-1918) is
 *      denied at the subnet layer so it cannot bypass the domain allowlist.
 *   2. ENV SCRUB — the worker env carries ONLY the per-run bridge JWT (scoped
 *      (workspace_id, client_id, run_id)). No Supabase service key, no raw
 *      provider key, no cloud-metadata creds ([[DR-016]] Gateway-only invariant).
 *   3. TOOL/FS DISABLE — the model is handed NO general Bash/Read/Write/WebFetch
 *      built-ins; the only FS access is a workdir-scoped tool that refuses
 *      out-of-jail paths at the tool layer ([[DR-011]]). The model's tool surface
 *      is a curated allowlist (persistPiece + readWorkdirFile only).
 *   4. RUN JWT present — the worker holds its one credential.
 *
 * Pure / isomorphic: no Next APIs, no DB, no SDK import. The SDK-facing types come
 * from `@vercel/sandbox` as TYPE-ONLY imports (erased at runtime), so this module
 * loads with no infra. Clean ASCII / UTF-8.
 */

import type { NetworkPolicy } from "@vercel/sandbox";

import type { RunBinding } from "./host-tool-bridge";

// ── Egress hardening constants ([[DR-010]], ported verbatim from the spike) ─────

/** Private / link-local CIDRs denied at the subnet layer so IP-literal egress
 *  (IMDS, RFC-1918) cannot bypass a domain allowlist. `subnets.deny` takes
 *  precedence over allowed domains in the SDK. */
export const DENY_CIDRS = [
  "169.254.0.0/16", // link-local incl. cloud-metadata (IMDS) endpoint
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16", // a /16; /8 is unaligned and the Sandbox API rejects it 400
];

/** The link-local range the Firecracker MMDS lives in — closed in-VM with an
 *  iptables DROP at boot ([[DR-010]]). The SDK egress policy CANNOT refuse the
 *  MMDS (it is answered hypervisor-locally, never leaves the VM); the in-VM block
 *  can. */
export const LINK_LOCAL_CIDR = "169.254.0.0/16";

// ── Model tool-surface policy ([[DR-011]]) ─────────────────────────────────────

/**
 * The general-purpose `claude` CLI built-in tools that MUST be removed from the
 * model's surface (acceptance #3). The worker passes `tools: []` to strip ALL
 * built-ins; this named list is the explicit denial set the profile asserts +
 * documents, so a regression that re-enables any of them is caught by the
 * capability-denial suite. None of these may be reachable by the model.
 */
export const MODEL_DISABLED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "NotebookEdit",
] as const;

/**
 * The ONLY tools the model may call — the curated host-tool MCP surface
 * (acceptance #4). `persistPiece` (the sole host-validated mutation path) and
 * `readWorkdirFile` (the workdir-scoped read that refuses out-of-jail paths at
 * the tool layer). Deliberately ABSENT: any publish tool, any general write /
 * shell / arbitrary-file / raw-HTTP tool. `agent-worker.ts` builds its
 * `allowedTools` from this list so the surface has one source of truth.
 */
export const WORKER_ALLOWED_TOOLS = [
  "mcp__seo-worker-host-tools__persistPiece",
  "mcp__seo-worker-host-tools__persistStrategy",
  "mcp__seo-worker-host-tools__requestImages",
  "mcp__seo-worker-host-tools__readWorkdirFile",
] as const;

/** Assert a proposed model tool allowlist contains no disabled built-in and no
 *  tool outside the curated host-tool surface. Returns the offending tool names
 *  (empty == clean). A non-empty result is a boot refusal (acceptance #3/#5). */
export function scanToolSurfaceForViolations(allowedTools: readonly string[]): string[] {
  const allowed = new Set<string>(WORKER_ALLOWED_TOOLS);
  const disabled = new Set<string>(MODEL_DISABLED_TOOLS);
  const offenders: string[] = [];
  for (const t of allowedTools) {
    // A bare built-in name (Bash/Read/...) or anything not on the curated
    // host-tool allowlist is a violation.
    if (disabled.has(t) || !allowed.has(t)) offenders.push(t);
  }
  return offenders;
}

// ── The launch profile ─────────────────────────────────────────────────────────

/**
 * The hardened launch profile for one run. The launcher applies these controls
 * and REFUSES to boot unless every one is provably in force (acceptance #5).
 */
export interface LaunchProfile {
  /** The run's tenancy + identity binding. */
  binding: RunBinding;
  /**
   * Egress allowlist — the ONLY hosts the worker may reach (acceptance #1): the
   * Claude Gateway + the apps/seo host-tool bridge host. Everything else is
   * denied at the network layer.
   */
  egressAllowlist: string[];
  /** The per-run bridge JWT — the worker's ONLY secret-shaped env value. */
  bridgeJwt: string;
  /** The Gateway base URL the worker's model calls route through ([[DR-016]]). */
  gatewayBaseUrl: string;
  /** The apps/seo host base URL the bridge calls back into. */
  hostBaseUrl: string;
  /** The ephemeral working dir the loop is jailed to ([[DR-011]]). */
  workdir: string;
  /** Wedge ceiling — the launcher provisions the VM with this hard timeout. */
  timeoutMs: number;
  /**
   * Optional run mode threaded from the host to the worker. Controls which skill(s)
   * are loaded as the model's systemPrompt. Absent = single-drafter (back-compat).
   */
  workerMode?: string;
}

// ── Env scrub (acceptance #2) ──────────────────────────────────────────────────

/**
 * Build the worker env — the SCRUBBED env. The worker carries ONLY: the bridge
 * JWT (as both the bridge credential AND the Gateway bearer token, via
 * `ANTHROPIC_AUTH_TOKEN`), the Gateway base URL (`ANTHROPIC_BASE_URL`), the host
 * bridge URL, the workdir, and the run binding. NO Supabase key, NO raw provider
 * key (`ANTHROPIC_API_KEY` is deliberately absent — the worker uses a bearer
 * token, not an api key), NO cloud-metadata creds.
 */
export function buildWorkerEnv(profile: LaunchProfile): Record<string, string> {
  return {
    // The Agent-SDK / claude CLI routes ALL model traffic through the Gateway via
    // a bearer token ([[DR-016]] Gateway-only invariant). Base URL + AUTH_TOKEN is
    // the bearer path; we never set ANTHROPIC_API_KEY.
    ANTHROPIC_BASE_URL: profile.gatewayBaseUrl,
    ANTHROPIC_AUTH_TOKEN: profile.bridgeJwt,
    // The bridge target + the worker's run-scoped credential for it.
    SEO_HOST_BASE_URL: profile.hostBaseUrl,
    RUN_BRIDGE_JWT: profile.bridgeJwt,
    // Run identity / tenancy binding.
    RUN_ID: profile.binding.runId,
    RUN_WORKSPACE_ID: profile.binding.workspaceId,
    RUN_CLIENT_ID: profile.binding.clientId,
    // Non-secret project + mode (present for hub strategy/authoring runs only).
    ...(profile.binding.projectId ? { RUN_PROJECT_ID: profile.binding.projectId } : {}),
    ...(profile.workerMode ? { WORKER_MODE: profile.workerMode } : {}),
    // The jail root ([[DR-011]]).
    WORKER_WORKDIR: profile.workdir,
  };
}

/**
 * Env keys that, if present in the worker env, are a fail-closed boot refusal —
 * ambient secrets that must NEVER reach the Sandbox (acceptance #2). The bridge
 * JWT is the only secret-shaped value permitted (carried under the allowlisted
 * keys above).
 */
export const FORBIDDEN_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY", // raw provider key — worker uses a bearer token only
  "AI_GATEWAY_API_KEY", // ambient gateway key — worker uses the per-run JWT only
  "OPENROUTER_API_KEY",
  "VERCEL_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

/** The allowlisted env keys the worker is permitted to carry. */
export const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "SEO_HOST_BASE_URL",
  "RUN_BRIDGE_JWT",
  "RUN_ID",
  "RUN_WORKSPACE_ID",
  "RUN_CLIENT_ID",
  "RUN_PROJECT_ID", // non-secret: the project the strategy/authoring run belongs to
  "WORKER_MODE", // non-secret: standalone-strategy | standalone-author | single-drafter
  "WORKER_WORKDIR",
]);

/**
 * Scan a built worker env for ambient-secret residue (acceptance #2). Returns the
 * offending keys (empty == scrubbed). A non-empty result is a boot refusal. Two
 * checks:
 *   - any FORBIDDEN key present;
 *   - any key OUTSIDE the allowlist whose value looks secret-shaped (long /
 *     high-entropy-ish), to catch a renamed leak.
 */
export function scanEnvForSecrets(env: Record<string, string>): string[] {
  const offenders: string[] = [];
  for (const key of Object.keys(env)) {
    if (FORBIDDEN_ENV_KEYS.includes(key)) {
      offenders.push(key);
      continue;
    }
    if (!ALLOWED_ENV_KEYS.has(key)) {
      const v = env[key] ?? "";
      // Heuristic: an unexpected key carrying a long opaque value is a leak.
      if (v.length >= 24 && /^[A-Za-z0-9._-]+$/.test(v)) {
        offenders.push(key);
      }
    }
  }
  return offenders;
}

// ── Path-jail helpers ([[DR-011]], ported verbatim from the spike) ─────────────

/**
 * Resolve `requested` against `workdir` (handling `..`/`.`/absolute) and report
 * whether it stays INSIDE the jail. Pure + POSIX-only — the reference check the
 * workdir-scoped file tool uses. Out-of-jail paths resolve outside and are
 * refused WITHOUT touching the filesystem (acceptance #3).
 */
export function pathWithinWorkdir(workdir: string, requested: string): boolean {
  const norm = (p: string): string[] => {
    const segs: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") segs.pop();
      else segs.push(seg);
    }
    return segs;
  };
  const base = norm(workdir);
  const target = requested.startsWith("/") ? norm(requested) : norm(`${workdir}/${requested}`);
  if (target.length < base.length) return false;
  return base.every((seg, i) => target[i] === seg);
}

/**
 * Prove the FS jail at the tool layer ([[DR-011]] / acceptance #3): assert a set
 * of representative out-of-jail probe paths (host secrets, a sibling run's dir, a
 * `../` traversal) all resolve outside the workdir and would be refused, and an
 * in-jail path resolves inside. This is a TOOL-layer check (no raw shell handed to
 * the model); it does not touch the VM filesystem to refuse.
 */
export function proveFsJail(workdir: string): boolean {
  const outOfJail = [
    "/etc/shadow",
    "/proc/1/environ",
    "../sibling-run/secret",
    `${workdir}/../escape`,
  ];
  const inJail = `${workdir}/draft.md`;
  const allOutRefused = outOfJail.every((p) => !pathWithinWorkdir(workdir, p));
  const inAllowed = pathWithinWorkdir(workdir, inJail);
  return allOutRefused && inAllowed;
}

// ── Network policy ([[DR-010]], ported from the spike harness) ─────────────────

/** Build the default-deny network policy for a profile: allow ONLY the egress
 *  allowlist, deny private/link-local subnets (acceptance #1). */
export function networkPolicyFor(profile: LaunchProfile): NetworkPolicy {
  return {
    allow: [...profile.egressAllowlist],
    subnets: { deny: [...DENY_CIDRS] },
  };
}

/** True when the applied policy is a custom default-deny allowlist (not allow-all
 *  / undefined / a dropped field). The launcher reads the policy back off the
 *  created instance and feeds this into `egressEnforced`. */
export function policyReflectsAllowlist(
  applied: NetworkPolicy | undefined,
  profile: LaunchProfile,
): boolean {
  if (!applied || applied === "allow-all") return false;
  if (applied === "deny-all") return profile.egressAllowlist.length === 0;
  const allow = (applied as { allow?: unknown }).allow;
  if (Array.isArray(allow)) return allow.length > 0;
  if (allow && typeof allow === "object") return Object.keys(allow).length > 0;
  return false;
}

// ── Boot-refusal contract ([[DR-010]]/[[DR-011]], ported from boot-refusal-probe) ─

/**
 * Thrown when the launch preflight finds a required control not provably in
 * force. The launcher MUST NOT spawn the `claude` subprocess after this
 * (acceptance #5, fail-closed).
 */
export class BootRefusedError extends Error {
  constructor(
    readonly control: string,
    message: string,
  ) {
    super(`[boot-refused:${control}] ${message}`);
    this.name = "BootRefusedError";
  }
}

/**
 * The proof each control applied, collected by probing the freshly-created
 * sandbox (egress read-back + MMDS block, env scan, out-of-jail probe) BEFORE
 * the loop is handed the VM. Mirrors the spike's `ControlEvidence` truth table.
 */
export interface ControlEvidence {
  /** Allowlist read-back reflected the intended hosts AND the MMDS block took. */
  egressEnforced: boolean;
  /** Env scan found no secret-shaped value beyond the run JWT. */
  envScrubbed: boolean;
  /** An out-of-workdir read smoke test was refused at the tool layer. */
  fsJailed: boolean;
  /** The run JWT is present (worker has its one credential). */
  runJwtPresent: boolean;
}

/**
 * FAIL-CLOSED PREFLIGHT GATE (acceptance #5). Refuses the launch unless EVERY
 * control is proven in force. Identical truth table to the spike's
 * `assertControlsOrRefuse` so the adversarial probe re-runs unchanged. Best-effort
 * is forbidden: a missing control throws `BootRefusedError` and the loop is never
 * spawned.
 */
export function assertControlsOrRefuse(ev: ControlEvidence): void {
  if (!ev.runJwtPresent)
    throw new BootRefusedError("run-jwt", "worker has no run JWT — cannot authenticate to the bridge");
  if (!ev.egressEnforced)
    throw new BootRefusedError("egress", "egress allowlist / MMDS block not provably enforced");
  if (!ev.envScrubbed)
    throw new BootRefusedError("env-scrub", "env carries a secret-shaped value beyond the run JWT");
  if (!ev.fsJailed)
    throw new BootRefusedError("fs-jail", "workdir jail not provably enforced");
  // All controls proven → caller may start the loop.
}
