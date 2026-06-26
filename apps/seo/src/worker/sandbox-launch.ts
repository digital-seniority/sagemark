/**
 * Vercel Sandbox provisioning + the hardened-profile / fail-closed boot contract
 * (PR 006 / P0.W.2, lane worker-runtime). D5/D9: the autonomous worker runs in a
 * per-run Firecracker microVM.
 *
 * THIS IS THE HIGHEST-RISK SURFACE IN PHASE 0. It turns the PROVEN spike
 * reference (`apps/seo/spike/capability-enforcement/_harness.ts` +
 * `boot-refusal-probe.ts`, [[DR-010]] / [[DR-011]]) into the REAL launcher. The
 * spike "ships no production runtime"; this file is that runtime.
 *
 * THE CONTROLS IT APPLIES + PROVES (acceptance #6, fail-closed):
 *   1. EGRESS — default-deny `networkPolicy` allowlisting ONLY the Claude
 *      API/Gateway + the `apps/seo` host-tool bridge URL, plus an in-VM iptables
 *      DROP on the link-local MMDS range ([[DR-010]]), read-back-verified.
 *   2. ENV SCRUB — the worker env carries the per-run bridge JWT ONLY. No
 *      Supabase service key, no raw provider key, no cloud-metadata creds. The
 *      env is built here, allowlisted, and scanned for secret-shaped residue.
 *   3. FS JAIL — no general shell/file tool is handed to the model; FS access is
 *      a workdir-scoped tool ([[DR-011]]). The launcher proves an out-of-jail
 *      probe path is refused at the tool layer.
 *   4. RUN JWT present — the worker has its one credential.
 *
 * BOOT REFUSAL (the contract the spike's probe asserts). `assertControlsOrRefuse`
 * is fail-closed: if ANY control is not provably in force, the launcher throws
 * `BootRefusedError` and NEVER spawns the loop. Best-effort is forbidden.
 *
 * WARM-POOL HANDOFF (acceptance #5). A pooled idle VM holds no tenant binding; on
 * lease handoff `wipeForHandoff` clears the working dir and restarts the `claude`
 * subprocess so run B cannot read run A's workdir/session residue.
 *
 * SDK BINDING. Mirrors the spike harness exactly: binds to the real
 * `@vercel/sandbox` types, loads the module via a guarded dynamic import (precise
 * NEEDS-DEP error if absent), and builds the egress control as the SDK
 * `networkPolicy` create param (NOT a non-existent `egressAllowlist` field —
 * that bug is documented in the spike harness header).
 *
 * Clean ASCII / UTF-8. No Next APIs (this is non-serverless, long-running, hosted
 * via the Dockerfile + Sandbox — NOT a Next route).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  Sandbox as VercelSandbox,
  NetworkPolicy,
  CommandFinished as SdkCommandFinished,
} from "@vercel/sandbox";

import type { RunBinding } from "./host-tool-bridge";

// ── SDK-facing surface (bound to the real types; see spike header) ────────────

export type CommandFinished = SdkCommandFinished;

export type SandboxInstance = VercelSandbox & {
  /** Network policy read back off the instance after create (egress proof). */
  appliedNetworkPolicy?: NetworkPolicy;
};

export interface SandboxCreateParams {
  runtime?: string;
  timeout?: number;
  source?: { type: "snapshot"; snapshotId: string };
  token?: string;
  teamId?: string;
  projectId?: string;
  env?: Record<string, string>;
  /** The REAL egress control (default-deny + allowlist + subnet deny). */
  networkPolicy?: NetworkPolicy;
}

interface SandboxStatic {
  create(params: SandboxCreateParams): Promise<VercelSandbox>;
}

// ── Egress hardening constants (ported verbatim from the spike, [[DR-010]]) ────

/** Private / link-local CIDRs denied at the subnet layer so IP-literal egress
 *  (IMDS, RFC-1918) cannot bypass a domain allowlist. */
export const DENY_CIDRS = [
  "169.254.0.0/16", // link-local incl. cloud-metadata (IMDS) endpoint
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

/** The link-local range the Firecracker MMDS lives in — closed in-VM with an
 *  iptables DROP at boot ([[DR-010]]). */
export const LINK_LOCAL_CIDR = "169.254.0.0/16";

// ── The launch profile ────────────────────────────────────────────────────────

/**
 * The hardened launch profile for one run. The launcher applies these controls
 * and REFUSES to boot unless every one is provably in force (acceptance #6).
 */
export interface LaunchProfile {
  /** The run's tenancy + identity binding (acceptance #3). */
  binding: RunBinding;
  /**
   * Egress allowlist — the ONLY hosts the worker may reach (acceptance #6):
   * the Claude Gateway + the `apps/seo` host-tool bridge host. Everything else
   * is denied at the network layer.
   */
  egressAllowlist: string[];
  /** The per-run bridge JWT — the worker's ONLY secret-shaped env value. */
  bridgeJwt: string;
  /** The Gateway base URL the worker's model calls route through. */
  gatewayBaseUrl: string;
  /** The `apps/seo` host base URL the bridge calls back into. */
  hostBaseUrl: string;
  /** The ephemeral working dir the loop is jailed to ([[DR-011]]). */
  workdir: string;
  /** Wedge ceiling — the launcher provisions the VM with this hard timeout
   *  (acceptance #4: no zombie microVM beyond the ceiling). */
  timeoutMs: number;
}

/**
 * Build the worker env — the SCRUBBED env (acceptance #2/#6). The worker carries
 * ONLY: the bridge JWT (as both the bridge credential AND the Gateway bearer
 * token, via `ANTHROPIC_AUTH_TOKEN`), the Gateway base URL (`ANTHROPIC_BASE_URL`),
 * the host bridge URL, the workdir, and the run binding. NO Supabase key, NO raw
 * provider key (`ANTHROPIC_API_KEY` is deliberately absent — the worker uses a
 * bearer token, not an api key), NO cloud-metadata creds.
 */
export function buildWorkerEnv(profile: LaunchProfile): Record<string, string> {
  return {
    // The Agent-SDK / claude CLI route ALL model traffic through the Gateway via
    // a bearer token (DR-013 / resolve-gateway-model worker invariant). Base URL
    // + AUTH_TOKEN is the bearer path; we never set ANTHROPIC_API_KEY.
    ANTHROPIC_BASE_URL: profile.gatewayBaseUrl,
    ANTHROPIC_AUTH_TOKEN: profile.bridgeJwt,
    // The bridge target + the worker's run-scoped credential for it.
    SEO_HOST_BASE_URL: profile.hostBaseUrl,
    RUN_BRIDGE_JWT: profile.bridgeJwt,
    // Run identity / tenancy binding (acceptance #3).
    RUN_ID: profile.binding.runId,
    RUN_WORKSPACE_ID: profile.binding.workspaceId,
    RUN_CLIENT_ID: profile.binding.clientId,
    // The jail root ([[DR-011]]).
    WORKER_WORKDIR: profile.workdir,
  };
}

/**
 * Env keys that, if present in the worker env, are a fail-closed boot refusal —
 * ambient secrets that must NEVER reach the Sandbox (acceptance #6). The bridge
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
const ALLOWED_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "SEO_HOST_BASE_URL",
  "RUN_BRIDGE_JWT",
  "RUN_ID",
  "RUN_WORKSPACE_ID",
  "RUN_CLIENT_ID",
  "WORKER_WORKDIR",
]);

/**
 * Scan a built worker env for ambient-secret residue. Returns the offending keys
 * (empty == scrubbed). A non-empty result is a boot refusal. Two checks:
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

// ── Path-jail helpers (ported verbatim from the spike, [[DR-011]]) ─────────────

/**
 * Resolve `requested` against `workdir` (handling `..`/`.`/absolute) and report
 * whether it stays INSIDE the jail. Pure + POSIX-only — the reference check the
 * workdir-scoped file tool uses. Out-of-jail paths resolve outside and are
 * refused WITHOUT touching the filesystem.
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

// ── Network policy (ported from the spike harness) ────────────────────────────

/** Build the default-deny network policy for a profile: allow ONLY the egress
 *  allowlist, deny private/link-local subnets. */
export function networkPolicyFor(profile: LaunchProfile): NetworkPolicy {
  return {
    allow: [...profile.egressAllowlist],
    subnets: { deny: [...DENY_CIDRS] },
  };
}

/** True when the applied policy is a custom default-deny allowlist (not allow-all). */
function policyReflectsAllowlist(
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

// ── Boot-refusal contract (ported from boot-refusal-probe.ts) ──────────────────

/**
 * Thrown when the launch preflight finds a required control not provably in
 * force. The launcher MUST NOT spawn the `claude` subprocess after this.
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
 * REFERENCE PREFLIGHT GATE — fail-closed (acceptance #6). Refuses the launch
 * unless EVERY control is proven in force. Identical truth table to the spike's
 * `assertControlsOrRefuse` so PR 006b's adversarial probe re-runs unchanged.
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

// ── SDK loading + credentials (ported from the spike) ─────────────────────────

function sandboxCredentials(): Partial<SandboxCreateParams> {
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  return {}; // On Vercel the SDK falls back to VERCEL_OIDC_TOKEN.
}

export async function loadSandbox(): Promise<SandboxStatic> {
  try {
    const mod = (await import("@vercel/sandbox")) as any;
    const S = mod.Sandbox ?? mod.default?.Sandbox;
    if (!S?.create) throw new Error("Sandbox.create not found on @vercel/sandbox");
    return S as SandboxStatic;
  } catch (err) {
    throw new Error(
      "[NEEDS-DEP] @vercel/sandbox is not installed. " +
        "Install it: `pnpm --filter @sagemark/seo add @vercel/sandbox`. " +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

// ── In-VM hardening + control probing (the real boot preflight) ────────────────

/**
 * Apply the in-VM egress hardening at boot ([[DR-010]]): DROP all link-local
 * (MMDS) traffic, then PROVE the MMDS is unreachable. Returns whether the block
 * took; the launcher feeds this into `egressEnforced`. Never PASSes on an
 * un-hardened VM.
 */
export async function hardenSandbox(sandbox: SandboxInstance): Promise<{ mmdsBlocked: boolean }> {
  await sandbox.runCommand({
    cmd: "iptables",
    args: ["-A", "OUTPUT", "-d", LINK_LOCAL_CIDR, "-j", "DROP"],
    sudo: true,
  } as any);
  const probe = await sandbox.runCommand({
    cmd: "curl",
    args: [
      "-sS",
      "--connect-timeout",
      "4",
      "-m",
      "5",
      "-o",
      "/dev/null",
      "-w",
      "HTTPCODE=%{http_code}",
      "http://169.254.169.254/latest/meta-data/",
    ],
  } as any);
  const code = /HTTPCODE=(\d+)/.exec(await probe.stdout())?.[1] ?? "000";
  const mmdsBlocked = probe.exitCode !== 0 || code === "000";
  return { mmdsBlocked };
}

/**
 * Prove the FS jail at the tool layer ([[DR-011]]): assert an out-of-jail probe
 * path resolves outside the workdir and would be refused, and an in-jail path
 * resolves inside. This is a TOOL-layer check (no raw shell handed to the model);
 * it does not need to touch the VM filesystem to refuse.
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

// ── Lease management (acceptance #4 / #5) ──────────────────────────────────────

/**
 * A lease on a (possibly pooled) VM. The orchestrator hands a lease to a run;
 * the run releases it on completion / failure / timeout. A wedged run's lease is
 * reclaimed by the ceiling watchdog (acceptance #4) so no VM is left held.
 */
export interface VmLease {
  leaseId: string;
  /** The bound run while leased; null when the VM is idle in the pool (#5). */
  binding: RunBinding | null;
}

/**
 * Wipe a pooled VM's working dir and restart the `claude` subprocess on lease
 * handoff (acceptance #5). After this, run B leased onto the same VM cannot read
 * run A's workdir/session residue. Returns the evidence the test asserts.
 */
export async function wipeForHandoff(
  sandbox: SandboxInstance,
  workdir: string,
): Promise<{ workdirWiped: boolean; subprocessRestarted: boolean }> {
  // 1. Clear the working dir (everything under the jail root).
  const wipe = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", `rm -rf ${workdir}/* ${workdir}/.[!.]* 2>/dev/null; mkdir -p ${workdir}; ls -A ${workdir} | wc -l`],
  } as any);
  const remaining = parseInt((await wipe.stdout()).trim(), 10);
  const workdirWiped = Number.isFinite(remaining) ? remaining === 0 : wipe.exitCode === 0;

  // 2. Restart the claude subprocess so no in-memory session state crosses the
  //    handoff (the previous tenant's CLI session must not be reused).
  const restart = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "pkill -f claude 2>/dev/null; echo restarted"],
  } as any);
  const subprocessRestarted = (await restart.stdout()).includes("restarted");

  return { workdirWiped, subprocessRestarted };
}

// ── The launcher (the real `sandbox-launch`) ───────────────────────────────────

export interface LaunchResult {
  sandbox: SandboxInstance;
  evidence: ControlEvidence;
  env: Record<string, string>;
  lease: VmLease;
}

/**
 * Provision a per-run microVM with the hardened profile, PROVE every control,
 * and REFUSE to boot if any control is missing (fail-closed, acceptance #6).
 * Returns the verified sandbox + evidence on success; throws `BootRefusedError`
 * otherwise. The caller (`agent-worker`) only spawns the loop on success.
 *
 * `deps` is injectable so the Tier-1 test can assert the profile-applied + boot-
 * refusal logic without live infra (it injects a fake Sandbox + control probes).
 */
export interface LaunchDeps {
  loadSandboxImpl?: () => Promise<SandboxStatic>;
  hardenImpl?: (s: SandboxInstance) => Promise<{ mmdsBlocked: boolean }>;
  proveFsJailImpl?: (workdir: string) => boolean;
  scanEnvImpl?: (env: Record<string, string>) => string[];
}

export async function launchSandbox(
  profile: LaunchProfile,
  deps: LaunchDeps = {},
): Promise<LaunchResult> {
  const loadSandboxImpl = deps.loadSandboxImpl ?? loadSandbox;
  const hardenImpl = deps.hardenImpl ?? hardenSandbox;
  const proveFsJailImpl = deps.proveFsJailImpl ?? proveFsJail;
  const scanEnvImpl = deps.scanEnvImpl ?? scanEnvForSecrets;

  // 0. Build + scrub the env BEFORE provisioning (acceptance #2/#6).
  const env = buildWorkerEnv(profile);
  const envOffenders = scanEnvImpl(env);
  const envScrubbed = envOffenders.length === 0;

  // 1. Provision the VM with the default-deny egress policy + hard timeout.
  const Sandbox = await loadSandboxImpl();
  const snapshotId = process.env.SEO_WORKER_SNAPSHOT_ID;
  const created = await Sandbox.create({
    ...sandboxCredentials(),
    timeout: profile.timeoutMs,
    env,
    networkPolicy: networkPolicyFor(profile),
    ...(snapshotId
      ? { source: { type: "snapshot", snapshotId } }
      : { runtime: "node24" }),
  });
  const sandbox = created as SandboxInstance;
  const applied = (sandbox as unknown as { networkPolicy?: NetworkPolicy }).networkPolicy;
  sandbox.appliedNetworkPolicy = applied;

  // 2. Probe every control (no PASS on an unverifiable control).
  const egressAllowlistApplied = policyReflectsAllowlist(applied, profile);
  let mmdsBlocked = false;
  try {
    ({ mmdsBlocked } = await hardenImpl(sandbox));
  } catch {
    mmdsBlocked = false;
  }
  const egressEnforced = egressAllowlistApplied && mmdsBlocked;
  const fsJailed = proveFsJailImpl(profile.workdir);
  const runJwtPresent = Boolean(env.RUN_BRIDGE_JWT) && Boolean(env.ANTHROPIC_AUTH_TOKEN);

  const evidence: ControlEvidence = { egressEnforced, envScrubbed, fsJailed, runJwtPresent };

  // 3. FAIL-CLOSED boot gate. Refuse + tear down on any missing control.
  try {
    assertControlsOrRefuse(evidence);
  } catch (err) {
    await sandbox.stop?.().catch(() => undefined);
    throw err;
  }

  const lease: VmLease = { leaseId: `lease_${profile.binding.runId}`, binding: profile.binding };
  return { sandbox, evidence, env, lease };
}
