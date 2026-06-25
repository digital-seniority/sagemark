/**
 * flesch-kincaid — computes Flesch-Kincaid Grade Level and Reading Ease for content.
 *
 * Uses a standard vowel-group syllable heuristic (no LLM, no credits).
 * Fully deterministic and client-safe.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FleschKincaidResult {
  gradeLevel: number;           // e.g. 8.2
  readingEase: number;          // 0-100 Flesch Reading Ease
  verdict: "EASY" | "MODERATE" | "COMPLEX";
  tip: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  // Count vowel groups
  const matches = word.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  // Subtract trailing silent e (if not the only vowel)
  if (word.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function splitSentences(body: string): string[] {
  if (!body.trim()) return [];
  const raw = body.split(/(?<=[.!?])\s+/);
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenizeWords(body: string): string[] {
  return body.split(/\s+/).filter((w) => w.length > 0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute Flesch-Kincaid Grade Level and Flesch Reading Ease for `body`.
 *
 * Edge cases:
 * - Empty body or fewer than 2 sentences: grade 0, ease 100, EASY, no tip.
 */
export function computeFleschKincaid(body: string): FleschKincaidResult {
  const sentences = splitSentences(body);

  if (sentences.length < 2) {
    return {
      gradeLevel: 0,
      readingEase: 100,
      verdict: "EASY",
      tip: null,
    };
  }

  const words = tokenizeWords(body);
  const wordCount = words.length;
  const sentenceCount = sentences.length;

  if (wordCount === 0) {
    return {
      gradeLevel: 0,
      readingEase: 100,
      verdict: "EASY",
      tip: null,
    };
  }

  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = syllableCount / wordCount;

  // Flesch-Kincaid Grade Level
  const gradeLevel =
    0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  // Flesch Reading Ease
  const readingEase =
    206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;

  let verdict: "EASY" | "MODERATE" | "COMPLEX";
  if (gradeLevel <= 8) {
    verdict = "EASY";
  } else if (gradeLevel <= 12) {
    verdict = "MODERATE";
  } else {
    verdict = "COMPLEX";
  }

  let tip: string | null;
  if (verdict === "COMPLEX") {
    tip =
      "Aim for grade 8 or below — simplify long words and shorten sentences for broader reach";
  } else if (verdict === "MODERATE") {
    tip =
      "Grade level is accessible but could be simplified — consider breaking up long sentences";
  } else {
    tip = null;
  }

  return {
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    readingEase: Math.round(readingEase * 10) / 10,
    verdict,
    tip,
  };
}
