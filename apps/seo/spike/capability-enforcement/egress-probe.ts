/**
 * PR 000 · CONTROL 1 — NETWORK EGRESS ALLOWLIST (adversarial probe)
 * ------------------------------------------------------------------
 * Safety-model claim (RFC §2 / §3.4-layer-5): the worker can only reach the
 * metered AI Gateway + the DuckDuckGo grounding host. Every other destination —
 * the cloud metadata endpoint, RFC-1918 private ranges, an arbitrary public
 * host — must be REFUSED AT THE NETWORK LAYER, not merely unused.
 *
 * This probe is hostile on purpose: from INSIDE the sandbox (the same place the
 * `claude` subprocess runs) it attempts egress to each forbidden destination
 * and to one allowlisted host as a control.
 *
 * READING THE RESULT
 *   PASS  — every forbidden destination is blocked (connection refused / no
 *           route / DNS denied / timeout) AND the allowlisted host succeeds.
 *           => the egress allowlist is enforced.
 *   FAIL  — any forbidden destination returns a successful response (HTTP body
 *           or TCP connect). The metadata endpoint succeeding is the worst case
 *           (credential exfiltration path). => allowlist NOT enforced; adopt the
 *           egress-proxy fallback (RESULTS.md decision tree).
 *   ERROR — could not run (no infra / dep missing). Never counts as a pass.
 *
 * Run: see RESULTS.md "How to run". Exit code 0=PASS 1=FAIL 2=ERROR.
 */

import {
  createProbeSandbox,
  profileFromEnv,
  runProbe,
  type ProbeAssertion,
  type SandboxInstance,
} from './_harness';

/** Forbidden destinations every worker run must NOT be able to reach. */
const FORBIDDEN: Array<{ label: string; url: string; why: string }> = [
  {
    label: 'cloud-metadata',
    url: 'http://169.254.169.254/latest/meta-data/',
    why: 'IMDS — instance credentials / SSRF crown jewel',
  },
  {
    label: 'link-local-gcp',
    url: 'http://169.254.169.254/computeMetadata/v1/',
    why: 'GCP metadata variant',
  },
  {
    label: 'private-range-10',
    url: 'http://10.0.0.1/',
    why: 'RFC-1918 private range (lateral movement)',
  },
  {
    label: 'private-range-192',
    url: 'http://192.168.0.1/',
    why: 'RFC-1918 private range',
  },
  {
    label: 'arbitrary-public',
    url: 'https://example.com/',
    why: 'arbitrary public host not on the allowlist',
  },
  {
    label: 'exfil-canary',
    url: 'https://api.ipify.org/',
    why: 'arbitrary public host that echoes the VM egress IP (exfil canary)',
  },
];

/** A curl invocation that fails fast and prints ONLY a terse status token we can
 *  classify. `--max-time` bounds a blocked-but-hanging connection; `-s -S` keeps
 *  stderr meaningful; `-o /dev/null -w` prints the HTTP code (000 == no connect). */
function curlArgs(url: string): string[] {
  return [
    '-sS',
    '--max-time',
    '8',
    '--connect-timeout',
    '6',
    '-o',
    '/dev/null',
    '-w',
    'HTTPCODE=%{http_code}',
    url,
  ];
}

/** Classify a curl result. A blocked destination yields a non-zero exit code or
 *  HTTPCODE=000 (never connected). A reachable destination yields exit 0 with a
 *  non-000 HTTP code — which for a FORBIDDEN host is a control bypass. */
function classifyForbidden(
  label: string,
  why: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): ProbeAssertion {
  const httpCode = /HTTPCODE=(\d+)/.exec(stdout)?.[1] ?? '???';
  const connected = exitCode === 0 && httpCode !== '000' && httpCode !== '???';
  return {
    attempt: `egress to forbidden ${label} (${why})`,
    expectation: 'refused at the network layer (no connection / DNS denied)',
    observed: `curl exit=${exitCode} httpCode=${httpCode}${
      stderr ? ` stderr="${stderr.trim().slice(0, 160)}"` : ''
    }`,
    verdict: connected ? 'FAIL' : 'PASS',
  };
}

async function probeOne(sandbox: SandboxInstance, allowlistHost: string): Promise<ProbeAssertion[]> {
  const out: ProbeAssertion[] = [];

  // 1) Each forbidden destination must be blocked.
  for (const f of FORBIDDEN) {
    const r = await sandbox.runCommand({ cmd: 'curl', args: curlArgs(f.url) });
    out.push(
      classifyForbidden(f.label, f.why, r.exitCode, await r.stdout(), await r.stderr()),
    );
  }

  // 2) Control: an allowlisted host MUST still be reachable, else the allowlist
  //    is so broken it blocks everything (a different failure — record it).
  const allowUrl = `https://${allowlistHost}/`;
  const ar = await sandbox.runCommand({ cmd: 'curl', args: curlArgs(allowUrl) });
  const aHttp = /HTTPCODE=(\d+)/.exec(await ar.stdout())?.[1] ?? '???';
  const reachable = ar.exitCode === 0 && aHttp !== '000' && aHttp !== '???';
  out.push({
    attempt: `egress to ALLOWLISTED ${allowlistHost} (sanity control)`,
    expectation: 'reachable (allowlist permits it)',
    observed: `curl exit=${ar.exitCode} httpCode=${aHttp}`,
    // Not reachable => the allowlist is misconfigured (blocks everything). That
    // is not a security FAIL (it errs safe) but it IS a broken control: ERROR.
    verdict: reachable ? 'PASS' : 'ERROR',
  });

  return out;
}

void runProbe(
  { probe: 'egress-probe', control: 'network egress allowlist' },
  async () => {
    const profile = profileFromEnv();
    const sandbox = await createProbeSandbox(profile);
    try {
      // curl is preinstalled on the Vercel Sandbox base image; if a probe image
      // lacks it the command's non-zero exit surfaces as a blocked result, which
      // would mask a bypass — so assert curl exists first.
      const which = await sandbox.runCommand({ cmd: 'sh', args: ['-c', 'command -v curl || echo MISSING'] });
      if ((await which.stdout()).includes('MISSING')) {
        throw new Error('curl not present in sandbox image; install it in the probe snapshot');
      }
      return await probeOne(sandbox, profile.egressAllowlist[0] ?? 'ai-gateway.vercel.sh');
    } finally {
      await sandbox.stop();
    }
  },
);
