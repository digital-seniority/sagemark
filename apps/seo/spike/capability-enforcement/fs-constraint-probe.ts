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
 * VMs and are physically unreachable). The live run (RESULTS.md) proved a VM-level
 * workdir jail is UNACHIEVABLE on a stock VM: the run is a non-root user but the
 * base image is permissive (`/etc/shadow`, `/proc/1/environ`, `../` traversal all
 * readable) and there is no chroot for an unprivileged user. So the enforced
 * control moves to the TOOL layer — the "no-shell-capable worker": the model is
 * never handed raw `bash`/`cat`, only a workdir-scoped read tool that refuses any
 * path resolving outside the run's ephemeral workdir.
 *
 * This probe therefore runs in two phases:
 *   PHASE A — THREAT BASELINE (informational, not scored): raw-shell reads of
 *             host secrets / a planted sibling marker / `../` traversal / an
 *             absolute path. These SUCCEED on a stock VM — that is precisely why a
 *             raw shell must never be exposed to the model.
 *   PHASE B — ENFORCED CONTROL (scored): the SAME out-of-jail paths read through
 *             the workdir-scoped tool (`readViaWorkdirTool`). Each must be refused
 *             at the tool layer; the own-workdir file must still read.
 *
 * READING THE RESULT (driven only by Phase B)
 *   PASS  — every out-of-jail tool read is refused AND the workdir read succeeds.
 *   FAIL  — any out-of-jail path is readable THROUGH THE TOOL (the jail leaks).
 *   ERROR — could not run (no infra / dep missing).
 *
 * Exit code 0=PASS 1=FAIL 2=ERROR.
 */

import {
  createProbeSandbox,
  profileFromEnv,
  readViaWorkdirTool,
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

  // 0) Set up: plant a "sibling run" secret OUTSIDE the workdir on this VM, and an
  //    own-workdir file. (Siblings are really *different* VMs; planting on the same
  //    VM is the strongest in-VM stand-in for a cross-run read.)
  await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `mkdir -p ${siblingWorkdir} && echo 'SIBLING_TENANT_VOICE_SPEC_SECRET' > ${siblingWorkdir}/voice.json && ` +
        `mkdir -p ${workdir} && echo 'OWN_RUN_OK' > ${workdir}/own.txt`,
    ],
  });

  const outOfJail = [
    ...HOST_SECRETS,
    `${siblingWorkdir}/voice.json`,
    `${workdir}/../../../etc/hostname`,
    '/etc/hostname', // absolute escape
  ];

  // PHASE A — THREAT BASELINE (informational, NOT scored). Raw shell on a stock
  // Sandbox VM reads outside the workdir at will: this is exactly WHY the worker
  // must never expose a raw shell / arbitrary-file tool to the model. A VM-level
  // jail is unachievable here (the run is a non-root user but the base image is
  // permissive and there is no chroot), so the control moves to the tool layer.
  for (const p of outOfJail) {
    const res = await tryRead(sandbox, p);
    out.push({
      attempt: `RAW SHELL read out-of-jail ${p}`,
      expectation: 'demonstrates the unmitigated threat (raw shell sees everything)',
      observed: res.detail,
      verdict: res.ok ? 'FAIL' : 'PASS',
      informational: true,
    });
  }

  // PHASE B — ENFORCED CONTROL (scored). The no-shell worker exposes ONLY the
  // workdir-scoped read tool (`readViaWorkdirTool`); the model never gets raw
  // `bash`/`cat`. Every out-of-jail path must be refused AT THE TOOL LAYER,
  // before any filesystem access.
  for (const p of outOfJail) {
    const t = await readViaWorkdirTool(sandbox, workdir, p);
    out.push({
      attempt: `workdir-scoped tool read out-of-jail ${p}`,
      expectation: 'refused at the tool layer (resolves outside the workdir jail)',
      observed: t.detail,
      verdict: t.allowed ? 'FAIL' : 'PASS',
    });
  }

  // Positive control: the OWN workdir file IS readable through the tool (a tool
  // that blocks the run's own dir is broken, not secure).
  const own = await readViaWorkdirTool(sandbox, workdir, `${workdir}/own.txt`);
  out.push({
    attempt: `workdir-scoped tool read OWN file ${workdir}/own.txt (positive control)`,
    expectation: 'readable — the run owns its ephemeral workdir',
    observed: own.detail,
    verdict: own.allowed ? 'PASS' : 'ERROR',
  });

  return out;
}

void runProbe(
  { probe: 'fs-constraint-probe', control: 'constrained shell/file (no out-of-workdir reads)' },
  async () => {
    const profile = profileFromEnv();
    // harden:false — this probe tests the fs/tool layer, not egress; skip the MMDS block.
    const sandbox = await createProbeSandbox(profile, {}, { harden: false });
    try {
      return await probeThree(sandbox, profile.workdir, profile.siblingWorkdir);
    } finally {
      await sandbox.stop();
    }
  },
);
