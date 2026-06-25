/**
 * SSRF-guarded SERP fetch + source-quality / authority-class layer (PR 005, lane
 * engine-port). The `/content/api/brief` route's grounding engine.
 *
 * TWO LAYERS, both load-bearing:
 *
 *   1. SSRF SAFETY (criterion 4). `isPrivateHost` blocks loopback / RFC-1918 /
 *      link-local (incl. 169.254.169.254 cloud metadata) / IPv6 ULA, and
 *      `isFetchableUrl` additionally blocks non-http(s) schemes. Fetched content
 *      is CAPPED (`MAX_PAGE_CHARS`). Fetched page text is UNTRUSTED: it is stored
 *      as a snippet for grounding only — never executed, and never re-injected
 *      verbatim into a privileged path (the caller treats `source.snippet` as
 *      data, the gate reads it as evidence, nothing eval's it).
 *
 *   2. SOURCE QUALITY / YMYL TRUST (criterion 5/6). Every source is graded with
 *      an `authorityClass`:
 *        (a) medical-authority  — NIH/NIA/CDC, Alzheimer's Association + named
 *            medical nonprofits, `.gov`/`.edu` medical/statistical domains.
 *        (b) client-fact        — a domain in the client's
 *            `voice_specs.attributionSources[]`. Grounds client-specific facts
 *            ONLY; a plain attributionSources entry is (b), NEVER (a).
 *        (c) low-authority      — everything else (scraped SERP snippet / unknown).
 *      Near-duplicate / spam snippets are dropped; robots.txt/ToS are honored
 *      (a disallowed path is skipped). The class is the input to the audit's
 *      criterion-6 trust check: only class-(a) can satisfy a YMYL medical claim.
 *
 * PURE-ISH: the classification + dedup helpers are pure + deterministic (unit-
 * testable with NO network). The actual fetch is injectable so SSRF + caps are
 * testable with a stub fetcher.
 *
 * PII rule: callers log only counts, never snippet/keyword content.
 * Clean ASCII / UTF-8.
 */

import "server-only";

import type { AuthorityClass, BriefSource } from "./contract";

// ── SSRF guard (byte-identical to flywheel-main `lib/content/ssrf.ts`) ─────────

/**
 * True if the hostname resolves to a private/loopback/link-local address. Blocks
 * SSRF against cloud metadata (169.254.169.254/170.2), RFC-1918, loopback, IPv6
 * loopback + ULA, and the 0.0.0.0/8 "this host" block.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./, // link-local + cloud metadata
    /^::1$/,
    /^\[::1\]$/,
    /^fd[0-9a-f]{2}:/i, // ULA IPv6
    /^\[fd[0-9a-f]{2}:/i,
    /^0\./,
  ];
  return privatePatterns.some((p) => p.test(host));
}

/**
 * True iff `url` is safe to fetch: a well-formed http(s) URL whose host is not
 * private/loopback/link-local. Non-http(s) schemes (file:, ftp:, gopher:, data:,
 * etc.) are rejected — only http and https may be crawled (criterion 4).
 */
export function isFetchableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isPrivateHost(parsed.hostname)) return false;
  return true;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const FETCH_TIMEOUT_MS = 8_000;
/** Hard cap on fetched page text (criterion 4 — fetched content is capped). */
export const MAX_PAGE_CHARS = 2_000;
export const MAX_SOURCES = 5;
export const SOURCES_TO_FETCH = 3;

// ── Authority classification (the source-quality layer) ───────────────────────

/**
 * Named medical/statistical authority host suffixes — class (a). Conservative,
 * high-precision: an org must be a recognized medical/statistical authority.
 * Lowercased host suffixes (matched with endsWith on the registrable host).
 */
const MEDICAL_AUTHORITY_HOSTS: readonly string[] = [
  "nih.gov",
  "nia.nih.gov",
  "cdc.gov",
  "medlineplus.gov",
  "ncbi.nlm.nih.gov",
  "who.int",
  "alz.org", // Alzheimer's Association
  "alzheimers.gov",
  "cancer.gov",
  "heart.org", // American Heart Association
  "mayoclinic.org",
  "aarp.org",
] as const;

/**
 * Generic top-level authority suffixes — a `.gov` or `.edu` domain is treated as
 * a medical/statistical authority (criterion 5: ".gov/.edu medical/statistical
 * domains"). `.mil` is excluded (not medical/statistical).
 */
const AUTHORITY_TLDS: readonly string[] = [".gov", ".edu"];

/** Normalize a URL to its canonical lowercased hostname (no port, no www.). */
export function canonicalDomain(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Classify a source's authority (criterion 5/6). Order matters:
 *
 *   1. medical-authority (a) — host is/ends-with a named medical authority OR a
 *      `.gov`/`.edu` domain. This is the ONLY class that can satisfy a YMYL
 *      medical claim.
 *   2. client-fact (b)       — host matches one of the client's attribution
 *      sources. A plain attributionSources entry is (b), NEVER (a), unless its
 *      domain ALSO independently qualifies as (a) — but a client cannot promote
 *      an arbitrary domain to medical authority by listing it (we check (a)
 *      first on intrinsic domain merit, so a client's attribution of, e.g.,
 *      `nih.gov` is (a) on its own merit, while `myclinicblog.com` is (b)).
 *   3. low-authority (c)     — everything else.
 *
 * @param url                - the source URL
 * @param attributionDomains - canonical domains from voice_specs.attributionSources[]
 */
export function classifyAuthority(
  url: string,
  attributionDomains: ReadonlySet<string>,
): AuthorityClass {
  const domain = canonicalDomain(url);
  if (!domain) return "low-authority";

  // (a) intrinsic medical/statistical authority — checked on the domain's OWN
  //     merit, so a client cannot launder a low-authority domain into (a).
  const isNamedAuthority = MEDICAL_AUTHORITY_HOSTS.some(
    (h) => domain === h || domain.endsWith(`.${h}`),
  );
  const isAuthorityTld = AUTHORITY_TLDS.some((tld) => domain.endsWith(tld));
  if (isNamedAuthority || isAuthorityTld) return "medical-authority";

  // (b) client-fact authority — the client listed this domain as an attribution
  //     source. Grounds client-specific facts only; NEVER a medical claim.
  if (attributionDomains.has(domain)) return "client-fact";

  // (c) low-authority / unknown.
  return "low-authority";
}

/** Build the set of canonical attribution domains from a voice spec's list. */
export function attributionDomainSet(
  attributionSources: readonly string[] | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const entry of attributionSources ?? []) {
    // An attributionSources[] entry may be a bare domain or a full URL.
    const asUrl = entry.includes("://") ? entry : `https://${entry}`;
    const domain = canonicalDomain(asUrl);
    if (domain) set.add(domain);
  }
  return set;
}

// ── Near-duplicate / spam filtering ───────────────────────────────────────────

/** A coarse content fingerprint for near-duplicate detection (lowercased alnum). */
function fingerprint(snippet: string): string {
  return snippet
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 24)
    .join(" ");
}

/**
 * Drop near-duplicate + empty/spam sources (criterion 5). Two sources are
 * near-duplicates when they share a canonical domain AND a fingerprint, or when
 * their fingerprints are identical across domains (syndicated/scraped copies).
 * An empty-snippet source from an already-seen domain is dropped as spam.
 */
export function dedupeSources(sources: BriefSource[]): BriefSource[] {
  const seenDomains = new Set<string>();
  const seenPrints = new Set<string>();
  const out: BriefSource[] = [];
  for (const s of sources) {
    const print = fingerprint(s.snippet);
    // Identical fingerprint anywhere → near-duplicate, drop.
    if (print.length > 0 && seenPrints.has(print)) continue;
    // Empty snippet from a domain we already have → spam/dup, drop.
    if (print.length === 0 && seenDomains.has(s.domain)) continue;
    out.push(s);
    seenDomains.add(s.domain);
    if (print.length > 0) seenPrints.add(print);
  }
  return out;
}

// ── robots.txt / ToS honoring ─────────────────────────────────────────────────

/**
 * Minimal robots.txt check: given the robots.txt body for a host and a target
 * path, return false when a `User-agent: *` (or our UA) `Disallow:` rule covers
 * the path. Conservative: an unparseable/absent robots is treated as ALLOW (we
 * only block on an explicit disallow). Pure — the robots body is fetched by the
 * caller and passed in (so this is unit-testable with no network).
 */
export function robotsAllows(robotsTxt: string | null, path: string): boolean {
  if (!robotsTxt) return true;
  const lines = robotsTxt.split(/\r?\n/);
  let appliesToUs = false;
  const disallows: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = (field ?? "").trim().toLowerCase();
    if (key === "user-agent") {
      appliesToUs = value === "*" || value.toLowerCase().includes("flywheelcontentbot");
    } else if (key === "disallow" && appliesToUs) {
      if (value.length > 0) disallows.push(value);
    }
  }
  return !disallows.some((d) => path.startsWith(d));
}

// ── Fetch (injectable for tests) ──────────────────────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (compatible; FlywheelContentBot/1.0; +https://flywheel.love)";

/** Strip HTML tags from a string. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch a page and return the first `MAX_PAGE_CHARS` chars of visible text.
 * Returns null when the URL fails the SSRF/scheme guard (never fetched) or on
 * any other failure. Scripts + styles are stripped BEFORE tag-stripping so no
 * executable content survives into the snippet (untrusted-text discipline).
 */
export async function fetchPageText(
  url: string,
  fetcher: Fetcher = fetch,
): Promise<string | null> {
  // SSRF + scheme guard FIRST — never even open a connection to a blocked host.
  if (!isFetchableUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const html = await res.text();
    const noScript = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    return stripTags(noScript).slice(0, MAX_PAGE_CHARS);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Source assembly ───────────────────────────────────────────────────────────

export interface RawSerpResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Grade + dedupe a set of raw SERP results into typed `BriefSource`s. Each entry
 * captures canonical URL + domain + fetched-at + authority class (criterion 5).
 * A result whose URL fails the SSRF/scheme guard is dropped entirely (never a
 * source). The snippet is the (already-capped, already-tag-stripped) page text.
 *
 * @param results            - raw {url,title,snippet} from the SERP/page fetch
 * @param attributionDomains - canonical domains from the client's attributionSources[]
 * @param now                - clock (injectable for deterministic tests)
 */
export function assembleSources(
  results: readonly RawSerpResult[],
  attributionDomains: ReadonlySet<string>,
  now: () => Date = () => new Date(),
): BriefSource[] {
  const fetchedAt = now().toISOString();
  const graded: BriefSource[] = [];
  for (const r of results) {
    if (!isFetchableUrl(r.url)) continue; // unsafe URL → never a source
    const domain = canonicalDomain(r.url);
    if (!domain) continue;
    graded.push({
      url: r.url,
      domain,
      title: r.title,
      snippet: r.snippet.slice(0, MAX_PAGE_CHARS),
      fetchedAt,
      authorityClass: classifyAuthority(r.url, attributionDomains),
    });
  }
  return dedupeSources(graded).slice(0, MAX_SOURCES);
}

// ── YMYL grounding trust (criterion 6 — the load-bearing trust boundary) ───────

/**
 * Select the sources that may GROUND a numeric/medical claim for the gate's
 * faithfulness check.
 *
 * THE CRITERION-6 RULE: for a YMYL piece, NEITHER a low-quality scraped snippet
 * (class (c)) NOR a client `attributionSources[]` entry (class (b)) can, by
 * itself, satisfy a medical claim's sourcing. So when grounding a YMYL piece's
 * medical claims, ONLY class-(a) medical/statistical authorities are passed to
 * the faithfulness gate. A medical claim whose only backing is class-(b)/(c)
 * text therefore has NO source to match -> the gate marks it UNSOURCED ->
 * `VETO_UNSOURCED_STAT` fires (the string appearing in fetched text or in the
 * client's attributionSources[] does NOT clear the veto).
 *
 * For a non-YMYL piece, all sources ground claims (the YMYL trust floor does not
 * apply). A class-(b) source still validly grounds a CLIENT-SPECIFIC fact — that
 * grounding is handled by the draft/brief layer (attributionSources feed
 * client-fact context), not by this medical-claim gate filter.
 *
 * Pure + deterministic. The returned array is the `brief.sources` the audit
 * route hands to `runSeoGate` (whose faithfulness scorer matches claims against
 * exactly these).
 */
export function sourcesForYmylGrounding(
  sources: readonly BriefSource[],
  isYmyl: boolean,
): BriefSource[] {
  if (!isYmyl) return [...sources];
  return sources.filter((s) => s.authorityClass === "medical-authority");
}
