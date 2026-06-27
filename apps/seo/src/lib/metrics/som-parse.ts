/**
 * Share-of-Model citation parser + prompt normalizer + audit sampler (PR 021 /
 * P1.C.4, lane worker-runtime). RFC engineering-rfc.md §728.
 *
 * THREE JOBS (all pure — no I/O, no network, deterministic):
 *
 *  1. CITATION EXTRACTION + PARSER CONFIDENCE. Given a raw engine response and the
 *     cite-target oracle (the brand strings / domain from the query bank), decide
 *     whether the target is CITED, at what POSITION (1-based first-mention rank),
 *     and with what PARSER CONFIDENCE 0..1. Confidence is graded by HOW the match
 *     was found: a linked/explicit domain or full brand name scores high; a bare
 *     short brand fragment scores lower (more ambiguous); no match is a confident
 *     "not cited". Confidence is RECORDED per row so parser error is measured, not
 *     assumed zero (RFC §728 "parser confidence").
 *
 *  2. PROMPT NORMALIZATION. Queries are normalized to a canonical phrasing (per
 *     funnel stage) so week-over-week trends compare LIKE-FOR-LIKE, not drift from
 *     re-worded prompts (RFC §728 "prompt normalization"). Normalization is
 *     idempotent: normalize(normalize(x)) === normalize(x).
 *
 *  3. AUDIT SAMPLING. A deterministic, seeded fraction of probes is flagged for
 *     manual audit (`audit_sampled`) so parser error can be spot-checked (RFC §728
 *     "manual audit sampling"). Deterministic (hash of the query) so the same
 *     prompt samples consistently and the test is stable.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` (Tier-1 vitest, plain Node).
 */

import { type CiteTarget, isCitationChannel } from "./som-adapters/types";

// ── 1. Citation extraction + parser confidence ────────────────────────────────

/** The parser verdict over a raw response against a cite-target. */
export interface CitationVerdict {
  /** Whether the cite-target was found in the response. */
  cited: boolean;
  /** 1-based rank of the FIRST cite-target mention among candidate brands, or null. */
  position: number | null;
  /** Parser confidence 0..1 (how reliable the cited/uncited decision is). */
  parserConf: number;
  /** Which cite-target token matched (for audit), or null when uncited. */
  matchedOn: string | null;
}

/** Confidence floors per match kind — a domain / full-name match is most reliable. */
const CONF_DOMAIN = 0.97;
const CONF_FULL_BRAND = 0.95;
/** A short / partial brand fragment is more ambiguous (could be coincidental). */
const CONF_SHORT_BRAND = 0.7;
/** A confident NO match (target absent from a non-empty response). */
const CONF_CONFIDENT_ABSENT = 0.9;
/** An empty / unusably short response — we cannot trust the absence. */
const CONF_LOW = 0.2;
/** Below this many chars a response is treated as unusable (low confidence). */
const MIN_USABLE_RESPONSE_CHARS = 8;
/** A brand string shorter than this is treated as a "short" (ambiguous) brand. */
const SHORT_BRAND_THRESHOLD = 16;

/**
 * Extract the citation verdict for `rawResponse` against `target`. Pure +
 * deterministic. Matching is case-insensitive substring; `position` is the
 * 1-based order of the FIRST cite-target mention relative to the response start
 * (rank 1 = the target is the first thing mentioned in the answer). A domain hit
 * is preferred (most reliable); then a full brand name; then a short fragment.
 */
export function extractCitation(
  rawResponse: string,
  target: CiteTarget,
): CitationVerdict {
  const text = rawResponse ?? "";
  const haystack = text.toLowerCase();

  // An empty / trivially-short response cannot be trusted either way.
  if (haystack.trim().length < MIN_USABLE_RESPONSE_CHARS) {
    return { cited: false, position: null, parserConf: CONF_LOW, matchedOn: null };
  }

  // Find the earliest index at which any cite-target token appears, with the
  // confidence its match-kind warrants. Domains + full brand names win on ties.
  let bestIdx = -1;
  let bestConf = 0;
  let bestToken: string | null = null;

  const consider = (token: string, conf: number) => {
    const needle = token.trim().toLowerCase();
    if (!needle) return;
    const idx = haystack.indexOf(needle);
    if (idx === -1) return;
    // Prefer an earlier mention; on an equal index prefer the higher confidence.
    if (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && conf > bestConf)) {
      bestIdx = idx;
      bestConf = conf;
      bestToken = token.trim();
    }
  };

  for (const d of target.domains) consider(d, CONF_DOMAIN);
  for (const b of target.brandStrings) {
    consider(b, b.trim().length >= SHORT_BRAND_THRESHOLD ? CONF_FULL_BRAND : CONF_SHORT_BRAND);
  }

  if (bestIdx === -1) {
    // Confident "not cited": a usable response that never names the target.
    return {
      cited: false,
      position: null,
      parserConf: CONF_CONFIDENT_ABSENT,
      matchedOn: null,
    };
  }

  // Position = 1-based rank among the cite-target tokens by first appearance.
  // (We rank the TARGET's first mention; absent other brands' positions, a
  // first-character match is rank 1; a later mention scales up coarsely.)
  const position = positionRank(text, bestIdx);

  return { cited: true, position, parserConf: bestConf, matchedOn: bestToken };
}

/**
 * Coarse 1-based position rank of a mention at char `idx` within `text`: rank 1
 * if it appears in the first ~20% of the answer, scaling up by quintile. A
 * citation early in the answer ranks higher (more prominent) than one buried at
 * the end. Bounded to [1, 5].
 */
function positionRank(text: string, idx: number): number {
  const len = Math.max(1, text.length);
  const quintile = Math.floor((idx / len) * 5); // 0..4
  return Math.min(5, Math.max(1, quintile + 1));
}

// ── 2. Prompt normalization ───────────────────────────────────────────────────

/**
 * Normalize a prompt to canonical phrasing so week-over-week trends compare
 * like-for-like. Deterministic + IDEMPOTENT:
 *   - trim + collapse internal whitespace to a single space
 *   - lowercase (case is not semantically load-bearing for an answer-engine query)
 *   - strip a single trailing sentence-final punctuation mark (./?/!)
 *   - normalize spacing around slashes (kept — the bank uses "A / B" lists)
 * It does NOT paraphrase (that would defeat auditability); it canonicalizes
 * surface form only. The normalized string is what is SENT and PERSISTED.
 */
export function normalizeQuery(raw: string): string {
  let s = (raw ?? "").normalize("NFKC");
  s = s.replace(/\s+/g, " ").trim();
  s = s.toLowerCase();
  // Canonicalize " / " spacing (the bank lists alternatives with slashes).
  s = s.replace(/\s*\/\s*/g, " / ");
  // Drop a single trailing sentence-final mark; keep internal punctuation.
  s = s.replace(/[.?!]+$/g, "").trim();
  return s;
}

// ── 3. Audit sampling ─────────────────────────────────────────────────────────

/** The default fraction of probes flagged for manual audit (10%). */
export const DEFAULT_AUDIT_SAMPLE_RATE = 0.1;

/**
 * A small, stable FNV-1a-ish hash of a string → a uint in [0, 2^32). Deterministic
 * across runs/platforms (no Math.random), so the same prompt samples consistently
 * and the Tier-1 test is reproducible.
 */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Should this (normalized) query be flagged for manual audit? Deterministic:
 * `hash(query) / 2^32 < rate`. With `rate = 0` nothing is sampled; with `rate = 1`
 * everything is. The same query always yields the same decision (stable spot-check
 * set), independent of run order. `salt` lets a caller rotate the sampled set per
 * window without changing the rate.
 */
export function isAuditSampled(
  normalizedQuery: string,
  rate: number = DEFAULT_AUDIT_SAMPLE_RATE,
  salt = "",
): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const h = stableHash(`${salt}:${normalizedQuery}`);
  return h / 0x100000000 < rate;
}

// ── 4. Channel-segmented rollup (the HYBRID decision: never conflate proxy) ────

/** A minimal row the channel-aware rollup needs (a subset of the persisted row). */
export interface RollupRow {
  cited: boolean;
  /** The `share_of_model.source_channel` label (direct-citation / direct-proxy / vendor). */
  sourceChannel: string;
}

/** A per-channel-class rate (denominator + numerator + rate in [0,1]). */
export interface ChannelRate {
  total: number;
  cited: number;
  rate: number;
}

/**
 * A rollup SEGMENTED by citation-quality so a PROXY engine is NEVER summed into a
 * "share-of-model citation rate" unlabeled (the HYBRID channel decision):
 *
 *   - `citation`     — rows whose channel carries a REAL citation signal
 *                      (`direct-citation` / `vendor`). THIS is the headline
 *                      share-of-model rate.
 *   - `proxy`        — rows whose channel is a model-answer-mention PROXY
 *                      (`direct-proxy`). Reported as "API-answer mention rate
 *                      (proxy)", NEVER as universal share-of-model.
 *   - `perChannel`   — the raw cited/total per individual source_channel label.
 *
 * The two classes are kept SEPARATE by construction — there is no combined rate
 * that mixes a proxy mention with a real citation.
 */
export interface SegmentedRollup {
  citation: ChannelRate;
  proxy: ChannelRate;
  perChannel: Record<string, ChannelRate>;
}

function emptyRate(): ChannelRate {
  return { total: 0, cited: 0, rate: 0 };
}

function finalizeRate(r: ChannelRate): ChannelRate {
  return { ...r, rate: r.total === 0 ? 0 : r.cited / r.total };
}

/**
 * Roll rows up SEGMENTED by source-channel citation-quality. Pure. The headline
 * `citation` rate sums ONLY real-citation channels (direct-citation / vendor); the
 * `proxy` rate sums proxy channels (direct-proxy) separately and is labeled as a
 * mention-rate proxy by the consumer, never as share-of-model.
 */
export function rollUpBySourceChannel(rows: RollupRow[]): SegmentedRollup {
  const citation = emptyRate();
  const proxy = emptyRate();
  const perChannel: Record<string, ChannelRate> = {};

  for (const row of rows) {
    const bucket = isCitationChannel(row.sourceChannel) ? citation : proxy;
    bucket.total += 1;
    if (row.cited) bucket.cited += 1;

    const pc = (perChannel[row.sourceChannel] ??= emptyRate());
    pc.total += 1;
    if (row.cited) pc.cited += 1;
  }

  for (const k of Object.keys(perChannel)) {
    perChannel[k] = finalizeRate(perChannel[k] as ChannelRate);
  }
  return {
    citation: finalizeRate(citation),
    proxy: finalizeRate(proxy),
    perChannel,
  };
}
