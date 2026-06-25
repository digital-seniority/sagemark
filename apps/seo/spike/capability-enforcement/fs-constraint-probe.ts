/**
 * PR 000 · CONTROL 3 — CONSTRAINED SHELL / FILE (adversarial probe)
 * -----------------------------------------------------------------
 * Safety-model claim (RFC §3.4-layer-5): the loop runs in an ephemeral working
 * dir; a shell/file tool call that reads OUTSIDE that dir — host secrets, system
 * config, or a SIBLING run's path (compute-side voice bleed, the #1
 * agency-ending risk) — must FAIL.
 *
 * This probe is hostile: from inside the sandbox it attempts to read paths the
 * worker must never see, then confirms the legitimate workdir is readable.
 *
 * IMPORTANT — what this control means on Vercel Sandbox. A single Sandbox microVM
 * is already a hard tenant boundary (one run == one VM; siblings are *different*
 * VMs and are physically unreachable). So the realistic in-VM attack is reading
 * host/system secrets and escaping the run's working dir, NOT reaching another
 * live VM's filesystem. This probe therefore tests BOTH:
 *   (a) reads of host/system secret paths (/etc/shadow, ssh keys, cloud creds)
 *       — must fail (permission denied / not found);
 *   (b) reads of a planted "sibling run" marker placed OUTSIDE the workdir on the
 *       SAME VM — must fail if the loop is jailed to the workdir (e.g. chroot /
 *       bind-mount / no-shell). On a stock VM with an unconstrained shell this
 *       WILL succeed → that is the finding that selects the no-shell fallback.
 *
 * READING THE RESULT
 *   PASS  — every out-of-jail read fails AND the workdir read succeeds.
 *   FAIL  — any out-of-jail read succeeds. If only the planted-sibling/workdir-
 *           escape reads succeed (not the host-secret reads), the finding maps
 *           specifically to the "no-shell-capable worker in v1" fallback.
 *   ERROR — could not run (no infra / dep missing).
 *
 * Exit code 0=PASS 1=FAIL 2=ERROR.
 */

import {
  createProbeSandbox,
  profileFromEnv,
  runProbe,
  type ProbeAssertion,
  type SandboxInstance,
} from './_harness';

/** Host/system secret paths the worker must never be able to read. */
const HOST_SECRETS = [
  '/etc/shadow',
  '/root/.ssh/id_rsa',
  '/root/.aws/credentials',
  '/proc/1/environ', // PID-1 env: launcher secrets if namespacing is weak
];

async function tryRead(sandbox: SandboxInstance, path: string): Promise<{ ok: boolean; detail: string }> {
  // `cat` exits non-zero on permission-denied / missing. We also print a marker
  // so an empty-but-readable file is distinguishable from a denied one.
  const r = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `cat ${path} >/dev/null 2>&1 && echo READABLE || echo DENIED`],
  });
  const stdout = (await r.stdout()).trim();
  return { ok: stdout.includes('READABLE'), detail: `exit=${r.exitCode} ${stdout}` };
}

async function probeThree(sandbox: SandboxInstance, workdir: string, siblingWorkdir: string): Promise<ProbeAssertion[]> {
  const out: ProbeAssertion[] = [];

  // 0) Set up: plant a "sibling run" secret OUTSIDE the workdir on this VM. If the
  //    loop is properly jailed to `workdir`, even this same-VM path is unreadable.
  await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `mkdir -p ${siblingWorkdir} && echo 'SIBLING_TENANT_VOICE_SPEC_SECRET' > ${siblingWorkdir}/voice.json && ` +
        `mkdir -p ${workdir} && echo 'OWN_RUN_OK' > ${workdir}/own.txt`,
    ],
  });

  // 1) Host/system secrets must be unreadable.
  for (const p of HOST_SECRETS) {
    const res = await tryRead(sandbox, p);
    out.push({
      attempt: `read host secret ${p}`,
      expectation: 'denied (permission denied / not found)',
      observed: res.detail,
      verdict: res.ok ? 'FAIL' : 'PASS',
    });
  }

  // 2) Sibling-run path (outside the workdir jail) must be unreadable.
  const sib = await tryRead(sandbox, `${siblingWorkdir}/voice.json`);
  out.push({
    attempt: `read SIBLING run path ${siblingWorkdir}/voice.json (voice-bleed attempt)`,
    expectation: 'denied — the loop is jailed to its own ephemeral workdir',
    observed: sib.detail,
    // On a stock VM with an unconstrained shell this read SUCCEEDS (same VM, same
    // user) → FAIL → selects the no-shell-capable-worker fallback. A jailed/no-
    // shell runtime makes it fail → PASS.
    verdict: sib.ok ? 'FAIL' : 'PASS',
  });

  // 3) Path-traversal escape attempt from the workdir.
  const escape = await tryRead(sandbox, `${workdir}/../../../etc/hostname`);
  out.push({
    attempt: `traverse out of workdir via ${workdir}/../../../etc/hostname`,
    expectation: 'denied — traversal cannot escape the workdir jail',
    observed: escape.detail,
    verdict: escape.ok ? 'FAIL' : 'PASS',
  });

  // 4) Positive control: the OWN workdir IS readable (a jail that blocks the run's
  //    own dir is broken, not secure).
  const own = await tryRead(sandbox, `${workdir}/own.txt`);
  out.push({
    attempt: `read OWN workdir file ${workdir}/own.txt (positive control)`,
    expectation: 'readable — the run owns its ephemeral workdir',
    observed: own.detail,
    verdict: own.ok ? 'PASS' : 'ERROR',
  });

  return out;
}

void runProbe(
  { probe: 'fs-constraint-probe', control: 'constrained shell/file (no out-of-workdir reads)' },
  async () => {
    const profile = profileFromEnv();
    const sandbox = await createProbeSandbox(profile);
    try {
      return await probeThree(sandbox, profile.workdir, profile.siblingWorkdir);
    } finally {
      await sandbox.stop();
    }
  },
);
