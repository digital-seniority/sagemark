/**
 * PR 000 · CONTROL 4 — BOOT REFUSAL (adversarial probe)
 * ------------------------------------------------------
 * Safety-model claim (RFC §3.4 / PR 000 scope): if any runtime control fails to
 * apply, `sandbox-launch` must REFUSE TO START the loop rather than running
 * degraded. Fail-closed: a worker that cannot prove its egress allowlist, env
 * scrub, and fs jail are in force must never reach the `claude` subprocess.
 *
 * Unlike probes 1–3 (which attack a *running* sandbox), this probe attacks the
 * LAUNCHER's decision: it drives the launch preflight with deliberately broken
 * profiles and asserts the launcher throws/refuses BEFORE the loop starts. The
 * preflight gate (`assertControlsOrRefuse`) is implemented here as the reference
 * contract PR 006/006b's `sandbox-launch` must satisfy; the live run wires it to
 * the real launcher (see RESULTS.md §4) and re-runs the same broken profiles.
 *
 * READING THE RESULT
 *   PASS  — every broken profile causes a refusal (BootRefusedError) and no loop
 *           start is attempted; a fully-valid profile is allowed.
 *   FAIL  — a broken profile is allowed to boot (the launcher ran degraded).
 *   ERROR — could not run (logic error in the probe itself).
 *
 * Exit code 0=PASS 1=FAIL 2=ERROR.
 */

import {
  profileFromEnv,
  runProbe,
  type ProbeAssertion,
  type RunProfile,
} from './_harness';

/** Thrown by the launch preflight when a required control is not provably in
 *  force. PR 006/006b's `sandbox-launch` must throw this (or equivalent) and
 *  must NOT spawn the `claude` subprocess after it. */
export class BootRefusedError extends Error {
  constructor(readonly control: string, message: string) {
    super(`[boot-refused:${control}] ${message}`);
    this.name = 'BootRefusedError';
  }
}

/** The evidence a launcher collects to prove each control applied. In the live
 *  run this is populated by actually probing the freshly-created sandbox (the
 *  egress/env/fs checks above) BEFORE handing it the loop. Here we model it so
 *  the refusal logic is testable in isolation. */
export interface ControlEvidence {
  /** Allowlist was set AND a forbidden-egress smoke test was refused. */
  egressEnforced: boolean;
  /** Env scan found no secret-shaped value beyond the run JWT. */
  envScrubbed: boolean;
  /** Out-of-workdir read smoke test was denied. */
  fsJailed: boolean;
  /** The run JWT placeholder is present (worker has its one credential). */
  runJwtPresent: boolean;
}

/**
 * REFERENCE PREFLIGHT GATE — fail-closed. Refuses the launch unless every
 * control is proven in force. This is the contract PR 006/006b's launcher
 * implements; the probe asserts its truth table.
 */
export function assertControlsOrRefuse(ev: ControlEvidence): void {
  if (!ev.runJwtPresent) throw new BootRefusedError('run-jwt', 'worker has no run JWT — cannot authenticate to the bridge');
  if (!ev.egressEnforced) throw new BootRefusedError('egress', 'egress allowlist not provably enforced');
  if (!ev.envScrubbed) throw new BootRefusedError('env-scrub', 'env carries a secret-shaped value beyond the run JWT');
  if (!ev.fsJailed) throw new BootRefusedError('fs-jail', 'workdir jail not provably enforced');
  // All controls proven → caller may start the loop.
}

/** Drive the gate with a profile + evidence and report whether it refused. */
function expectRefusal(
  label: string,
  ev: ControlEvidence,
  failingControl: string,
): ProbeAssertion {
  try {
    assertControlsOrRefuse(ev);
    return {
      attempt: `launch with ${label}`,
      expectation: `REFUSE — ${failingControl} not in force`,
      observed: 'launcher ALLOWED boot (ran degraded)',
      verdict: 'FAIL',
    };
  } catch (err) {
    const refused = err instanceof BootRefusedError;
    return {
      attempt: `launch with ${label}`,
      expectation: `REFUSE — ${failingControl} not in force`,
      observed: refused ? `refused: ${(err as BootRefusedError).message}` : `threw non-refusal: ${(err as Error).message}`,
      verdict: refused ? 'PASS' : 'ERROR',
    };
  }
}

function expectAllowed(label: string, ev: ControlEvidence): ProbeAssertion {
  try {
    assertControlsOrRefuse(ev);
    return {
      attempt: `launch with ${label}`,
      expectation: 'ALLOW — every control proven in force',
      observed: 'launcher allowed boot',
      verdict: 'PASS',
    };
  } catch (err) {
    return {
      attempt: `launch with ${label}`,
      expectation: 'ALLOW — every control proven in force',
      observed: `launcher REFUSED a valid profile: ${(err as Error).message}`,
      verdict: 'FAIL',
    };
  }
}

const ALL_GOOD: ControlEvidence = {
  egressEnforced: true,
  envScrubbed: true,
  fsJailed: true,
  runJwtPresent: true,
};

function probeFour(_profile: RunProfile): ProbeAssertion[] {
  return [
    // One broken-control profile per control — each must refuse.
    expectRefusal('egress NOT enforced', { ...ALL_GOOD, egressEnforced: false }, 'egress allowlist'),
    expectRefusal('env NOT scrubbed', { ...ALL_GOOD, envScrubbed: false }, 'env scrub'),
    expectRefusal('fs NOT jailed', { ...ALL_GOOD, fsJailed: false }, 'fs jail'),
    expectRefusal('run JWT missing', { ...ALL_GOOD, runJwtPresent: false }, 'run JWT'),
    // Several controls broken at once — still refuses (first failure wins).
    expectRefusal(
      'egress+env+fs all broken',
      { egressEnforced: false, envScrubbed: false, fsJailed: false, runJwtPresent: true },
      'multiple controls',
    ),
    // The valid profile must be ALLOWED (a launcher that refuses everything is
    // not "fail-closed", it is broken).
    expectAllowed('every control in force (positive control)', ALL_GOOD),
  ];
}

void runProbe(
  { probe: 'boot-refusal-probe', control: 'boot refusal (fail-closed launch)' },
  async () => probeFour(profileFromEnv()),
);
