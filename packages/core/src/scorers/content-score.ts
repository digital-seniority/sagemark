/**
 * content-score — pure heuristic content quality scorer (no LLM, no credits).
 *
 * Produces a 0-20 total score across 5 dimensions and a PUBLISH/REVIEW/REWRITE
 * verdict. All logic is client-safe and works synchronously.
 *
 * Also exports scoreContentBreakdown() which returns the same scores in a
 * per-dimension breakdown format with rationale + improvement tips.
 */

export interface ContentScoreResult {
  total: number; // 0-25 (sum of 5 dimensions, each 0-5)
  verdict: "PUBLISH" | "REVIEW" | "REWRITE"; // ≥16 PUBLISH, 10-15 REVIEW, <10 REWRITE
  components: {
    readability: number; // 0-5: Flesch-Kincaid proxy (avg words/sentence)
    keywordDensity: number; // 0-5: keyword appears 1-3% of word count
    structure: number; // 0-5: has at least 3 sections (## headings or blank-line paragraphs)
    length: number; // 0-5: 800-2000 words = 5; 500-799 or 2001-3000 = 3; outside = 1
    originality: number; // 0-5: heuristic — not all sentences < 10 words (proxy for thin content)
  };
  flags: string[]; // human-readable issues
  readTimeMinutes: number; // Math.ceil(wordCount / 200)
}

// ── Breakdown types ────────────────────────────────────────────────────────────

export interface DimensionScore {
  name: string;
  score: number;
  maxScore: number;
  percentage: number; // score / maxScore * 100
  rationale: string;  // why this score was given
  tip: string;        // what to do to improve (empty string when at max)
}

export interface ContentScoreBreakdown {
  totalScore: number;                           // 0-100 composite
  grade: "A" | "B" | "C" | "D" | "F";         // A≥80, B≥65, C≥50, D≥35, F<35
  dimensions: DimensionScore[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countKeyword(text: string, keyword: string): number {
  if (!keyword.trim()) return 0;
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.toLowerCase().match(new RegExp(escaped, "g"));
  return matches ? matches.length : 0;
}

// ── Scoring layers ────────────────────────────────────────────────────────────

function scoreReadability(
  body: string,
  flags: string[]
): number {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return 1;

  const totalWords = countWords(body);
  const avgWordsPerSentence = totalWords / sentences.length;
  const n = Math.round(avgWordsPerSentence);

  if (avgWordsPerSentence > 22) {
    flags.push(
      `Average sentence length is ${n} words — aim for ≤18`
    );
  }

  if (avgWordsPerSentence <= 15) return 5;
  if (avgWordsPerSentence <= 18) return 4;
  if (avgWordsPerSentence <= 22) return 3;
  if (avgWordsPerSentence <= 26) return 2;
  return 1;
}

function scoreKeywordDensity(
  body: string,
  keyword: string,
  wordCount: number,
  flags: string[]
): number {
  if (!keyword.trim() || wordCount === 0) return 1;

  const count = countKeyword(body, keyword);
  const density = (count / wordCount) * 100;

  if (density < 0.5) {
    flags.push(
      `Keyword '${keyword}' appears only ${count} time${count !== 1 ? "s" : ""} — add more`
    );
    return 1;
  }
  if (density > 4) {
    flags.push(`Keyword stuffing risk: ${density.toFixed(1)}% density`);
    return 1;
  }
  if (density >= 1.0 && density <= 3.0) return 5;
  // 0.5–0.99% or 3.01–4%
  return 3;
}

function scoreStructure(body: string, flags: string[]): number {
  const headingMatches = body.match(/^#{2,3} .+$/gm);
  const headingCount = headingMatches ? headingMatches.length : 0;

  // Count blank-line paragraph breaks as fallback
  const paragraphCount = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

  if (headingCount === 0) {
    flags.push("No H2 headings found — add section headers for scannability");
  }

  if (headingCount >= 3) return 5;
  if (headingCount === 2) return 4;
  if (headingCount === 1) return 3;
  if (paragraphCount >= 3) return 2;
  return 1;
}

function scoreLength(body: string, wordCount: number, flags: string[]): number {
  if (wordCount < 800) {
    flags.push(
      `Article is ${wordCount} words — aim for 800+ for SEO depth`
    );
  } else if (wordCount > 3000) {
    flags.push(
      `Article is ${wordCount} words — consider splitting into a series`
    );
  }

  if (wordCount >= 800 && wordCount <= 2000) return 5;
  if ((wordCount >= 600 && wordCount <= 799) || (wordCount >= 2001 && wordCount <= 2500)) return 4;
  if ((wordCount >= 400 && wordCount <= 599) || (wordCount >= 2501 && wordCount <= 3000)) return 3;
  if ((wordCount >= 200 && wordCount <= 399) || (wordCount >= 3001 && wordCount <= 4000)) return 2;
  return 1;
}

function scoreOriginality(body: string, flags: string[]): number {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return 1;

  const shortSentences = sentences.filter(
    (s) => countWords(s) <= 8
  ).length;
  const shortRatio = shortSentences / sentences.length;

  if (shortRatio > 0.6) {
    flags.push("Content appears thin — expand key points");
    return 1;
  }
  if (shortRatio >= 0.4) return 3;
  return 5;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function scoreContent(
  body: string,
  keyword: string
): ContentScoreResult {
  const flags: string[] = [];
  const wordCount = countWords(body);

  const readability = scoreReadability(body, flags);
  const keywordDensity = scoreKeywordDensity(body, keyword, wordCount, flags);
  const structure = scoreStructure(body, flags);
  const length = scoreLength(body, wordCount, flags);
  const originality = scoreOriginality(body, flags);

  const total = readability + keywordDensity + structure + length + originality;

  let verdict: ContentScoreResult["verdict"];
  if (total >= 16) verdict = "PUBLISH";
  else if (total >= 10) verdict = "REVIEW";
  else verdict = "REWRITE";

  const readTimeMinutes = Math.ceil(wordCount / 200);

  return {
    total,
    verdict,
    components: {
      readability,
      keywordDensity,
      structure,
      length,
      originality,
    },
    flags,
    readTimeMinutes,
  };
}

// ── Breakdown helpers ─────────────────────────────────────────────────────────

function readabilityRationale(body: string): string {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return "No sentences detected.";
  const avg = countWords(body) / sentences.length;
  return `Average sentence length: ${Math.round(avg)} words`;
}

function readabilityTip(score: number): string {
  if (score >= 5) return "";
  if (score >= 4) return "Slightly long sentences — aim for ≤18 words each.";
  if (score >= 3) return "Sentences average 18-22 words — break a few up.";
  return "Long sentences hurt readability — aim for ≤15 words on average.";
}

function keywordRationale(body: string, keyword: string, wordCount: number): string {
  if (!keyword.trim()) return "No keyword provided.";
  if (wordCount === 0) return "No content to analyze.";
  const count = countKeyword(body, keyword);
  const density = wordCount > 0 ? (count / wordCount) * 100 : 0;
  return `"${keyword}" appears ${count} time${count !== 1 ? "s" : ""} (${density.toFixed(1)}% density)`;
}

function keywordTip(body: string, keyword: string, wordCount: number, score: number): string {
  if (score >= 5) return "";
  if (!keyword.trim()) return "Add a target keyword in your content brief.";
  if (wordCount === 0) return "Add content to analyze keyword density.";
  const count = countKeyword(body, keyword);
  const density = wordCount > 0 ? (count / wordCount) * 100 : 0;
  if (density < 0.5) return `Use "${keyword}" more — try the opening paragraph, a heading, and the conclusion.`;
  if (density > 4) return "Keyword appears too often — rephrase some instances with synonyms.";
  return `Add "${keyword}" to the opening paragraph or a heading.`;
}

function structureRationale(body: string): string {
  const headingMatches = body.match(/^#{2,3} .+$/gm);
  const count = headingMatches ? headingMatches.length : 0;
  return count > 0
    ? `${count} H2/H3 heading${count !== 1 ? "s" : ""} found`
    : "No H2 headings found";
}

function structureTip(score: number): string {
  if (score >= 5) return "";
  if (score >= 4) return "Add a third ## heading to fully anchor the structure.";
  if (score >= 3) return "Add at least two ## headings to break up your content.";
  if (score >= 2) return "Add ## headings — readers scan before reading.";
  return "No headings found. Add at least 3 ## section headers for scannability.";
}

function lengthRationale(wordCount: number): string {
  return `${wordCount} words`;
}

function lengthTip(wordCount: number, score: number): string {
  if (score >= 5) return "";
  if (wordCount < 400) return "Very short — expand to 800+ words for meaningful SEO depth.";
  if (wordCount < 800) return "Aim for 800+ words to compete for most keywords.";
  if (wordCount > 3000) return "Consider splitting into a series or removing filler.";
  return "Aim for 800-2000 words for the best balance of depth and readability.";
}

function originalityRationale(body: string): string {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return "No sentences detected.";
  const short = sentences.filter((s) => countWords(s) <= 8).length;
  const ratio = Math.round((short / sentences.length) * 100);
  return `${ratio}% of sentences are ≤8 words (thin-content proxy)`;
}

function originalityTip(score: number): string {
  if (score >= 5) return "";
  if (score >= 3) return "Expand a few short bullet points into full explanations with depth and variety.";
  return "Content appears thin — most sentences are very short. Expand key points with examples, data, or detailed analysis.";
}

// ── Breakdown export ──────────────────────────────────────────────────────────

/**
 * Returns the same 5-dimension content score as scoreContent(), but packaged
 * as per-dimension DimensionScore objects with rationale + improvement tips,
 * plus a 0-100 composite totalScore and A-F letter grade.
 */
export function scoreContentBreakdown(
  body: string,
  keyword: string
): ContentScoreBreakdown {
  const flags: string[] = [];
  const wordCount = countWords(body);

  const readability = scoreReadability(body, flags);
  const keywordDensity = scoreKeywordDensity(body, keyword, wordCount, flags);
  const structure = scoreStructure(body, flags);
  const length = scoreLength(body, wordCount, flags);
  const originality = scoreOriginality(body, flags);

  const rawTotal = readability + keywordDensity + structure + length + originality;
  // Scale 0-25 → 0-100
  const totalScore = Math.round((rawTotal / 25) * 100);

  let grade: ContentScoreBreakdown["grade"];
  if (totalScore >= 80) grade = "A";
  else if (totalScore >= 65) grade = "B";
  else if (totalScore >= 50) grade = "C";
  else if (totalScore >= 35) grade = "D";
  else grade = "F";

  const dimensions: DimensionScore[] = [
    {
      name: "Readability",
      score: readability,
      maxScore: 5,
      percentage: Math.round((readability / 5) * 100),
      rationale: readabilityRationale(body),
      tip: readabilityTip(readability),
    },
    {
      name: "Keyword Density",
      score: keywordDensity,
      maxScore: 5,
      percentage: Math.round((keywordDensity / 5) * 100),
      rationale: keywordRationale(body, keyword, wordCount),
      tip: keywordTip(body, keyword, wordCount, keywordDensity),
    },
    {
      name: "Structure",
      score: structure,
      maxScore: 5,
      percentage: Math.round((structure / 5) * 100),
      rationale: structureRationale(body),
      tip: structureTip(structure),
    },
    {
      name: "Length",
      score: length,
      maxScore: 5,
      percentage: Math.round((length / 5) * 100),
      rationale: lengthRationale(wordCount),
      tip: lengthTip(wordCount, length),
    },
    {
      name: "Content Density",
      score: originality,
      maxScore: 5,
      percentage: Math.round((originality / 5) * 100),
      rationale: originalityRationale(body),
      tip: originalityTip(originality),
    },
  ];

  return { totalScore, grade, dimensions };
}

// ── computeContentQuality — aggregate quality scorer ──────────────────────────

export interface ContentScoreDimension {
  name: string;
  score: number;   // 0-1 (1 = best)
  weight: number;  // relative importance
}

export interface ContentQualityResult {
  overallScore: number;                 // 0-100
  grade: "A" | "B" | "C" | "D";
  dimensions: ContentScoreDimension[];
  weakest: string;                      // readable name of weakest dimension
  tip: string | null;                   // null for A
}

export interface ContentQualityInput {
  passiveVoiceRatio?: number;           // 0-1 (0 = no passive = best)
  transitionDensity?: "HIGH" | "MODERATE" | "LOW";
  sentenceVariety?: "HIGH" | "MODERATE" | "LOW";
  fkGrade?: number;                     // Flesch-Kincaid grade level
  paragraphLengthVerdict?: "WEB_FRIENDLY" | "MIXED" | "DENSE" | "NO_PROSE";
  hasAbstractOpener?: boolean;          // true = bad
  powerWordDensity?: "STRONG" | "MODERATE" | "WEAK";
  subheadingVerdict?: "WELL_STRUCTURED" | "SPARSE" | "DENSE" | "NO_HEADINGS";
  personBalance?: "READER_FOCUSED" | "BALANCED" | "WRITER_FOCUSED";
  statisticDensity?: "DATA_RICH" | "MODERATE" | "VAGUE";
  headingHierarchy?: "VALID" | "WARN" | "INVALID";
  vocabRichness?: "RICH" | "MODERATE" | "REPETITIVE";
  hasDuplicates?: boolean;              // true = bad
}

interface SignalSpec {
  key: keyof ContentQualityInput;
  name: string;  // readable name for weakest / tip
  weight: number;
  score: (v: ContentQualityInput[keyof ContentQualityInput]) => number;
}

const SIGNAL_SPECS: SignalSpec[] = [
  {
    key: "passiveVoiceRatio",
    name: "passive voice",
    weight: 8,
    score: (v) => {
      const r = v as number;
      if (r <= 0.05) return 1.0;
      if (r <= 0.10) return 0.7;
      if (r <= 0.20) return 0.4;
      return 0.1;
    },
  },
  {
    key: "transitionDensity",
    name: "transition words",
    weight: 6,
    score: (v) => ({ HIGH: 1, MODERATE: 0.6, LOW: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "sentenceVariety",
    name: "sentence variety",
    weight: 6,
    score: (v) => ({ HIGH: 1, MODERATE: 0.6, LOW: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "fkGrade",
    name: "reading level",
    weight: 7,
    score: (v) => {
      const g = v as number;
      if (g <= 8) return 1.0;
      if (g <= 12) return 0.7;
      if (g <= 16) return 0.4;
      return 0.1;
    },
  },
  {
    key: "paragraphLengthVerdict",
    name: "paragraph length",
    weight: 6,
    score: (v) => ({ WEB_FRIENDLY: 1, MIXED: 0.6, DENSE: 0.1, NO_PROSE: 0.8 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "hasAbstractOpener",
    name: "opener",
    weight: 5,
    score: (v) => (v === false ? 1 : 0.3),
  },
  {
    key: "powerWordDensity",
    name: "power words",
    weight: 5,
    score: (v) => ({ STRONG: 1, MODERATE: 0.6, WEAK: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "subheadingVerdict",
    name: "subheadings",
    weight: 4,
    score: (v) => ({ WELL_STRUCTURED: 1, SPARSE: 0.6, DENSE: 0.4, NO_HEADINGS: 0.1 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "personBalance",
    name: "reader focus",
    weight: 5,
    score: (v) => ({ READER_FOCUSED: 1, BALANCED: 0.7, WRITER_FOCUSED: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "statisticDensity",
    name: "data/stats",
    weight: 5,
    score: (v) => ({ DATA_RICH: 1, MODERATE: 0.7, VAGUE: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "headingHierarchy",
    name: "heading structure",
    weight: 3,
    score: (v) => ({ VALID: 1, WARN: 0.5, INVALID: 0.1 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "vocabRichness",
    name: "vocabulary",
    weight: 6,
    score: (v) => ({ RICH: 1, MODERATE: 0.6, REPETITIVE: 0.2 } as Record<string, number>)[v as string] ?? 0,
  },
  {
    key: "hasDuplicates",
    name: "no duplicates",
    weight: 4,
    score: (v) => (v === false ? 1 : 0.2),
  },
];

function gradeFromScore(score: number): ContentQualityResult["grade"] {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function tipForGrade(
  grade: ContentQualityResult["grade"],
  weakestName: string,
): string | null {
  if (grade === "A") return null;
  if (grade === "B") return `Strong content — focus on ${weakestName} to reach an A`;
  if (grade === "C") return `Room to improve — ${weakestName} is the biggest opportunity`;
  return `Content needs significant work — start with ${weakestName}`;
}

export function computeContentQuality(
  input: ContentQualityInput,
): ContentQualityResult {
  const dimensions: ContentScoreDimension[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const spec of SIGNAL_SPECS) {
    const rawValue = input[spec.key];
    if (rawValue === undefined) continue;

    const s = spec.score(rawValue);
    dimensions.push({ name: spec.name, score: s, weight: spec.weight });
    weightedSum += s * spec.weight;
    totalWeight += spec.weight;
  }

  // Empty input case
  if (totalWeight === 0) {
    return {
      overallScore: 50,
      grade: "C",
      dimensions: [],
      weakest: "",
      tip: null,
    };
  }

  const overallScore = Math.round((weightedSum / totalWeight) * 100);
  const grade = gradeFromScore(overallScore);

  // Weakest = dimension with lowest (score × weight) contribution
  const weakestDim = [...dimensions].sort(
    (a, b) => a.score * a.weight - b.score * b.weight,
  )[0];

  const weakest = weakestDim?.name ?? "";
  const tip = tipForGrade(grade, weakest);

  return { overallScore, grade, dimensions, weakest, tip };
}
