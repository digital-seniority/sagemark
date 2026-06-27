/**
 * geo-citation — GEO (Generative Engine Optimization) signal scorer (no LLM, no credits).
 *
 * Surfaces the on-page signals that make content easier for AI answer engines to
 * quote: quotable facts, definitions, direct answers, structured data,
 * self-contained FAQs, and source attribution.
 *
 * IMPORTANT: this scorer measures only countable on-page signals. It never
 * promises a citation *outcome* — being cited by an AI model depends on factors
 * outside any single page. The returned object exposes only deterministic checks.
 *
 * Ported from an internal GEO eval scorer and de-branded: the original
 * proprietary-data patterns (a brand-name regex plus `/our (data|directory|platform)/i`)
 * are replaced with a generic attributed-source signal, and the upstream
 * `ContentEvalInput` import is replaced with the local `ContentDraft`-derived
 * `body` / `slug` / `faqData` arguments. Pure function — mirror of
 * content-score.ts (no network, no LLM).
 */

/** A single FAQ entry, matching the shape carried alongside a ContentDraft. */
export interface GeoFaqItem {
  question: string;
  answer: string;
}

/** Result of a single on-page GEO check. */
export interface GeoCheckResult {
  name: string;
  passed: boolean;
  /** 0 = pass, negative = fail (penalty applied to the 100-point base). */
  penalty: number;
  /** Human-readable explanation of what was counted. */
  detail: string;
}

/** Aggregate GEO-citation signal result. */
export interface GeoCitationResult {
  /** 0-100 composite of on-page GEO signals (never a citation guarantee). */
  score: number;
  checks: GeoCheckResult[];
  /** Human-readable descriptions of the checks that did not pass. */
  failures: string[];
}

/**
 * Score the GEO-citation *signals* present in a content body.
 *
 * @param body     Markdown content body.
 * @param slug     Post slug (used to derive topic keywords for direct-answer detection).
 * @param faqData  Optional FAQ entries to check for self-containment.
 */
export function scoreGeoCitation(
  body: string,
  slug: string,
  faqData?: GeoFaqItem[] | null,
): GeoCitationResult {
  const checks: GeoCheckResult[] = [];
  const content = body;

  // ── Quotable facts ──────────────────────────────────────────────────────────
  // Self-contained sentences with specific numbers + enough context to stand alone.
  const sentences = content
    .replace(/^#.+$/gm, "") // strip headings
    .replace(/\[cta:[^\]]+\]/g, "") // strip CTAs
    .split(/[.!?]\s+/)
    .filter((s) => s.trim().length > 20);

  const numberPattern = /\b\d[\d,]*\b/;
  const quotableFacts = sentences.filter((s) => {
    const hasNumber = numberPattern.test(s);
    const hasContext = s.split(/\s+/).length >= 8; // at least 8 words for context
    const notTable = !s.includes("|"); // not a table row
    return hasNumber && hasContext && notTable;
  }).length;

  // -6 per missing fact below the target of 5, floored at -30; 0 when at/above target.
  // (NOTE: the upstream formula `(quotableFacts - 5) * -6` produced a *positive*
  // bonus when below target — a sign bug. Corrected here so a shortfall is always
  // a penalty.)
  const quotableShortfall = Math.max(0, 5 - quotableFacts);
  checks.push({
    name: "quotable_facts",
    passed: quotableFacts >= 5,
    penalty: quotableShortfall === 0 ? 0 : Math.max(-30, quotableShortfall * -6),
    detail: `${quotableFacts} quotable fact sentences with numbers (target: 5+)`,
  });

  // ── Definition patterns ─────────────────────────────────────────────────────
  // "X is...", "X refers to...", "X means..."
  const definitionPatterns = [
    /\*\*[^*]+\*\*\s+(is|are|refers? to|means?)\b/gi,
    /^[A-Z][^.]+\s+(is|are)\s+(?:a|an|the)\s+/gm,
  ];
  let definitions = 0;
  for (const pattern of definitionPatterns) {
    definitions += (content.match(pattern) || []).length;
  }
  checks.push({
    name: "definition_patterns",
    passed: definitions >= 2,
    penalty: definitions >= 2 ? 0 : -10,
    detail: `${definitions} definition patterns (target: 2+)`,
  });

  // ── Direct answers ──────────────────────────────────────────────────────────
  // Paragraphs that start with or surface the topic keywords from the slug.
  const slugKeywords = slug.split("-").filter((w) => w.length > 3);
  const paragraphs = content
    .split("\n\n")
    .filter((p) => p.trim().length > 50 && !p.startsWith("#"));
  const directAnswers = paragraphs.filter((p) => {
    const pLower = p.toLowerCase();
    return slugKeywords.some(
      (kw) => pLower.startsWith(kw) || pLower.slice(0, 100).includes(kw),
    );
  }).length;
  checks.push({
    name: "direct_answers",
    passed: directAnswers >= 2,
    penalty: directAnswers >= 2 ? 0 : -5,
    detail: `${directAnswers} direct-answer paragraphs (target: 2+)`,
  });

  // ── Structured data ─────────────────────────────────────────────────────────
  // Comparison/table data is easy for AI to extract.
  const tableRows = (content.match(/\|.+\|.+\|/g) || []).length;
  const hasTables = tableRows >= 3; // header + separator + at least 1 data row
  checks.push({
    name: "structured_data",
    passed: hasTables,
    penalty: hasTables ? 0 : -10,
    detail: `${tableRows} table rows (structured data for AI extraction)`,
  });

  // ── Attributed source ───────────────────────────────────────────────────────
  // Generic replacement for the upstream proprietary-data signal: does the
  // content cite a named/attributed source or original data point? This rewards
  // differentiated, quotable material without hardcoding any brand.
  const attributedSourcePatterns = [
    /(?:according to|based on)\s+(?:a|an|the|our)?\s*[A-Za-z]/i,
    /\b(?:study|survey|report|research|analysis|dataset)\b/i,
    /(?:data|figures|statistics)\s+from\b/i,
    /\bsource:\s/i,
  ];
  const hasAttributedSource = attributedSourcePatterns.some((p) => p.test(content));
  checks.push({
    name: "attributed_source",
    passed: hasAttributedSource,
    penalty: hasAttributedSource ? 0 : -15,
    detail: hasAttributedSource
      ? "Content references an attributed source or original data"
      : "No attributed source or original data (missed differentiation opportunity)",
  });

  // ── FAQ self-contained ──────────────────────────────────────────────────────
  // FAQs that reference the surrounding article cannot be quoted standalone.
  const referencePatterns =
    /\b(as mentioned|above|below|in this article|earlier|as we discussed)\b/i;
  const nonSelfContained = (faqData || []).filter((f) =>
    referencePatterns.test(f.answer),
  ).length;
  checks.push({
    name: "faq_self_contained",
    passed: nonSelfContained === 0,
    penalty: nonSelfContained === 0 ? 0 : nonSelfContained * -5,
    detail:
      nonSelfContained === 0
        ? "All FAQs are self-contained"
        : `${nonSelfContained} FAQ(s) reference the article (not self-contained for AI citation)`,
  });

  // ── Source attribution phrasing ─────────────────────────────────────────────
  const hasAttribution = /(?:according to|based on|data from|source:)\s/i.test(content);
  checks.push({
    name: "source_attribution",
    passed: hasAttribution,
    penalty: hasAttribution ? 0 : -5,
    detail: hasAttribution
      ? "Content includes source attribution"
      : "No explicit source attribution",
  });

  const totalPenalty = checks.reduce((sum, c) => sum + c.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 + totalPenalty));

  return {
    score,
    checks,
    failures: checks.filter((c) => !c.passed).map((c) => c.detail || c.name),
  };
}
