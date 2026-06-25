/**
 * PR 000 — Phase-0 capability-enforcement spike · shared harness
 * ----------------------------------------------------------------
 * De-risking spike (engineering-rfc.md → "### PR 000"). Ships NO production
 * runtime. This module is the common scaffolding the four adversarial probes
 * import: a typed shim over the Vercel Sandbox SDK, a single place to create a
 * sandbox bound to the run config under test, and the PASS/FAIL verdict types
 * + reporter that every probe emits.
 *
 * WHY A LOCAL TYPE SHIM: `@vercel/sandbox` and `@anthropic-ai/claude-agent-sdk`
 * are not (yet) dependencies of this workspace — see RESULTS.md "How to run".
 * To keep the probes type-clean and self-contained, we declare the exact slice
 * of the SDK surface we use (sourced from
 * https://vercel.com/docs/sandbox/sdk-reference) and load the real module at
 * runtime via a guarded dynamic import. When the dependency is installed the
 * probes execute against the REAL SDK; until then they typecheck and fail fast
 * with a clear NEEDS-DEP message rather than a broken import.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Vercel Sandbox SDK — minimal typed surface (per sdk-reference)
// ---------------------------------------------------------------------------

/** Result of a finished command — `runCommand(...)` resolves to this. */
export interface CommandFinished {
  /** Process exit code. 0 == success. Non-zero == the command was refused/failed. */
  readonly exitCode: number;
  /** Full stdout as a string (await). */
  stdout(): Promise<string>;
  /** Full stderr as a string (await). */
  stderr(): Promise<string>;
}

/** Object-overload params for `runCommand`. */
export interface RunCommandParams {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  signal?: AbortSignal;
}

/** The slice of a live Sandbox instance the probes touch. */
export interface SandboxInstance {
  /** String overload. */
  runCommand(cmd: string, args?: string[]): Promise<CommandFinished>;
  /** Object overload (lets a probe inject env / cwd). */
  runCommand(params: RunCommandParams): Promise<CommandFinished>;
  /** Tear the microVM down. */
  stop(): Promise<void>;
}

/** Create params we exercise. `egressAllowlist` is the control under test in
 *  the egress probe; the SDK names it under network policy. We pass it through
 *  `extra` so the shim does not hard-code a field name that may version-drift —
 *  the probe records what it actually passed. */
export interface SandboxCreateParams {
  runtime?: string;
  timeout?: number;
  source?: { type: 'snapshot'; snapshotId: string };
  token?: string;
  teamId?: string;
  projectId?: string;
  /** Network egress allowlist + any other run-scoped policy the launcher sets.
   *  Field names are forwarded verbatim to the SDK; see RESULTS.md §1. */
  [extra: string]: unknown;
}

interface SandboxStatic {
  create(params: SandboxCreateParams): Promise<SandboxInstance>;
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
    // Indirect specifier so the bundler/TS does not try to resolve at compile time.
    const specifier = '@vercel/sandbox';
    const mod = (await import(/* @vite-ignore */ specifier)) as any;
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
 * Stand up a sandbox provisioned with the run profile under test, applying the
 * egress allowlist + scrubbed env the way `sandbox-launch` would. The
 * `createOverrides` arg lets a probe deliberately MISCONFIGURE the launch (e.g.
 * boot-refusal probe drops a required control) to assert the failure path.
 */
export async function createProbeSandbox(
  profile: RunProfile,
  createOverrides: Partial<SandboxCreateParams> = {},
): Promise<SandboxInstance> {
  const Sandbox = await loadSandbox();
  const snapshotId = process.env.SPIKE_SANDBOX_SNAPSHOT_ID;
  const base: SandboxCreateParams = {
    ...sandboxCredentials(),
    timeout: Number(process.env.SPIKE_SANDBOX_TIMEOUT_MS ?? 120_000),
    // The worker carries ONLY the run JWT as a secret-shaped value (probe 2).
    env: { RUN_JWT: profile.runJwtPlaceholder },
    // Network egress allowlist — the control probe 1 attacks. Field name is the
    // SDK's network-policy key; recorded in RESULTS.md so a version drift is
    // caught by the live run, not silently passed.
    egressAllowlist: profile.egressAllowlist,
    ...(snapshotId ? { source: { type: 'snapshot', snapshotId } } : { runtime: 'node24' }),
  };
  return Sandbox.create({ ...base, ...createOverrides });
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
}

export interface ProbeReport {
  probe: string;
  control: string;
  verdict: Verdict;
  assertions: ProbeAssertion[];
  /** Set when the probe could not run at all (e.g. NEEDS-DEP / no infra). */
  inconclusive?: string;
}

/** A probe's overall verdict = worst of its assertions (FAIL > ERROR > PASS). */
export function rollup(assertions: ProbeAssertion[]): Verdict {
  if (assertions.some((a) => a.verdict === 'FAIL')) return 'FAIL';
  if (assertions.some((a) => a.verdict === 'ERROR')) return 'ERROR';
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
    const mark = a.verdict === 'PASS' ? '✅' : a.verdict === 'FAIL' ? '❌' : '⚠️';
    // eslint-disable-next-line no-console
    console.log(
      `  ${mark} ${a.verdict}\n     attempt:     ${a.attempt}\n` +
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
