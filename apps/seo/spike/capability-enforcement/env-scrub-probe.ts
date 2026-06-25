/**
 * PR 000 · CONTROL 2 — ENV SCRUB (adversarial probe)
 * ---------------------------------------------------
 * Safety-model claim (RFC §2 key-decisions / §3.4): the worker process env
 * carries NO secret-shaped value beyond a placeholder run JWT. In particular it
 * must NOT carry a raw Anthropic provider key, Supabase service-role key, Vercel
 * token, or any other credential — the worker's only model credential is the
 * run-scoped Gateway base URL + bridge JWT.
 *
 * This probe is hostile: from inside the sandbox it dumps the FULL environment
 * (`env`) the way a compromised tool call would, then scans every value for
 * secret shapes. A control bypass is any secret-shaped value other than the
 * known run-JWT placeholder.
 *
 * READING THE RESULT
 *   PASS  — the only secret-shaped env value is the run-JWT placeholder; no
 *           provider key / service-role key / token leaked into the worker env.
 *   FAIL  — at least one secret-shaped value (other than the placeholder) is
 *           present. => env scrub NOT enforced; the launcher leaks credentials
 *           into the worker process.
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

/** Secret-shaped patterns. Each fires on a *value*; we exempt the known run-JWT
 *  placeholder by identity before matching. Patterns are deliberately broad —
 *  a false positive is a finding to confirm, a false negative is a leaked key. */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/ },
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'gcp-sa-key', re: /"private_key":\s*"-----BEGIN/ },
  { name: 'supabase-service-role-jwt', re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'vercel-token', re: /\b[A-Za-z0-9]{24}\b/ }, // Vercel PATs are 24 hex-ish chars
  { name: 'generic-bearer', re: /bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: 'pem-private-key', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'github-token', re: /gh[pos]_[A-Za-z0-9]{20,}/ },
];

/** Env var NAMES that should never appear in a scrubbed worker env, regardless
 *  of whether their value matches a shape (defense in depth). */
const FORBIDDEN_NAMES = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'VERCEL_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'DATABASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

function parseEnvDump(dump: string): Array<{ name: string; value: string }> {
  return dump
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return { name: l.slice(0, i), value: l.slice(i + 1) };
    });
}

async function probeTwo(sandbox: SandboxInstance, placeholder: string): Promise<ProbeAssertion[]> {
  const out: ProbeAssertion[] = [];

  // Hostile move: dump the entire process env the way a leaked shell tool would.
  const r = await sandbox.runCommand({ cmd: 'env', args: [] });
  if (r.exitCode !== 0) {
    throw new Error(`could not read env in sandbox (exit ${r.exitCode})`);
  }
  const entries = parseEnvDump(await r.stdout());

  // 1) No forbidden NAME present.
  const forbiddenHit = entries.filter((e) => FORBIDDEN_NAMES.includes(e.name));
  out.push({
    attempt: 'scan worker env for known-secret variable NAMES',
    expectation: 'none present (only RUN_JWT + benign runtime vars)',
    observed:
      forbiddenHit.length === 0
        ? 'no forbidden names found'
        : `LEAKED names: ${forbiddenHit.map((e) => e.name).join(', ')}`,
    verdict: forbiddenHit.length === 0 ? 'PASS' : 'FAIL',
  });

  // 2) No secret-SHAPED value present (other than the run-JWT placeholder).
  const shapeHits: string[] = [];
  for (const e of entries) {
    if (e.value === placeholder) continue; // the one permitted secret-shaped value
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(e.value)) {
        shapeHits.push(`${e.name} matches ${p.name}`);
        break;
      }
    }
  }
  out.push({
    attempt: 'scan worker env VALUES for secret shapes (keys, tokens, PEMs, JWTs)',
    expectation: 'only the run-JWT placeholder is secret-shaped; nothing else',
    observed:
      shapeHits.length === 0
        ? 'no secret-shaped values beyond the run-JWT placeholder'
        : `LEAKED shapes: ${shapeHits.join('; ')}`,
    verdict: shapeHits.length === 0 ? 'PASS' : 'FAIL',
  });

  // 3) Positive control: the run-JWT placeholder IS present (proves the worker
  //    got its one legitimate credential — a scrub that drops it too is broken).
  const hasPlaceholder = entries.some((e) => e.value === placeholder);
  out.push({
    attempt: 'confirm the run-JWT placeholder reached the worker (positive control)',
    expectation: 'present (it is the worker\'s only legitimate credential)',
    observed: hasPlaceholder ? 'run-JWT placeholder present' : 'run-JWT placeholder MISSING',
    verdict: hasPlaceholder ? 'PASS' : 'ERROR',
  });

  return out;
}

void runProbe(
  { probe: 'env-scrub-probe', control: 'env scrub (no secret-shaped value beyond run JWT)' },
  async () => {
    const profile = profileFromEnv();
    const sandbox = await createProbeSandbox(profile);
    try {
      return await probeTwo(sandbox, profile.runJwtPlaceholder);
    } finally {
      await sandbox.stop();
    }
  },
);
