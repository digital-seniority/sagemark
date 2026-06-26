/**
 * Vercel Sandbox provisioning + the hardened-profile / fail-closed boot contract
 * (PR 006 / P0.W.2 + PR 006b / P0.W.3, lane worker-runtime). D5/D9: the autonomous
 * worker runs in a per-run Firecracker microVM.
 *
 * THIS IS THE HIGHEST-RISK SURFACE IN PHASE 0. It APPLIES the named runtime
 * capability-denial profile (`capability-profile.ts`, PR 006b) — the standing
 * formalization of the controls PR 000 proved enforceable
 * (`apps/seo/spike/capability-enforcement/`, [[DR-010]]/[[DR-011]]/[[DR-016]]) —
 * and turns it into the REAL launcher. PR 006 proved these controls inline; PR
 * 006b extracted them into the profile so this file is now an APPLY-AND-PROVE
 * orchestrator over a single source of truth, not a second copy of the constants.
 *
 * THE CONTROLS IT APPLIES + PROVES (acceptance #5, fail-closed):
 *   1. EGRESS — default-deny `networkPolicy` allowlisting ONLY the Claude
 *      API/Gateway + the apps/seo host-tool bridge URL, plus an in-VM iptables
 *      DROP on the link-local MMDS range ([[DR-010]]), read-back-verified.
 *   2. ENV SCRUB — the worker env carries the per-run bridge JWT ONLY. No
 *      Supabase service key, no raw provider key, no cloud-metadata creds. The
 *      env is built + scanned by the profile module before provisioning.
 *   3. TOOL/FS DISABLE — no general shell/file/web tool is handed to the model; FS
 *      access is a workdir-scoped tool ([[DR-011]]). The launcher proves an
 *      out-of-jail probe path is refused at the tool layer AND that the model tool
 *      surface contains no disabled built-in / off-allowlist tool.
 *   4. RUN JWT present — the worker has its one credential.
 *
 * BOOT REFUSAL (the contract the spike's probe asserts). `assertControlsOrRefuse`
 * (in `capability-profile.ts`) is fail-closed: if ANY control is not provably in
 * force, the launcher throws `BootRefusedError` and NEVER spawns the loop.
 * Best-effort is forbidden.
 *
 * WARM-POOL HANDOFF. A pooled idle VM holds no tenant binding; on lease handoff
 * `wipeForHandoff` clears the working dir and restarts the `claude` subprocess so
 * run B cannot read run A's workdir/session residue (PRD §11.4 layer 5).
 *
 * SDK BINDING. Binds to the real `@vercel/sandbox` types, loads the module via a
 * guarded dynamic import (precise NEEDS-DEP error if absent), and builds the
 * egress control as the SDK `networkPolicy` create param.
 *
 * Clean ASCII / UTF-8. No Next APIs (non-serverless, long-running, hosted via the
 * Dockerfile + Sandbox).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  Sandbox as VercelSandbox,
  NetworkPolicy,
  CommandFinished as SdkCommandFinished,
} from "@vercel/sandbox";

import {
  // Egress
  DENY_CIDRS,
  LINK_LOCAL_CIDR,
  networkPolicyFor,
  policyReflectsAllowlist,
  // Env scrub
  buildWorkerEnv,
  scanEnvForSecrets,
  FORBIDDEN_ENV_KEYS,
  ALLOWED_ENV_KEYS,
  // Tool/FS surface
  MODEL_DISABLED_TOOLS,
  WORKER_ALLOWED_TOOLS,
  scanToolSurfaceForViolations,
  pathWithinWorkdir,
  proveFsJail,
  // Boot-refusal contract
  BootRefusedError,
  assertControlsOrRefuse,
  type LaunchProfile,
  type ControlEvidence,
} from "./capability-profile";

// ── Re-export the profile surface (PR 006 callers import these from here; the
//    profile is the single source of truth, this file applies it) ──────────────

export {
  DENY_CIDRS,
  LINK_LOCAL_CIDR,
  networkPolicyFor,
  policyReflectsAllowlist,
  buildWorkerEnv,
  scanEnvForSecrets,
  FORBIDDEN_ENV_KEYS,
  ALLOWED_ENV_KEYS,
  MODEL_DISABLED_TOOLS,
  WORKER_ALLOWED_TOOLS,
  scanToolSurfaceForViolations,
  pathWithinWorkdir,
  proveFsJail,
  BootRefusedError,
  assertControlsOrRefuse,
};
export type { LaunchProfile, ControlEvidence };

// ── SDK-facing surface (bound to the real types; see spike header) ─────────────

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

// ── Lease management ───────────────────────────────────────────────────────────

/**
 * A lease on a (possibly pooled) VM. The orchestrator hands a lease to a run;
 * the run releases it on completion / failure / timeout. A wedged run's lease is
 * reclaimed by the ceiling watchdog so no VM is left held.
 */
export interface VmLease {
  leaseId: string;
  /** The bound run while leased; null when the VM is idle in the pool. */
  binding: RunBindingLite | null;
}

/** Minimal binding view the lease carries (avoids a value import cycle). */
type RunBindingLite = LaunchProfile["binding"];

/**
 * Wipe a pooled VM's working dir and restart the `claude` subprocess on lease
 * handoff (PRD §11.4 layer 5). After this, run B leased onto the same VM cannot
 * read run A's workdir/session residue. Returns the evidence the test asserts.
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
 * Injectable seams so the Tier-1 test can assert the profile-applied + boot-
 * refusal logic without live infra (it injects a fake Sandbox + control probes).
 */
export interface LaunchDeps {
  loadSandboxImpl?: () => Promise<SandboxStatic>;
  hardenImpl?: (s: SandboxInstance) => Promise<{ mmdsBlocked: boolean }>;
  proveFsJailImpl?: (workdir: string) => boolean;
  scanEnvImpl?: (env: Record<string, string>) => string[];
  /** The model tool allowlist the worker will expose; defaults to the profile's
   *  curated surface. Verified to contain no disabled built-in / off-allowlist
   *  tool — a violation is a boot refusal (acceptance #3/#5). */
  modelToolAllowlist?: readonly string[];
}

/**
 * Provision a per-run microVM with the hardened profile, PROVE every control,
 * and REFUSE to boot if any control is missing (fail-closed, acceptance #5).
 * Returns the verified sandbox + evidence on success; throws `BootRefusedError`
 * otherwise. The caller (`agent-worker`) only spawns the loop on success.
 */
export async function launchSandbox(
  profile: LaunchProfile,
  deps: LaunchDeps = {},
): Promise<LaunchResult> {
  const loadSandboxImpl = deps.loadSandboxImpl ?? loadSandbox;
  const hardenImpl = deps.hardenImpl ?? hardenSandbox;
  const proveFsJailImpl = deps.proveFsJailImpl ?? proveFsJail;
  const scanEnvImpl = deps.scanEnvImpl ?? scanEnvForSecrets;
  const modelToolAllowlist = deps.modelToolAllowlist ?? WORKER_ALLOWED_TOOLS;

  // 0a. Build + scrub the env BEFORE provisioning (acceptance #2).
  const env = buildWorkerEnv(profile);
  const envOffenders = scanEnvImpl(env);
  const envScrubbed = envOffenders.length === 0;

  // 0b. Verify the model tool surface BEFORE provisioning (acceptance #3). A
  //     disabled built-in or off-allowlist tool means the model would be more
  //     capable than the safety model permits — fail closed (folded into fsJailed
  //     evidence, which is the tool-layer FS/shell denial control).
  const toolOffenders = scanToolSurfaceForViolations(modelToolAllowlist);
  const toolSurfaceClean = toolOffenders.length === 0;

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
  // fsJailed = the workdir-scoped tool refuses out-of-jail paths AND the model
  // tool surface exposes no raw shell/file/web tool ([[DR-011]] / acceptance #3).
  const fsJailed = proveFsJailImpl(profile.workdir) && toolSurfaceClean;
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
