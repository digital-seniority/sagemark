/**
 * passive-voice — detects passive voice constructions in a draft body.
 *
 * Uses a regex heuristic to find "to be + past participle" constructions.
 * No LLM, no credits — fully deterministic and client-safe.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PassiveVoiceResult {
  passiveCount: number;
  totalSentences: number;
  ratio: number; // 0.0–1.0
  examples: string[]; // up to 3 passive sentences, truncated to 80 chars each
  verdict: "HIGH" | "MODERATE" | "LOW";
  tip: string | null; // actionable tip when verdict is HIGH or MODERATE
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PASSIVE_REGEX =
  /\b(am|is|are|was|were|be|been|being)\s+(\w+ed|written|known|seen|done|found|given|made|said|taken|shown|used|kept|put|set|run|built|held|brought|sent|left|told|led|read|met|felt|gone|grown|become)\b/i;

const HIGH_THRESHOLD = 0.2;
const MODERATE_THRESHOLD = 0.1;
const EXAMPLE_LIMIT = 3;
const TRUNCATE_AT = 80;

const TIPS: Record<"HIGH" | "MODERATE", string> = {
  HIGH: "Over 20% passive voice — rewrite passive constructions to active for stronger copy",
  MODERATE:
    "Some passive voice detected — consider making key sentences active",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Split body text into sentences.
 * Splits on sentence-ending punctuation followed by whitespace (same as readability-surfacer.ts).
 */
function splitSentences(body: string): string[] {
  if (!body.trim()) return [];
  const raw = body.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Truncate a string at exactly maxChars characters (hard char limit, not word boundary).
 * If truncated, appends "…".
 */
function truncateAt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect passive voice constructions in `body`.
 *
 * A sentence is counted as passive if it contains at least one match for
 * the "to be + past participle" pattern (case-insensitive). A sentence
 * that matches multiple times is still counted once.
 */
export function detectPassiveVoice(body: string): PassiveVoiceResult {
  const sentences = splitSentences(body);
  const totalSentences = sentences.length;

  if (totalSentences === 0) {
    return {
      passiveCount: 0,
      totalSentences: 0,
      ratio: 0,
      examples: [],
      verdict: "LOW",
      tip: null,
    };
  }

  const passiveSentences: string[] = [];

  for (const sentence of sentences) {
    if (PASSIVE_REGEX.test(sentence)) {
      passiveSentences.push(sentence);
    }
  }

  const passiveCount = passiveSentences.length;
  const ratio = passiveCount / totalSentences;

  const verdict: PassiveVoiceResult["verdict"] =
    ratio >= HIGH_THRESHOLD
      ? "HIGH"
      : ratio >= MODERATE_THRESHOLD
        ? "MODERATE"
        : "LOW";

  const tip = verdict === "LOW" ? null : TIPS[verdict];

  const examples = passiveSentences
    .slice(0, EXAMPLE_LIMIT)
    .map((s) => truncateAt(s, TRUNCATE_AT));

  return {
    passiveCount,
    totalSentences,
    ratio,
    examples,
    verdict,
    tip,
  };
}
