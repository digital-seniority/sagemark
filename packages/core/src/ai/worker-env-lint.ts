/**
 * CI env/config lint — "no worker env/config carries a raw Anthropic endpoint
 * + provider key" (PR 001 acceptance criterion).
 *
 * The worker's ONLY model credential is the run-scoped Gateway base URL + a
 * per-run bridge JWT. A worker-bound env/config that pairs a raw Anthropic
 * endpoint (`api.anthropic.com`) with a provider API key would let the worker
 * silently bypass the metered Gateway and bill un-metered model calls — exactly
 * what the §3.4-layer-5 egress allowlist and the `'worker'` resolution branch
 * forbid. This lint is the build-time backstop: it scans a worker-bound
 * env/config map and FAILS (returns a violation, which the CI wrapper turns into
 * a non-zero exit) if the two appear together.
 *
 * Pure + dependency-free so it can run in CI, in a unit test, and as a
 * Sandbox-provision pre-flight against the env that is about to be injected.
 */

/** A raw Anthropic endpoint that bypasses the metered Gateway. */
const RAW_ANTHROPIC_ENDPOINT = "api.anthropic.com";

/**
 * Env keys that hold a *direct provider* API key. Gateway credentials
 * (`AI_GATEWAY_API_KEY`, the bridge JWT) are intentionally NOT in this set —
 * they are the worker's sanctioned credential.
 */
const PROVIDER_KEY_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"] as const;

/** Heuristic: a value shaped like an Anthropic provider key. */
function looksLikeProviderKey(value: string): boolean {
  return /sk-ant-/.test(value);
}

/** A single lint violation, with enough context to fix it. */
export interface WorkerEnvViolation {
  reason: string;
  offendingKeys: string[];
}

/**
 * Lint a worker-bound env/config map. Returns the violations found (empty array
 * ⇒ clean). A violation is raised when BOTH:
 *   (a) some value contains the raw Anthropic endpoint `api.anthropic.com`, AND
 *   (b) a provider API key is present (by key name OR by `sk-ant-` value shape).
 *
 * Either alone is fine (a Gateway-routed worker legitimately has neither; a
 * host/CI context may carry a key but no raw endpoint). It is the *pairing*
 * that lets a worker bypass the meter — and that is what fails the build.
 */
export function lintWorkerEnv(
  env: Record<string, string | undefined>,
): WorkerEnvViolation[] {
  const violations: WorkerEnvViolation[] = [];

  const rawEndpointKeys = Object.entries(env)
    .filter(([, v]) => typeof v === "string" && v.includes(RAW_ANTHROPIC_ENDPOINT))
    .map(([k]) => k);

  const providerKeyKeys = Object.entries(env)
    .filter(([k, v]) => {
      if (typeof v !== "string" || v.length === 0) return false;
      return (
        (PROVIDER_KEY_NAMES as readonly string[]).includes(k) ||
        looksLikeProviderKey(v)
      );
    })
    .map(([k]) => k);

  if (rawEndpointKeys.length > 0 && providerKeyKeys.length > 0) {
    violations.push({
      reason:
        "worker env/config carries a raw Anthropic endpoint (api.anthropic.com) " +
        "together with a provider API key — the worker must route ALL model " +
        "traffic through the metered Gateway (run-scoped base URL + bridge JWT). " +
        "Remove the raw endpoint and/or the provider key from the worker env.",
      offendingKeys: [
        ...new Set([...rawEndpointKeys, ...providerKeyKeys]),
      ].sort(),
    });
  }

  return violations;
}

/**
 * Assert a worker env is clean. Throws (fail-closed) on any violation — the CI
 * wrapper calls this and a thrown error fails the build.
 */
export function assertWorkerEnvClean(
  env: Record<string, string | undefined>,
): void {
  const violations = lintWorkerEnv(env);
  if (violations.length > 0) {
    throw new Error(
      `worker env lint failed:\n${violations
        .map((v) => `  - ${v.reason} [keys: ${v.offendingKeys.join(", ")}]`)
        .join("\n")}`,
    );
  }
}
