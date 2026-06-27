/**
 * Share-of-Model measurement-subsystem — the channel-agnostic `SomAdapter`
 * interface (PR 021 / P1.C.4, lane worker-runtime). RFC engineering-rfc.md §728.
 *
 * WHAT THIS IS. The SoM ingestion cron measures "share of model": across the AI
 * answer engines (ChatGPT · Claude · Gemini — DR-038; Perplexity = deferred 4th)
 * how often is a client's hub CITED for the queries it should own? Each engine's
 * query/response shape and citation extraction differ, so every engine sits
 * behind ONE common `SomAdapter` interface (per the RFC: provider-specific
 * adapters, not one code path).
 *
 * THE TWO CHANNELS (the feasibility spike's A / B). The spike
 * (som-feasibility-spike.md) surfaced that "querying a model API" is a PROXY for
 * "what a consumer answer engine cites", and that some engines forbid scraping
 * the consumer product. So the interface is channel-agnostic and supports BOTH:
 *
 *   - `'direct'`    — Channel A: a direct model-API probe through the metered AI
 *                     Gateway (DR-013, Gateway-only — NO raw provider key path).
 *                     Claude additionally uses the web-search tool for real cited
 *                     sources (the one genuinely-citation direct channel).
 *   - `'vendor-api'`— Channel B (the RFC's ToS / reliability fallback): a
 *                     sanctioned GEO-tracker vendor API (Profound / AthenaHQ /
 *                     Peec) that reports real consumer-answer-engine citations.
 *                     PRE-WIRED as a seam here (a stub interface), NOT a live
 *                     vendor — James selects the channel + supplies the creds.
 *
 * The A/B/C decision (spike §22) just selects WHICH channel an adapter activates
 * with WHICH credential; no code is wasted by deciding later.
 *
 * INERT / FLAG-GATED (the hard constraint). NOTHING probes live without BOTH an
 * explicit `SOM_LIVE` flag AND the channel's credentials. `somLiveEnabled()` /
 * `adapterActivation()` are the single gate every adapter + the cron consult; with
 * `SOM_LIVE` unset every adapter is INERT and `probe()` is never reached (the cron
 * skips). Importing this module is network-free and cred-free.
 *
 * RATE-LIMIT BUDGETS. Each engine carries a per-window request budget; an
 * over-budget probe DEFERS to the next window (a `deferred` outcome) rather than
 * crashing the cron or tripping a ban.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` marker (Tier-1 vitest
 * imports it under plain Node).
 */

import type { ShareOfModelEngine } from "../share-of-model";

/**
 * The source channel a probe ran under — the LOAD-BEARING citation-quality label
 * persisted to `share_of_model.source_channel` (0039; the column defaults 'direct'
 * and is free text, so these extend it). Per the feasibility spike + the HYBRID
 * channel decision, a row must NEVER conflate a proxy with a real citation:
 *
 *   - `'direct-citation'` — the direct Gateway path with a REAL citation source
 *     (Claude + the web-search tool returns real cited sources). A genuine SoM
 *     citation signal.
 *   - `'direct-proxy'`    — the direct Gateway MODEL-API answer used as a PROXY
 *     (ChatGPT / Gemini): a model-answer MENTION, NOT a consumer-engine citation.
 *     Any rollup over these is "API-answer mention rate (proxy)", NEVER universal
 *     share-of-model.
 *   - `'vendor'`          — the contracted GEO-tracker (real consumer-engine
 *     citations). DEFERRED (the seam is pre-wired; James contracts a vendor later).
 */
export type SomSourceChannel = "direct-citation" | "direct-proxy" | "vendor";

/** Channels that carry a REAL citation signal (summable as a citation rate). */
export const CITATION_SOURCE_CHANNELS: ReadonlySet<SomSourceChannel> = new Set([
  "direct-citation",
  "vendor",
]);

/** Channels that are a PROXY only (model-answer mention, NOT a citation). */
export const PROXY_SOURCE_CHANNELS: ReadonlySet<SomSourceChannel> = new Set([
  "direct-proxy",
]);

/** True iff a source channel carries a real citation signal (not a proxy). */
export function isCitationChannel(channel: string): boolean {
  return CITATION_SOURCE_CHANNELS.has(channel as SomSourceChannel);
}

/**
 * The geo/region + device profile a probe ran under. Answer-engine results vary
 * by geo/device, so a citation rate is QUALIFIED by where it was observed, never
 * reported as universal (RFC §728 "geographic / device variance").
 */
export interface SomProbeContext {
  /** BCP-47-ish locale / region the probe ran under (e.g. "en-US"). */
  locale: string;
  /** The device profile the probe ran under (e.g. "desktop" | "mobile"). */
  deviceProfile: string;
}

/** The default probe context (US desktop) when a query bank entry omits one. */
export const DEFAULT_PROBE_CONTEXT: SomProbeContext = {
  locale: "en-US",
  deviceProfile: "desktop",
};

/**
 * The cite-target oracle for a probe: the brand strings / domain that count as a
 * "cited" hit. Matched case-insensitively by `som-parse`. (For Whispering Willows:
 * "Whispering Willows of Mount Vernon" / "Whispering Willows" / "whisperingwillows.com".)
 */
export interface CiteTarget {
  /** Brand-name strings that count as a citation (case-insensitive substring). */
  brandStrings: string[];
  /** Domains that count as a citation when linked/named (case-insensitive). */
  domains: string[];
}

/** One probe request: the normalized query + its cite-target + probe context. */
export interface SomProbeRequest {
  /** The NORMALIZED prompt text actually sent (canonical per funnel stage). */
  query: string;
  /** The cite-target oracle (brand strings + domains) for the "cited" check. */
  citeTarget: CiteTarget;
  /** Geo/device the probe runs under (defaults to DEFAULT_PROBE_CONTEXT). */
  context?: SomProbeContext;
}

/**
 * The result of a SINGLE successful probe. `rawResponse` is the verbatim engine
 * answer (persisted for audit / re-parse). `cited` / `position` / `parserConf`
 * are filled by `som-parse` over `rawResponse` against the cite-target — an
 * adapter MAY pre-fill them (e.g. a vendor API returns a structured citation) or
 * leave them for the parser. Channel-agnostic: a direct-API and a vendor-API
 * probe return the same shape.
 */
export interface SomProbeResult {
  /** The engine probed (ChatGPT | Claude | Gemini). */
  engine: ShareOfModelEngine;
  /** The verbatim engine/vendor response (persisted to `raw_response`). */
  rawResponse: string;
  /** Whether the cite-target was cited (null until `som-parse` decides). */
  cited: boolean | null;
  /** 1-based citation rank in the answer, or null (uncited / unknown). */
  position: number | null;
  /** Citation-extraction confidence 0..1, or null when not scored. */
  parserConf: number | null;
  /** The geo/region the probe ran under. */
  locale: string;
  /** The device profile the probe ran under. */
  deviceProfile: string;
  /** Which channel produced this result (direct model API vs vendor API). */
  sourceChannel: SomSourceChannel;
}

/**
 * A probe OUTCOME — either a successful result, a deferral (over rate-limit
 * budget), or a logged miss (a degraded engine). A miss / deferral NEVER crashes
 * the cron; it is logged + heartbeated and the cron moves on (RFC §728).
 */
export type SomProbeOutcome =
  | { status: "ok"; result: SomProbeResult }
  | { status: "deferred"; engine: ShareOfModelEngine; reason: string }
  | { status: "miss"; engine: ShareOfModelEngine; reason: string };

/**
 * Per-engine rate-limit budget config: at most `maxRequestsPerWindow` probes per
 * `windowMs`. An over-budget probe DEFERS (status "deferred") to the next window
 * rather than tripping a ban (RFC §728 "rate-limit budgets per engine").
 */
export interface RateLimitBudget {
  maxRequestsPerWindow: number;
  windowMs: number;
}

/**
 * A simple deterministic per-engine rate-limit budget gate. Pure / injectable so
 * the Tier-1 test can drive the clock. `tryConsume(now)` returns true if a probe
 * fits the current window's budget (and records it), false if the window is
 * exhausted (the caller then DEFERS). Sliding window over `windowMs`.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly budget: RateLimitBudget) {}

  /** Try to consume one unit of budget at `now` (ms). False ⇒ over budget. */
  tryConsume(now: number): boolean {
    const cutoff = now - this.budget.windowMs;
    // Drop stamps outside the sliding window.
    while (this.stamps.length > 0 && (this.stamps[0] as number) <= cutoff) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.budget.maxRequestsPerWindow) return false;
    this.stamps.push(now);
    return true;
  }

  /** Remaining budget in the current window at `now`. */
  remaining(now: number): number {
    const cutoff = now - this.budget.windowMs;
    const live = this.stamps.filter((s) => s > cutoff).length;
    return Math.max(0, this.budget.maxRequestsPerWindow - live);
  }
}

/**
 * The common adapter interface every engine implements. ONE adapter per engine
 * (their query/response/citation shapes differ), all behind this interface so the
 * cron is a single channel-agnostic loop. An adapter supports a `'direct'` path
 * (the Gateway model API) AND a pre-wired `'vendor-api'` fallback path (the
 * sanctioned GEO-tracker seam), selected by which credential is present.
 */
export interface SomAdapter {
  /** The engine this adapter probes. */
  readonly engine: ShareOfModelEngine;
  /** The per-engine rate-limit budget this adapter runs under. */
  readonly budget: RateLimitBudget;

  /**
   * Probe the engine for `req.query` and return the outcome. INERT CONTRACT: an
   * adapter MUST NOT make any live model/vendor call unless `SOM_LIVE` is set AND
   * its channel credentials are present — the cron never calls `probe()` when the
   * gate is closed, and an adapter that is reached without creds returns a `miss`
   * (it never throws / scrapes / spends). `now` is injected so the rate-limit
   * window is deterministic in tests.
   */
  probe(req: SomProbeRequest, now: number): Promise<SomProbeOutcome>;
}

// ── The INERT / flag-gate (the single source of truth for "is SoM live?") ─────

/** The env flag that must be explicitly set to "1"/"true" to enable live probes. */
export const SOM_LIVE_ENV = "SOM_LIVE" as const;

/**
 * Is live SoM probing enabled? TRUE only when `SOM_LIVE` is explicitly "1"/"true"
 * (case-insensitive). Unset / any other value ⇒ FALSE (inert). This is the single
 * gate the cron + every adapter consult; with it false NO probe runs and NO live
 * call / cost is possible. `env` is injectable so the test drives both branches.
 */
export function somLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[SOM_LIVE_ENV] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Which channel (if any) an adapter may activate, given the env. INERT-FIRST:
 *
 *   - if `SOM_LIVE` is not enabled ⇒ `'inert'` (no probe, no call — the merge-safe
 *     default; the cron skips and zero probes run).
 *   - else if the vendor-API credential is present ⇒ `'vendor-api'` (Channel B).
 *   - else if the Gateway credential is present ⇒ `'direct'` (Channel A).
 *   - else ⇒ `'inert'` (flag on but NO creds — still nothing live; a logged miss).
 *
 * The vendor channel takes precedence when both are present (the spike's "real"
 * consumer-citation metric beats the API proxy). Pure; reads only env.
 */
export type AdapterActivation = "inert" | "direct" | "vendor-api";

/** The Gateway credential env vars (any present ⇒ a direct channel is possible). */
export const GATEWAY_CRED_ENVS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;
/** The sanctioned vendor-API credential env (present ⇒ Channel B is possible). */
export const SOM_VENDOR_CRED_ENV = "SOM_VENDOR_API_KEY" as const;

export function adapterActivation(
  env: NodeJS.ProcessEnv = process.env,
): AdapterActivation {
  if (!somLiveEnabled(env)) return "inert";
  const hasVendor = Boolean((env[SOM_VENDOR_CRED_ENV] ?? "").trim());
  if (hasVendor) return "vendor-api";
  const hasGateway = GATEWAY_CRED_ENVS.some((k) => Boolean((env[k] ?? "").trim()));
  if (hasGateway) return "direct";
  return "inert";
}

/**
 * The sanctioned-vendor (GEO-tracker) API client seam (Channel B). PRE-WIRED but
 * NOT implemented against a live vendor here — `som-adapters` accept an injected
 * `VendorApiClient`; the default is the fail-closed `NOT_WIRED_VENDOR_API`. James
 * selects the vendor (Profound / AthenaHQ / Peec) and supplies the impl + key.
 */
export interface VendorApiClient {
  /**
   * Fetch the consumer-answer-engine citation signal for one (engine, query) from
   * the contracted GEO-tracker. Returns the raw vendor payload + the structured
   * citation it reports. Live impl is a separate human-reviewed wiring PR.
   */
  fetchCitation(args: {
    engine: ShareOfModelEngine;
    query: string;
    context: SomProbeContext;
  }): Promise<{ rawResponse: string; cited: boolean; position: number | null }>;
}

/** Thrown when the vendor seam is reached without a wired live client. */
export class VendorApiNotWiredError extends Error {
  readonly code = "SOM_VENDOR_API_NOT_WIRED" as const;
  constructor() {
    super(
      "SoM vendor-API channel is not wired: no contracted GEO-tracker client " +
        "(Profound/AthenaHQ/Peec) is injected (PR 021 scaffolding). Inject a " +
        "VendorApiClient + SOM_VENDOR_API_KEY to activate Channel B.",
    );
    this.name = "VendorApiNotWiredError";
  }
}

/** The fail-closed vendor client used until a real GEO-tracker is contracted. */
export const NOT_WIRED_VENDOR_API: VendorApiClient = {
  fetchCitation: () => {
    throw new VendorApiNotWiredError();
  },
};
