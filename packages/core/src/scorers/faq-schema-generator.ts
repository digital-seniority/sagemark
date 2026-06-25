/**
 * faq-schema-generator — pure heuristic FAQ JSON-LD schema extractor (no LLM, no credits).
 *
 * Detects question/answer pairs in a draft article using pattern heuristics:
 *   1. Explicit "Q:" / "Q." prefix lines
 *   2. Sentences ending in "?" between 30-120 chars
 *   3. "## " / "### " headings that end with "?"
 *   4. "## " / "### " headings starting with common question words (What/How/Why/…)
 *
 * Outputs valid FAQ JSON-LD schema capped at 10 pairs.
 */

export interface FaqPair {
  question: string;
  answer: string;
  /** 'explicit' = Q:/Q. format; 'inferred' = heuristic (heading or sentence) */
  source: "explicit" | "inferred";
}

export interface FaqSchemaResult {
  /** Up to 10 Q&A pairs */
  pairs: FaqPair[];
  /** Formatted JSON-LD <script> block */
  jsonLd: string;
  /** true when no Q&A pairs were found */
  isEmpty: boolean;
  /** Number of pairs found but not included due to the 10-pair cap */
  truncatedCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PAIRS = 10;
const MAX_ANSWER_CHARS = 200;
const ANSWER_SEARCH_WINDOW = 300;

/** Common question-word prefixes for heading detection */
const QUESTION_STARTERS = [
  "What ",
  "How ",
  "Why ",
  "When ",
  "Where ",
  "Who ",
  "Is ",
  "Are ",
  "Can ",
  "Should ",
  "Does ",
  "Do ",
  "Will ",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Trim surrounding whitespace and trailing punctuation used as decoration */
function cleanText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Truncate answer text to MAX_ANSWER_CHARS, appending "…" if needed */
function truncateAnswer(text: string): string {
  const t = cleanText(text);
  if (t.length <= MAX_ANSWER_CHARS) return t;
  // Truncate at a word boundary if possible
  const slice = t.slice(0, MAX_ANSWER_CHARS - 3);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > MAX_ANSWER_CHARS * 0.7 ? slice.slice(0, lastSpace) : slice) + "...";
}

/** Strip markdown heading markers and inline formatting for clean text */
function stripHeadingMarkers(s: string): string {
  return s.replace(/^#{1,6}\s+/, "").trim();
}

/** Extract the first meaningful sentence / content from a text block */
function firstSentenceFrom(text: string): string {
  const t = cleanText(text);
  // Split on sentence-ending punctuation
  const match = t.match(/^(.+?[.!?])(?:\s|$)/);
  // Capture group 1 is always present when `match` is truthy (the pattern has a
  // single mandatory group). Compile-time assertion only — no runtime change.
  return match ? match[1]!.trim() : t.slice(0, MAX_ANSWER_CHARS);
}

// ── Candidate extraction ──────────────────────────────────────────────────────

interface Candidate {
  question: string;
  /** Character offset in the original draft where the answer search begins */
  answerSearchStart: number;
  /** Whether this came from a Q: line (answer on very next line) */
  isExplicitQA: boolean;
}

function extractCandidates(draft: string): Candidate[] {
  const candidates: Candidate[] = [];
  const lines = draft.split("\n");
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by construction: `i < lines.length` guarantees `lines[i]` exists.
    // Compile-time assertion only — no runtime change.
    const line = lines[i]!;
    const lineStart = offset;
    offset += line.length + 1; // +1 for the \n

    const trimmed = line.trim();

    // ── Priority 1: Explicit "Q:" or "Q." prefix ─────────────────────────────
    const explicitMatch = trimmed.match(/^Q[:.]\s+(.+)$/i);
    if (explicitMatch) {
      // Group 1 is mandatory in the pattern, so it exists whenever the match
      // does. Compile-time assertion only — no runtime change.
      const question = cleanText(explicitMatch[1]!);
      if (question.length >= 10) {
        candidates.push({
          question,
          answerSearchStart: lineStart + line.length + 1,
          isExplicitQA: true,
        });
      }
      continue;
    }

    // ── Priority 2: Headings ending in "?" ───────────────────────────────────
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+\?)$/);
    if (headingMatch) {
      // Group 2 is mandatory in the pattern, so it exists whenever the match
      // does. Compile-time assertion only — no runtime change.
      const question = cleanText(headingMatch[2]!);
      if (question.length >= 15) {
        candidates.push({
          question,
          answerSearchStart: lineStart + line.length + 1,
          isExplicitQA: false,
        });
      }
      continue;
    }

    // ── Priority 3: Headings starting with question words ────────────────────
    const headingWordMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingWordMatch) {
      // Group 2 is mandatory in the pattern, so it exists whenever the match
      // does. Compile-time assertion only — no runtime change.
      const headingText = headingWordMatch[2]!;
      const startsWithQuestion = QUESTION_STARTERS.some((starter) =>
        headingText.startsWith(starter),
      );
      if (startsWithQuestion) {
        const question = cleanText(headingText);
        // Normalise: add "?" if missing
        const normalised = question.endsWith("?") ? question : question + "?";
        if (normalised.length >= 15) {
          candidates.push({
            question: normalised,
            answerSearchStart: lineStart + line.length + 1,
            isExplicitQA: false,
          });
        }
      }
      continue;
    }

    // ── Priority 4: Sentences ending in "?" (30-120 chars) ───────────────────
    // Split the line into sentences and check each one
    const sentencePattern = /[^.!?]*\?/g;
    let sentMatch: RegExpExecArray | null;
    while ((sentMatch = sentencePattern.exec(line)) !== null) {
      // Index 0 (the full match) is always present on a non-null exec result.
      // Compile-time assertion only — no runtime change.
      const sentence = cleanText(sentMatch[0]!);
      if (sentence.length >= 30 && sentence.length <= 120) {
        const sentEnd = lineStart + sentMatch.index + sentMatch[0].length;
        candidates.push({
          question: sentence,
          answerSearchStart: sentEnd,
          isExplicitQA: false,
        });
      }
    }
  }

  return candidates;
}

// ── Answer extraction ─────────────────────────────────────────────────────────

function extractAnswer(
  draft: string,
  candidate: Candidate,
): string | null {
  const { answerSearchStart, isExplicitQA } = candidate;

  if (answerSearchStart >= draft.length) return null;

  // Grab up to ANSWER_SEARCH_WINDOW chars from the position after the question
  const window = draft.slice(answerSearchStart, answerSearchStart + ANSWER_SEARCH_WINDOW);
  if (!window.trim()) return null;

  if (isExplicitQA) {
    // Take the very next non-empty line as the answer
    const nextLineMatch = window.match(/^\s*([^\n]+)/);
    if (!nextLineMatch) return null;
    // Group 1 is mandatory in the pattern, so it exists whenever the match does.
    // Compile-time assertion only — no runtime change.
    const answerLine = cleanText(nextLineMatch[1]!);
    // Strip "A:" / "A." prefix if present
    const strippedAnswer = answerLine.replace(/^A[:.]\s*/i, "");
    return strippedAnswer.length >= 5 ? truncateAnswer(strippedAnswer) : null;
  }

  // For headings and question sentences: take first paragraph / sentence
  const windowTrimmed = window.replace(/^[\s\n]+/, "");
  if (!windowTrimmed) return null;

  // If the content right after is another heading, skip (no body text found)
  if (windowTrimmed.startsWith("#")) return null;

  const answer = firstSentenceFrom(windowTrimmed);
  return answer.length >= 5 ? truncateAnswer(answer) : null;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicatePairs(pairs: FaqPair[]): FaqPair[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = pair.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── JSON-LD builder ───────────────────────────────────────────────────────────

function buildJsonLd(pairs: FaqPair[]): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: pair.answer,
      },
    })),
  };

  const json = JSON.stringify(schema, null, 2);
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function extractFaqSchema(
  draft: string,
  _keyword?: string,
): FaqSchemaResult {
  if (!draft.trim()) {
    return {
      pairs: [],
      jsonLd: buildJsonLd([]),
      isEmpty: true,
      truncatedCount: 0,
    };
  }

  const candidates = extractCandidates(draft);
  const rawPairs: FaqPair[] = [];

  for (const candidate of candidates) {
    const answer = extractAnswer(draft, candidate);
    if (answer) {
      rawPairs.push({
        question: candidate.question,
        answer,
        source: candidate.isExplicitQA ? "explicit" : "inferred",
      });
    }
  }

  const deduplicated = deduplicatePairs(rawPairs);
  const truncatedCount = Math.max(0, deduplicated.length - MAX_PAIRS);
  const pairs = deduplicated.slice(0, MAX_PAIRS);

  return {
    pairs,
    jsonLd: buildJsonLd(pairs),
    isEmpty: pairs.length === 0,
    truncatedCount,
  };
}
