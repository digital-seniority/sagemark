/**
 * PR 000 — Phase-0 capability-enforcement spike · shared harness
 * ----------------------------------------------------------------
 * De-risking spike (engineering-rfc.md → "### PR 000"). Ships NO production
 * runtime. This module is the common scaffolding the four adversarial probes
 * import: a typed shim over the Vercel Sandbox SDK, a single place to create a
 * sandbox bound to the run config under test, and the PASS/FAIL verdict types
 * + reporter that every probe emits.
 *
 * SDK BINDING: this harness binds to the REAL `@vercel/sandbox` types (installed
 * v2.2.1 — `pnpm --filter @sagemark/seo add @vercel/sandbox`). The probe-facing
 * types below are re-exported / derived from the SDK so the probes typecheck
 * against the surface that actually executes. The real module is loaded at
 * runtime via a guarded dynamic import; if it is missing the harness throws a
 * precise NEEDS-DEP error rather than a broken-import stack trace.
 *
 * THE EGRESS-CONTROL FIX: the SDK network-egress control is the `networkPolicy`
 * create param (type `NetworkPolicy`), NOT a top-level `egressAllowlist` field.
 * `egressAllowlist` is not a real field — passing it was silently dropped and the
 * sandbox booted allow-all, so the egress probe was testing an UNCONFIGURED
 * control. We now build a default-deny `networkPolicy` from the profile's
 * allowlist and READ IT BACK off the created instance (`sandbox.networkPolicy`)
 * to prove it applied — throwing if it did not, so the egress probe records ERROR
 * (unverifiable) instead of a false PASS/FAIL on an allow-all VM.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  Sandbox as VercelSandbox,
  NetworkPolicy,
  CommandFinished as SdkCommandFinished,
} from '@vercel/sandbox';

// ---------------------------------------------------------------------------
// Vercel Sandbox SDK — probe-facing surface (bound to the real v2.2.1 types)
// ---------------------------------------------------------------------------

/** Result of a finished command — `runCommand(...)` resolves to this.
 *  (Alias of the SDK's `CommandFinished`; `exitCode` + `stdout()`/`stderr()`.) */
export type CommandFinished = SdkCommandFinished;

/** Object-overload params for `runCommand`. Matches the SDK's `RunCommandParams`
 *  for the fields the probes use (`cmd`, `args`, `env`). */
export interface RunCommandParams {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  signal?: AbortSignal;
}

/**
 * The slice of a live Sandbox instance the probes touch. `SandboxInstance` is the
 * real SDK `Sandbox` augmented with `appliedNetworkPolicy` — the policy we read
 * back off the instance after create and re-expose so the egress probe can report
 * exactly what was enforced.
 */
export type SandboxInstance = VercelSandbox & {
  /** The network policy actually applied to this VM (read back from
   *  `sandbox.networkPolicy` at create time). Present only after
   *  `createProbeSandbox` has verified it. */
  appliedNetworkPolicy: NetworkPolicy;
};

/** Create params we exercise — the real SDK `Sandbox.create` param shape, narrowed
 *  to the fields this harness sets (`networkPolicy` is the egress control). */
export interface SandboxCreateParams {
  runtime?: string;
  timeout?: number;
  source?: { type: 'snapshot'; snapshotId: string };
  token?: string;
  teamId?: string;
  projectId?: string;
  env?: Record<string, string>;
  /** The REAL network-egress control. `'deny-all' | 'allow-all' | { allow, subnets }`.
   *  A `{ allow: [...] }` object means default-deny + that allowlist. */
  networkPolicy?: NetworkPolicy;
}

interface SandboxStatic {
  create(params: SandboxCreateParams): Promise<VercelSandbox>;
}

// ---------------------------------------------------------------------------
// Run config under test
// ---------------------------------------------------------------------------

/**
 * The launch profile a probe asks the harness to stand up. This mirrors the
 * shape `sandbox-launch` (PR 006/006b) would use to provision a worker VM:
 * an egress allowlist, a scrubbed env carrying only a placeholder run JWT, and
 * an ephemeral working dir. The probes assert these are actually ENFORCED.
 */
export interface RunProfile {
  /** Hosts the worker is permitted to reach. Everything else must be refused
   *  at the network layer (probe 1). For the real worker this is the Gateway
   *  base URL + DuckDuckGo only (RFC §2). */
  egressAllowlist: string[];
  /** The ONLY secret-shaped value allowed in the worker env (probe 2). */
  runJwtPlaceholder: string;
  /** The ephemeral working dir the loop runs in; reads outside it must fail
   *  (probe 3). */
  workdir: string;
  /** A sibling run's workdir — must be unreachable from this run (probe 3). */
  siblingWorkdir: string;
}

/** Default profile. Override per-probe / per-environment via env vars. */
export function profileFromEnv(): RunProfile {
  const csv = (v: string | undefined, d: string[]) =>
    v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d;
  return {
    egressAllowlist: csv(process.env.SPIKE_EGRESS_ALLOWLIST, [
      // Default: only the metered Gateway + DDG grounding source (RFC §2).
      'ai-gateway.vercel.sh',
      'duckduckgo.com',
      'html.duckduckgo.com',
    ]),
    runJwtPlaceholder:
      process.env.SPIKE_RUN_JWT_PLACEHOLDER ?? 'PLACEHOLDER_RUN_JWT_not_a_real_secret',
    workdir: process.env.SPIKE_WORKDIR ?? '/vercel/sandbox/run',
    siblingWorkdir: process.env.SPIKE_SIBLING_WORKDIR ?? '/vercel/sandbox/sibling-run',
  };
}

// ---------------------------------------------------------------------------
// Sandbox bring-up (real SDK, loaded at runtime)
// ---------------------------------------------------------------------------

function sandboxCredentials(): Partial<SandboxCreateParams> {
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  // On a Vercel deployment the SDK falls back to VERCEL_OIDC_TOKEN automatically.
  return {};
}

/**
 * Load the real `@vercel/sandbox` module at runtime. Kept dynamic so the probes
 * typecheck and lint without the dependency installed; throws a precise
 * NEEDS-DEP error (not a module-resolution stack trace) if it is missing.
 */
export async function loadSandbox(): Promise<SandboxStatic> {
  try {
    const mod = (await import('@vercel/sandbox')) as any;
    const S = mod.Sandbox ?? mod.default?.Sandbox;
    if (!S?.create) throw new Error('Sandbox.create not found on @vercel/sandbox');
    return S as SandboxStatic;
  } catch (err) {
    throw new Error(
      '[NEEDS-DEP] @vercel/sandbox is not installed in this workspace. ' +
        'Install it before running the probes: `pnpm --filter @sagemark/seo add @vercel/sandbox`. ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

/**
 * Private / link-local CIDR ranges that must be denied at the subnet level so
 * IP-literal egress (the IMDS endpoint `169.254.169.254`, RFC-1918 ranges) is
 * genuinely blocked — a domain allowlist alone does not cover raw-IP requests.
 * `subnets.deny` takes precedence over allowed domains/CIDRs in the SDK.
 */
export const DENY_CIDRS = [
  '169.254.0.0/16', // link-local incl. cloud metadata (IMDS) endpoint
  '10.0.0.0/8', // RFC-1918 private
  '172.16.0.0/12', // RFC-1918 private
  '192.168.0.0/16', // RFC-1918 private (the 192.168 block is a /16; /8 is unaligned and the Sandbox API rejects it with 400 "not a valid CIDR")
];

/**
 * Build the default-deny network policy for a run profile: allow ONLY the
 * profile's egress allowlist (everything else denied — this is the semantics of
 * the `{ allow: [...] }` object form), and additionally deny private/link-local
 * subnets so IP-literal attacks cannot bypass the domain allowlist.
 */
export function networkPolicyFor(profile: RunProfile): NetworkPolicy {
  return {
    allow: [...profile.egressAllowlist],
    subnets: { deny: [...DENY_CIDRS] },
  };
}

/** True when the applied policy is a custom default-deny allowlist that reflects
 *  the intended hosts (i.e. NOT 'allow-all' / undefined / a dropped field). */
function policyReflectsAllowlist(applied: NetworkPolicy | undefined, profile: RunProfile): boolean {
  if (!applied || applied === 'allow-all') return false;
  if (applied === 'deny-all') {
    // deny-all is strictly stronger than the allowlist; acceptable only if the
    // profile's allowlist is itself empty. With a non-empty allowlist it means
    // the allow set was dropped, which the sanity-control in probe 1 would flag.
    return profile.egressAllowlist.length === 0;
  }
  // Custom object: the `allow` set must be present and non-empty (default-deny + allowlist).
  const allow = applied.allow;
  if (Array.isArray(allow)) return allow.length > 0;
  if (allow && typeof allow === 'object') return Object.keys(allow).length > 0;
  return false;
}

// ---------------------------------------------------------------------------
// Egress hardening — close the hypervisor-local MMDS residual
// ---------------------------------------------------------------------------

/** The link-local range the Firecracker MMDS (`169.254.169.254`) lives in. The
 *  SDK `networkPolicy.subnets.deny` is an EGRESS control and cannot refuse the
 *  MMDS because it is answered locally by the hypervisor (never leaves the VM).
 *  We close it in-VM with an iptables DROP at launch — proven on the live run to
 *  turn the MMDS reach from `401` into a timeout. RFC-1918 ranges are NOT blocked
 *  here (the `networkPolicy` already refuses them, and an in-VM /8 DROP risks the
 *  DNS resolver / gateway if either sits in a private range). */
export const LINK_LOCAL_CIDR = '169.254.0.0/16';

/**
 * Apply the in-VM egress hardening the real `sandbox-launch` (PR 006) must run at
 * boot, BEFORE the worker loop starts: drop all traffic to the link-local MMDS
 * range, then PROVE the MMDS is now unreachable. Throws `[CONTROL-UNVERIFIABLE]`
 * if the block did not take, so the egress probe can never PASS on an
 * un-hardened VM. Returns the evidence the boot-refusal launcher records.
 */
export async function hardenSandbox(sandbox: SandboxInstance): Promise<{ mmdsBlocked: boolean }> {
  // sudo: true so the rule applies regardless of the run user's caps.
  await sandbox.runCommand({
    cmd: 'iptables',
    args: ['-A', 'OUTPUT', '-d', LINK_LOCAL_CIDR, '-j', 'DROP'],
    sudo: true,
  });
  // Prove it: the MMDS must now refuse (timeout / no-connect), not answer 401.
  const probe = await sandbox.runCommand({
    cmd: 'curl',
    args: ['-sS', '--connect-timeout', '4', '-m', '5', '-o', '/dev/null', '-w', 'HTTPCODE=%{http_code}', 'http://169.254.169.254/latest/meta-data/'],
  });
  const code = /HTTPCODE=(\d+)/.exec(await probe.stdout())?.[1] ?? '000';
  const mmdsBlocked = probe.exitCode !== 0 || code === '000';
  if (!mmdsBlocked) {
    await sandbox.stop().catch(() => undefined);
    throw new Error(
      `[CONTROL-UNVERIFIABLE] in-VM link-local DROP did not take — MMDS still answered http=${code}. ` +
        'Refusing to report an egress verdict on an un-hardened VM.',
    );
  }
  return { mmdsBlocked };
}

// ---------------------------------------------------------------------------
// No-shell worker contract — the enforced fs control (the control 3 fallback)
// ---------------------------------------------------------------------------

/**
 * Resolve `requested` against `workdir` (handling `..`, `.`, and absolute paths)
 * and report whether it stays INSIDE the workdir jail. Pure + POSIX-only — the
 * reference jail check `sandbox-launch`'s file tool uses. Out-of-workdir reads
 * (host secrets, sibling runs, `../` traversal, absolute paths) resolve outside
 * and are refused WITHOUT touching the filesystem.
 */
export function pathWithinWorkdir(workdir: string, requested: string): boolean {
  const norm = (p: string): string[] => {
    const segs: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') segs.pop();
      else segs.push(seg);
    }
    return segs;
  };
  const base = norm(workdir);
  // Absolute requests are resolved from root; relative ones from the workdir.
  const target = requested.startsWith('/') ? norm(requested) : norm(`${workdir}/${requested}`);
  if (target.length < base.length) return false;
  return base.every((seg, i) => target[i] === seg);
}

/**
 * The ONLY filesystem read the no-shell worker exposes to the model: a workdir-
 * scoped tool. It refuses any path outside the run's ephemeral workdir at the
 * TOOL layer (so it never reaches a shell), and only then reads inside it. This
 * is the enforced control that replaces "jail the VM shell" (unachievable on a
 * stock Sandbox VM): the model is never handed raw `bash`/`cat`, only this.
 */
export async function readViaWorkdirTool(
  sandbox: SandboxInstance,
  workdir: string,
  requested: string,
): Promise<{ allowed: boolean; detail: string }> {
  if (!pathWithinWorkdir(workdir, requested)) {
    return { allowed: false, detail: `tool refused: '${requested}' resolves outside workdir jail '${workdir}'` };
  }
  const r = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `cat ${requested} >/dev/null 2>&1 && echo READ || echo MISSING`],
  });
  const ok = (await r.stdout()).trim().includes('READ');
  return { allowed: ok, detail: `tool read in-jail path: exit=${r.exitCode}` };
}

/**
 * Stand up a sandbox provisioned with the run profile under test, applying the
 * egress allowlist (via the SDK `networkPolicy` field) + scrubbed env the way
 * `sandbox-launch` would, then HARDENING it (in-VM MMDS block) the way the real
 * launcher does at boot. The `createOverrides` arg lets a probe deliberately
 * MISCONFIGURE the launch (e.g. boot-refusal probe drops a required control) to
 * assert the failure path; `opts.harden:false` skips the MMDS block for probes
 * that are not testing egress.
 *
 * READ-BACK VERIFICATION: after create, we read `sandbox.networkPolicy` back off
 * the instance and assert it reflects the intended default-deny allowlist. If
 * the field was ignored / the wrong shape / undefined (allow-all), we THROW so
 * the egress probe records ERROR (control unverifiable) rather than testing an
 * unconfigured allow-all VM and reporting a false verdict.
 */
export async function createProbeSandbox(
  profile: RunProfile,
  createOverrides: Partial<SandboxCreateParams> = {},
  opts: { harden?: boolean } = {},
): Promise<SandboxInstance> {
  const Sandbox = await loadSandbox();
  const snapshotId = process.env.SPIKE_SANDBOX_SNAPSHOT_ID;
  const base: SandboxCreateParams = {
    ...sandboxCredentials(),
    timeout: Number(process.env.SPIKE_SANDBOX_TIMEOUT_MS ?? 120_000),
    // The worker carries ONLY the run JWT as a secret-shaped value (probe 2).
    env: { RUN_JWT: profile.runJwtPlaceholder },
    // Network egress control — the control probe 1 attacks. This is the REAL SDK
    // field (`networkPolicy`); default-deny + allow only the profile allowlist,
    // with private/link-local subnets explicitly denied.
    networkPolicy: networkPolicyFor(profile),
    ...(snapshotId ? { source: { type: 'snapshot', snapshotId } } : { runtime: 'node24' }),
  };
  const sandbox = await Sandbox.create({ ...base, ...createOverrides });

  // Read back the applied policy and verify it took effect.
  const applied = sandbox.networkPolicy;
  // The override can intentionally relax the policy (boot-refusal models a broken
  // launch); only enforce read-back for the default profile-driven policy.
  const intendedRelaxed =
    createOverrides.networkPolicy !== undefined &&
    createOverrides.networkPolicy !== base.networkPolicy;
  if (!intendedRelaxed && !policyReflectsAllowlist(applied, profile)) {
    await sandbox.stop().catch(() => undefined);
    throw new Error(
      '[CONTROL-UNVERIFIABLE] networkPolicy read-back did not reflect the intended ' +
        `default-deny allowlist. Applied=${JSON.stringify(applied)} ` +
        `intended hosts=${JSON.stringify(profile.egressAllowlist)}. ` +
        'The sandbox may have booted allow-all (field ignored / wrong shape); ' +
        'refusing to report an egress verdict on an unconfigured VM.',
    );
  }

  const instance = sandbox as SandboxInstance;
  instance.appliedNetworkPolicy = applied as NetworkPolicy;

  // Apply the in-VM egress hardening the real launcher runs at boot (closes the
  // hypervisor-local MMDS the networkPolicy cannot). Skipped only when a probe
  // explicitly opts out (e.g. it is not exercising egress).
  if (opts.harden ?? true) {
    await hardenSandbox(instance);
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Verdict model + reporter
// ---------------------------------------------------------------------------

export type Verdict = 'PASS' | 'FAIL' | 'ERROR';

export interface ProbeAssertion {
  /** What hostile action was attempted. */
  attempt: string;
  /** What the control must do (refuse / scrub / block / refuse-boot). */
  expectation: string;
  /** Observed outcome. */
  observed: string;
  /** PASS = control enforced (hostile action refused). FAIL = control bypassed. */
  verdict: Verdict;
  /** When true this assertion is a THREAT BASELINE — it demonstrates the
   *  unmitigated attack surface (e.g. raw-shell reads on a stock VM) to motivate
   *  the enforced control, and is EXCLUDED from the verdict rollup. The verdict is
   *  driven only by the assertions that exercise the actual enforced control. */
  informational?: boolean;
}

export interface ProbeReport {
  probe: string;
  control: string;
  verdict: Verdict;
  assertions: ProbeAssertion[];
  /** Set when the probe could not run at all (e.g. NEEDS-DEP / no infra). */
  inconclusive?: string;
}

/** A probe's overall verdict = worst of its NON-informational assertions
 *  (FAIL > ERROR > PASS). Threat-baseline (`informational`) assertions are shown
 *  but never drive the verdict — only the enforced-control assertions do. */
export function rollup(assertions: ProbeAssertion[]): Verdict {
  const scored = assertions.filter((a) => !a.informational);
  if (scored.some((a) => a.verdict === 'FAIL')) return 'FAIL';
  if (scored.some((a) => a.verdict === 'ERROR')) return 'ERROR';
  return 'PASS';
}

/** Print a human + machine readable report and set the process exit code:
 *  0 = PASS, 1 = FAIL (control bypassed), 2 = ERROR/inconclusive (could not run). */
export function emit(report: ProbeReport): void {
  const line = '─'.repeat(72);
  // eslint-disable-next-line no-console
  console.log(`\n${line}\nPROBE: ${report.probe}  ·  CONTROL: ${report.control}`);
  if (report.inconclusive) {
    // eslint-disable-next-line no-console
    console.log(`VERDICT: INCONCLUSIVE — ${report.inconclusive}`);
  }
  for (const a of report.assertions) {
    const mark = a.informational
      ? 'ℹ️'
      : a.verdict === 'PASS'
        ? '✅'
        : a.verdict === 'FAIL'
          ? '❌'
          : '⚠️';
    const tag = a.informational ? `${a.verdict} (threat baseline — not scored)` : a.verdict;
    // eslint-disable-next-line no-console
    console.log(
      `  ${mark} ${tag}\n     attempt:     ${a.attempt}\n` +
        `     expectation: ${a.expectation}\n     observed:    ${a.observed}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`VERDICT: ${report.verdict}\n${line}`);
  // eslint-disable-next-line no-console
  console.log(`::probe-result:: ${JSON.stringify(report)}`);

  if (report.inconclusive || report.verdict === 'ERROR') process.exitCode = 2;
  else if (report.verdict === 'FAIL') process.exitCode = 1;
  else process.exitCode = 0;
}

/** Wrap a probe body so a NEEDS-DEP / no-infra failure becomes an explicit
 *  INCONCLUSIVE report (exit 2) instead of an unhandled rejection. Never lets a
 *  failure masquerade as a PASS. */
export async function runProbe(
  meta: { probe: string; control: string },
  body: () => Promise<ProbeAssertion[]>,
): Promise<void> {
  try {
    const assertions = await body();
    emit({ ...meta, verdict: rollup(assertions), assertions });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    emit({
      ...meta,
      verdict: 'ERROR',
      assertions: [],
      inconclusive: message,
    });
  }
}
