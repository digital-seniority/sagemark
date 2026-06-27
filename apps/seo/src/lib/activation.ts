/**
 * Activation / go-live config gates (DR-026 activation, DR-037 LOAD-BEARING).
 *
 * THE SINGLE SOURCE OF TRUTH for "what is live". The DR-026 data-layer + the SoM
 * subsystem are already built + INERT on `preview`; this module is the env-read
 * boundary that the routes/crons consult to decide live-vs-default. It is the one
 * place an operator's env is translated into the resolved gates, so the
 * inert-by-default + DR-037 invariants live in ONE auditable function set.
 *
 * SAFE DEFAULTS (the hard rule — a merge with NO env set changes NOTHING live):
 *
 *   - `publishEnabled`  DEFAULT **false**. Only true when an EXPLICIT
 *     `PUBLISH_ENABLED`/`CONTENT_PUBLISH_ENABLED` flag is set AND the service-role
 *     creds are present (publishing needs the live data layer to persist a release).
 *     This is a go-live flag and is NEVER defaulted on. It is ALSO defence-in-depth:
 *     the publish route's own `canPublish` + the DR-037 placeholder guard + the
 *     A.005.1 active-authorization predicate remain the real barriers.
 *
 *   - `pilot`           DEFAULT **false** in production (DR-037, LOAD-BEARING). The
 *     seeded PILOT PLACEHOLDER reviewer ("Pending Clinical Reviewer") can author a
 *     credentialed YMYL release ONLY when `pilot` is true. We derive `pilot: true`
 *     ONLY from a NON-production signal (`VERCEL_ENV !== 'production'`) AND an
 *     explicit `PILOT` flag. PRODUCTION (`VERCEL_ENV === 'production'`) is ALWAYS
 *     `pilot: false`, so a placeholder authorization can NEVER release a real YMYL
 *     piece in prod — `recordCredentialedRelease` refuses it (`placeholder-in-
 *     production`).
 *
 *   - `somLive`         DEFAULT **false**. Mirrors `somLiveEnabled()` (the single
 *     SoM gate) — true only when `SOM_LIVE` is explicitly "1"/"true". With it off
 *     both crons skip (zero probes, zero cost).
 *
 * CREDS ARE NEVER HARD-CODED. Every value is read from env (reference, never a
 * literal): the service-role creds via the existing adapter creds readers, the
 * Gateway/provider creds via the AI SDK env, and the explicit flags below.
 *
 * `server-only`: this reads creds + go-live flags and must never ship to a client
 * bundle. Importing it is network-free.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import { readReadAdapterCreds } from "@/lib/content/live-data-access";
import { somLiveEnabled } from "@/lib/metrics/som-adapters/types";

/** The explicit go-live publish flag (operator sets this to turn publishing on). */
const PUBLISH_ENABLED_ENVS = ["PUBLISH_ENABLED", "CONTENT_PUBLISH_ENABLED"] as const;
/** The explicit pilot flag — only honored OUTSIDE production (DR-037). */
const PILOT_ENV = "PILOT" as const;
/** The Vercel deploy-environment signal: 'production' | 'preview' | 'development'. */
const VERCEL_ENV = "VERCEL_ENV" as const;

/** True iff an env var is set to an explicit affirmative ("1"/"true", case-insensitive). */
function envFlagOn(env: NodeJS.ProcessEnv, key: string): boolean {
  const v = (env[key] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** True iff host service-role creds are present (the live data layer is reachable). */
export function hasServiceRoleCreds(): boolean {
  return readReadAdapterCreds() !== null;
}

/** The resolved go-live gates the routes/crons consult. */
export interface ActivationGates {
  /**
   * Whether publishing is enabled. DEFAULT false. True ONLY when an explicit
   * `PUBLISH_ENABLED` flag is set AND service-role creds are present. Defence-in-
   * depth: this is the global kill switch the publish route already reads; the
   * `canPublish` FSM + DR-037 placeholder guard + A.005.1 predicate remain the
   * authoritative barriers and are NOT weakened by this flag.
   */
  publishEnabled: boolean;
  /**
   * DR-037 (LOAD-BEARING). Whether this runtime is a PILOT context. DEFAULT false
   * in production. `pilot: true` ONLY when `VERCEL_ENV !== 'production'` AND an
   * explicit `PILOT` flag is set. Production is ALWAYS false, so the placeholder
   * reviewer can never back a real YMYL release in prod (the sign-off writer
   * refuses `placeholder-in-production`).
   */
  pilot: boolean;
  /**
   * Whether live SoM probing is enabled. DEFAULT false. Mirrors `somLiveEnabled()`;
   * with it off both SoM crons skip (zero probes, zero cost).
   */
  somLive: boolean;
}

/**
 * Resolve the go-live gates from the environment, SAFE-DEFAULT. With NO env set:
 * `{ publishEnabled: false, pilot: false, somLive: false }` — nothing live. `env`
 * is injectable so tests drive every branch deterministically (no real env).
 */
export function resolveActivation(
  env: NodeJS.ProcessEnv = process.env,
): ActivationGates {
  // publishEnabled: explicit flag AND service-role creds present. Both required —
  // an explicit flag with no creds cannot publish (nothing to persist the release).
  const publishFlag = PUBLISH_ENABLED_ENVS.some((k) => envFlagOn(env, k));
  const publishEnabled = publishFlag && hasServiceRoleCreds();

  // pilot: NON-production AND explicit pilot flag. PRODUCTION is ALWAYS false.
  const isProduction = (env[VERCEL_ENV] ?? "").trim().toLowerCase() === "production";
  const pilot = !isProduction && envFlagOn(env, PILOT_ENV);

  // somLive: the single SoM gate (SOM_LIVE explicitly on).
  const somLive = somLiveEnabled(env);

  return { publishEnabled, pilot, somLive };
}

/**
 * Whether the publish route should report the global publish flag as ON. This is
 * the function the publish route's `publishEnabled()` dep resolves to at
 * activation: it returns true ONLY when `resolveActivation().publishEnabled` is
 * true (explicit flag + creds). DEFAULT false. The publish route still runs every
 * downstream gate (`canPublish`, DR-037, A.005.1) — this is the kill switch, not a
 * bypass.
 */
export function publishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveActivation(env).publishEnabled;
}

/**
 * The DR-037 pilot flag a credentialed-release write consults. DEFAULT false in
 * production. A placeholder authorization can release ONLY when this is true.
 */
export function isPilot(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveActivation(env).pilot;
}
