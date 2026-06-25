/**
 * banned-lexicon-linter — deterministic anti-AI-slop + banned-term linter
 * (no LLM, no credits, no network).
 *
 * Given a content body plus a voice-spec `bannedTerms[]`, this scans for
 * prohibited terms/phrasing and a built-in anti-AI-slop phrase floor
 * ("in today's fast-paced world", "it's important to note", "in conclusion",
 * em-dash spam, etc.). It complements — does NOT replace — the LLM
 * `voice-gate.ts`: the gate reasons about tone/audience fit, while this is a
 * cheap, repeatable pre-filter that always runs.
 *
 * Matching is case-insensitive and word-boundary aware. Markdown formatting
 * (headings, emphasis, links, code fences, list markers) is stripped before
 * matching so formatting characters do not break word boundaries — e.g.
 * "**in conclusion**" still matches the phrase "in conclusion".
 *
 * The built-in slop list ALWAYS applies; `bannedTerms[]` EXTENDS it (the
 * client spec is a ceiling on top of the floor, never a replacement for it).
 *
 * Emits the failure code `VETO_BANNED_LEXICON` when any hit is found.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LexiconHit {
  /** The offending term/phrase (lowercased, as matched). */
  term: string;
  /** How many times it appears. */
  count: number;
  /** Whether the hit came from the built-in slop floor or the client list. */
  source: "builtin" | "client";
}

export interface BannedLexiconResult {
  /** true when no banned term or slop phrase was found. */
  passed: boolean;
  /** All distinct hits, each with an occurrence count. */
  hits: LexiconHit[];
  /** Present only when passed === false. */
  failureCode?: "VETO_BANNED_LEXICON";
}

// ── Built-in anti-AI-slop floor ───────────────────────────────────────────────

/**
 * Phrases that signal generic, AI-generated filler. Always applied regardless
 * of the client `bannedTerms[]`. Authored in straight ASCII (no smart quotes /
 * em-dashes) to guarantee clean UTF-8; the literal em-dash is detected
 * separately via a unicode escape (see EM_DASH_SPAM below).
 */
const BUILTIN_SLOP_PHRASES: string[] = [
  "in today's fast-paced world",
  "in today's digital age",
  "in today's modern world",
  "it's important to note",
  "it is important to note",
  "it's worth noting",
  "it is worth noting",
  "in conclusion",
  "at the end of the day",
  "when it comes to",
  "needless to say",
  "last but not least",
  "the world of",
  "navigating the",
  "in the realm of",
  "a testament to",
  "delve into",
  "dive into",
  "unlock the power",
  "unleash the power",
  "harness the power",
  "take it to the next level",
  "game-changer",
  "game changer",
  "ever-evolving",
  "ever-changing",
  "rapidly changing",
  "let's face it",
  "look no further",
  "more than just",
  "first and foremost",
  "without further ado",
  "the bottom line is",
];

/**
 * The literal em-dash character (U+2014), referenced via unicode escape rather
 * than a literal so this source file stays plain-ASCII / clean-UTF-8. Em-dash
 * spam (3+ em-dashes in a body) is a classic AI-slop tell.
 */
const EM_DASH = "—";
const EM_DASH_SPAM_THRESHOLD = 3;
const EM_DASH_LABEL = "em-dash spam";

// ── Markdown stripping ────────────────────────────────────────────────────────

/**
 * Strip common markdown formatting so phrase matching is not broken by
 * formatting characters. Self-contained (no shared util in this lib).
 *
 * Collapses: fenced/inline code, images, links (keep link text), headings,
 * blockquotes, list markers, emphasis/bold/strikethrough markers, and table
 * pipes. Newlines are normalized to spaces so phrases can be matched across
 * wrapped lines.
 */
function stripMarkdown(input: string): string {
  let s = input;
  // Fenced code blocks → drop entirely.
  s = s.replace(/```[\s\S]*?```/g, " ");
  // Inline code → keep inner text without backticks.
  s = s.replace(/`([^`]*)`/g, "$1");
  // Images ![alt](url) → drop (alt rarely prose).
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // Links [text](url) → keep text.
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // ATX heading markers at line start.
  s = s.replace(/^#{1,6}\s+/gm, "");
  // Blockquote markers at line start.
  s = s.replace(/^\s*>\s?/gm, "");
  // Unordered + ordered list markers at line start.
  s = s.replace(/^\s*([-*+]|\d+\.)\s+/gm, "");
  // Emphasis / bold / strikethrough markers.
  s = s.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, "");
  // Table pipes.
  s = s.replace(/\|/g, " ");
  // Normalize whitespace (incl. newlines) to single spaces.
  s = s.replace(/\s+/g, " ");
  return s;
}

// ── Matching ──────────────────────────────────────────────────────────────────

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a word-boundary-aware, case-insensitive matcher for a term/phrase.
 *
 * We cannot rely on `\b` alone because terms may begin or end with non-word
 * characters (e.g. "it's worth noting", "game-changer"). Instead we require
 * the match to be preceded/followed by a non-letter/digit (or string edge),
 * which prevents substring false-positives like "conclusion" inside
 * "preconclusionary" while still allowing internal apostrophes/hyphens.
 */
function buildMatcher(term: string): RegExp {
  const escaped = escapeRegExp(term.toLowerCase());
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
}

/** Count non-overlapping, boundary-aware occurrences of `term` in `haystack`. */
function countOccurrences(haystack: string, term: string): number {
  const trimmed = term.trim();
  if (trimmed.length === 0) return 0;
  const matcher = buildMatcher(trimmed);
  const matches = haystack.match(matcher);
  return matches ? matches.length : 0;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Lint a content body against the built-in anti-AI-slop floor plus any
 * client-supplied banned terms.
 *
 * @param body        - the content body (markdown allowed; stripped internally)
 * @param bannedTerms - client/voice-spec banned terms; EXTENDS the floor.
 *                      An empty array still applies the full built-in floor.
 * @returns BannedLexiconResult — pure, deterministic, no network.
 */
export function lintBannedLexicon(
  body: string,
  bannedTerms: string[] = [],
): BannedLexiconResult {
  const clean = stripMarkdown(body ?? "");
  const haystackLower = clean.toLowerCase();

  const hits: LexiconHit[] = [];
  const seen = new Set<string>();

  // Client terms first (so a term shared with the floor is attributed to the
  // client list, which is the stricter / more intentional source).
  const clientTerms = (bannedTerms ?? [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0);

  for (const term of clientTerms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const count = countOccurrences(haystackLower, key);
    if (count > 0) {
      hits.push({ term: key, count, source: "client" });
      seen.add(key);
    } else {
      // Mark as seen so a duplicate client term isn't reprocessed; a later
      // builtin with the same text would still be skipped (already a client
      // concern), which is the desired attribution.
      seen.add(key);
    }
  }

  // Built-in slop floor (always applied).
  for (const phrase of BUILTIN_SLOP_PHRASES) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    const count = countOccurrences(haystackLower, key);
    if (count > 0) {
      hits.push({ term: key, count, source: "builtin" });
    }
    seen.add(key);
  }

  // Em-dash spam (built-in, threshold-based; not a phrase match).
  // Count against the ORIGINAL body, not the stripped text, since stripping
  // does not remove em-dashes anyway and we want the true authored count.
  const emDashCount = (body ?? "").split(EM_DASH).length - 1;
  if (emDashCount >= EM_DASH_SPAM_THRESHOLD) {
    hits.push({ term: EM_DASH_LABEL, count: emDashCount, source: "builtin" });
  }

  const passed = hits.length === 0;
  return passed
    ? { passed, hits }
    : { passed, hits, failureCode: "VETO_BANNED_LEXICON" };
}
