/**
 * meta-tag-generator — pure heuristic SEO meta tag generator (no LLM, no credits).
 *
 * Generates an SEO title tag and meta description from keyword, title, and first
 * paragraph. Analyses keyword coverage and character-count status using standard
 * SERP thresholds (title: 50-60 chars, description: 150-160 chars).
 */

export interface MetaTagResult {
  titleTag: string;
  titleTagLength: number;
  /** optimal: 50-60 chars, short: <50, long: >60 */
  titleTagStatus: "optimal" | "short" | "long";
  /** true if the title was truncated to fit the 60-char SERP limit */
  titleWasTruncated: boolean;
  metaDescription: string;
  metaDescriptionLength: number;
  /** optimal: 150-160 chars, short: <150, long: >160 */
  metaDescriptionStatus: "optimal" | "short" | "long";
  /** true if the description was truncated to fit the 160-char SERP limit */
  descriptionWasTruncated: boolean;
  keywordInTitle: boolean;
  keywordInDescription: boolean;
  /** 1-3 actionable tips when not optimal */
  suggestions: string[];
}

// ── Markdown stripper ─────────────────────────────────────────────────────────

/**
 * Strip common markdown syntax from a string.
 * Removes: headings (#), bold/italic (* / _), inline code (backtick-delimited),
 * and any remaining bare marker characters.
 */
export function stripMarkdown(text: string): string {
  // Inline code: backtick-delimited spans
  const BACKTICK_CODE = /`([^`]*)`/g;
  // Bare remaining backtick characters
  const BARE_BACKTICK = /`/g;
  return text
    // Images: ![alt](url) → remove entirely (no useful text for meta)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links: [text](url) → keep link text only
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Headings: # Title
    .replace(/^#{1,6}\s+/gm, "")
    // Bold + italic: ***text*** or ___text___
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Inline code
    .replace(BACKTICK_CODE, "$1")
    // Any remaining bare # * _ backtick characters
    .replace(/[#*_]/g, "")
    .replace(BARE_BACKTICK, "")
    // Collapse extra whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ── Status helpers ────────────────────────────────────────────────────────────

function titleStatus(len: number): MetaTagResult["titleTagStatus"] {
  if (len < 50) return "short";
  if (len > 60) return "long";
  return "optimal";
}

function descriptionStatus(len: number): MetaTagResult["metaDescriptionStatus"] {
  if (len < 150) return "short";
  if (len > 160) return "long";
  return "optimal";
}

// ── Title tag generation ──────────────────────────────────────────────────────

/**
 * Generate an SEO title tag from the article title, keyword, and optional audience.
 *
 * Logic:
 * 1. Start with the article title.
 * 2. If keyword not in title (case-insensitive), append ` | ${keyword}`.
 * 3. If still >60 chars, truncate to 57 chars + "...".
 * 4. If <50 chars and audience provided, try appending ` for ${audience}`;
 *    truncate to 57+"..." if the result exceeds 60 chars.
 *
 * Returns a tuple of the final tag and whether truncation occurred at any step.
 */
function buildTitleTag(
  keyword: string,
  title: string,
  audience?: string,
): { tag: string; wasTruncated: boolean } {
  const kwLower = keyword.toLowerCase();
  let tag = title;
  let wasTruncated = false;

  // Step 2: inject keyword if missing
  if (!tag.toLowerCase().includes(kwLower)) {
    tag = `${tag} | ${keyword}`;
  }

  // Step 3: truncate if too long
  if (tag.length > 60) {
    tag = tag.slice(0, 57) + "...";
    wasTruncated = true;
  }

  // Step 4: try to expand short titles with audience context
  if (tag.length < 50 && audience) {
    const expanded = `${tag} for ${audience}`;
    if (expanded.length > 60) {
      tag = expanded.slice(0, 57) + "...";
      wasTruncated = true;
    } else {
      tag = expanded;
    }
  }

  return { tag, wasTruncated };
}

// ── Meta description generation ───────────────────────────────────────────────

/**
 * Generate a meta description from the first paragraph, keyword, and optional audience.
 *
 * Logic:
 * 1. Strip markdown from first paragraph.
 * 2. If keyword not in description (case-insensitive), prepend `${keyword}: `.
 * 3. If >160 chars, truncate to 157 chars + "...".
 * 4. If <150 chars and audience provided, append ` Tailored for ${audience}.`;
 *    truncate to 157+"..." if the result exceeds 160 chars.
 *
 * Returns a tuple of the final description and whether truncation occurred at any step.
 */
function buildMetaDescription(
  keyword: string,
  firstParagraph: string,
  audience?: string,
): { tag: string; wasTruncated: boolean } {
  const kwLower = keyword.toLowerCase();
  let wasTruncated = false;

  // Start from clean first-paragraph text, or keyword as seed when empty
  let desc = firstParagraph.trim() ? stripMarkdown(firstParagraph) : keyword;

  // Step 2: inject keyword if missing
  if (!desc.toLowerCase().includes(kwLower)) {
    desc = `${keyword}: ${desc}`;
  }

  // Step 3: truncate if too long
  if (desc.length > 160) {
    desc = desc.slice(0, 157) + "...";
    wasTruncated = true;
  }

  // Step 4: try to expand short descriptions with audience context
  if (desc.length < 150 && audience) {
    const expanded = `${desc} Tailored for ${audience}.`;
    if (expanded.length > 160) {
      desc = expanded.slice(0, 157) + "...";
      wasTruncated = true;
    } else {
      desc = expanded;
    }
  }

  return { tag: desc, wasTruncated };
}

// ── Suggestion builder ────────────────────────────────────────────────────────

function buildSuggestions(
  keyword: string,
  titleTagStatus: MetaTagResult["titleTagStatus"],
  metaDescriptionStatus: MetaTagResult["metaDescriptionStatus"],
  keywordInTitle: boolean,
  keywordInDescription: boolean,
): string[] {
  const tips: string[] = [];

  // Note: 'long' branches are intentionally absent — generateMetaTags auto-truncates
  // both title and description before calling this function, so neither can be 'long'
  // at this point. The branches are removed to avoid dead code confusion.

  if (titleTagStatus === "short") {
    tips.push("Expand your title to at least 50 characters to use the full SERP space");
  }
  if (!keywordInTitle) {
    tips.push(`Include your target keyword '${keyword}' in the title tag`);
  }
  if (metaDescriptionStatus === "short") {
    tips.push("Expand meta description to 150-160 characters for best CTR");
  }
  if (!keywordInDescription) {
    tips.push(`Include your target keyword '${keyword}' in the meta description`);
  }

  // Cap at 3 most important
  return tips.slice(0, 3);
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateMetaTags(params: {
  keyword: string;
  title: string;
  /** First ~200 chars of the draft body (may contain markdown) */
  firstParagraph: string;
  audience?: string;
}): MetaTagResult {
  const { keyword, title, firstParagraph, audience } = params;

  // Flag is computed at the exact truncation site inside each builder
  const { tag: titleTag, wasTruncated: titleWasTruncated } = buildTitleTag(
    keyword,
    title,
    audience,
  );
  const { tag: metaDescription, wasTruncated: descriptionWasTruncated } =
    buildMetaDescription(keyword, firstParagraph, audience);

  const titleTagLength = titleTag.length;
  const metaDescriptionLength = metaDescription.length;

  const kwLower = keyword.toLowerCase();
  const keywordInTitle = titleTag.toLowerCase().includes(kwLower);
  const keywordInDescription = metaDescription.toLowerCase().includes(kwLower);

  const ttStatus = titleStatus(titleTagLength);
  const mdStatus = descriptionStatus(metaDescriptionLength);

  const suggestions = buildSuggestions(
    keyword,
    ttStatus,
    mdStatus,
    keywordInTitle,
    keywordInDescription,
  );

  return {
    titleTag,
    titleTagLength,
    titleTagStatus: ttStatus,
    titleWasTruncated,
    metaDescription,
    metaDescriptionLength,
    metaDescriptionStatus: mdStatus,
    descriptionWasTruncated,
    keywordInTitle,
    keywordInDescription,
    suggestions,
  };
}
