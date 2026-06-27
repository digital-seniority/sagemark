/**
 * keyword-density — pure heuristic keyword density analyzer (no LLM, no credits).
 *
 * Counts whole-word, case-insensitive occurrences of a keyword (or phrase) in a draft
 * and classifies the result as under / optimal / stuffed.
 *
 * Thresholds:
 *   under:   densityPercent < 0.5
 *   optimal: 0.5 ≤ densityPercent ≤ 4.0
 *   stuffed: densityPercent > 4.0
 */

import { stripMarkdown } from "./meta-tag-generator";

export interface KeywordDensityResult {
  keyword: string;
  occurrences: number;
  wordCount: number;
  /** (occurrences / wordCount) * 100, rounded to 2 decimal places */
  densityPercent: number;
  status: "under" | "optimal" | "stuffed";
  recommendation: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape special regex metacharacters so user-supplied keywords are literal. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyse the keyword density of `keyword` in `draft`.
 *
 * - Strips markdown before analysis.
 * - Word count: whitespace-split, empty tokens filtered.
 * - Keyword match: whole-word, case-insensitive (phrase support via `\b` anchors).
 * - densityPercent is rounded to 2 decimal places.
 */
export function analyzeKeywordDensity(
  draft: string,
  keyword: string,
): KeywordDensityResult {
  const plain = stripMarkdown(draft);

  // Word count — split on whitespace and drop empty tokens
  const words = plain.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Count whole-word occurrences (phrase-aware via \b boundary anchors)
  let occurrences = 0;
  if (wordCount > 0 && keyword.trim().length > 0) {
    const pattern = new RegExp("\\b" + escapeRegex(keyword.trim()) + "\\b", "gi");
    const matches = plain.match(pattern);
    occurrences = matches ? matches.length : 0;
  }

  // Density calculation — guard against zero word count
  const raw = wordCount > 0 ? (occurrences / wordCount) * 100 : 0;
  const densityPercent = Math.round(raw * 100) / 100;

  // Classification and recommendation
  let status: KeywordDensityResult["status"];
  let recommendation: string;

  if (densityPercent < 0.5) {
    status = "under";
    recommendation =
      "Keyword appears rarely. Use it more naturally in the opening paragraph, headings, and conclusion.";
  } else if (densityPercent <= 4.0) {
    status = "optimal";
    recommendation = "Good keyword usage. Natural density in the optimal range.";
  } else {
    status = "stuffed";
    recommendation =
      "Keyword appears too frequently (over 4%). Google may penalize keyword stuffing — rephrase some instances with synonyms.";
  }

  return {
    keyword,
    occurrences,
    wordCount,
    densityPercent,
    status,
    recommendation,
  };
}
