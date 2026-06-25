/**
 * og-tag-generator — pure heuristic Open Graph / Twitter Card tag generator (no LLM, no credits).
 *
 * Generates og:title, og:description, og:type, and twitter:card from keyword, title,
 * and first paragraph. Uses wider character thresholds than SEO meta tags since social
 * sharing previews have no SERP truncation constraint.
 *
 * og:title   — optimal 60-95 chars (wider than SEO title's 60c SERP limit)
 * og:description — optimal 150-200 chars (wider than meta description's 160c SERP limit)
 */

import { stripMarkdown } from "./meta-tag-generator";

export interface OgTagResult {
  ogTitle: string;
  ogTitleLength: number;
  /** optimal: 60-95 chars, short: <60, long: >95 */
  ogTitleStatus: "optimal" | "short" | "long";
  ogDescription: string;
  ogDescriptionLength: number;
  /** optimal: 150-200 chars, short: <150, long: >200 */
  ogDescriptionStatus: "optimal" | "short" | "long";
  ogType: "article";
  twitterCard: "summary_large_image";
  ogTitleWasTruncated: boolean;
  ogDescriptionWasTruncated: boolean;
  /** Formatted HTML snippet ready to paste into a CMS <head> block */
  copySnippet: string;
}

// ── Status helpers ────────────────────────────────────────────────────────────

function ogTitleStatus(len: number): OgTagResult["ogTitleStatus"] {
  if (len < 60) return "short";
  if (len > 95) return "long";
  return "optimal";
}

function ogDescriptionStatus(len: number): OgTagResult["ogDescriptionStatus"] {
  if (len < 150) return "short";
  if (len > 200) return "long";
  return "optimal";
}

// ── HTML attribute escaping ───────────────────────────────────────────────────

/** Escape double quotes so the value is safe inside an HTML attribute. */
function escAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

// ── OG title generation ───────────────────────────────────────────────────────

/**
 * Generate an Open Graph title from the article title and keyword.
 *
 * Logic:
 * 1. Start with full title (no modification — OG title can be longer than SEO title).
 * 2. If keyword not in title (case-insensitive) and appending ` | ${keyword}` keeps it ≤95c: append it.
 * 3. If still >95c: truncate to 92c + "...".
 * 4. Track wasTruncated.
 */
function buildOgTitle(
  keyword: string,
  title: string,
): { tag: string; wasTruncated: boolean } {
  const kwLower = keyword.toLowerCase();
  let tag = title;
  let wasTruncated = false;

  // Step 2: inject keyword if missing and the result stays within 95c
  if (!tag.toLowerCase().includes(kwLower)) {
    const withKeyword = `${tag} | ${keyword}`;
    if (withKeyword.length <= 95) {
      tag = withKeyword;
    }
  }

  // Step 3: truncate if still too long
  if (tag.length > 95) {
    tag = tag.slice(0, 92) + "...";
    wasTruncated = true;
  }

  return { tag, wasTruncated };
}

// ── OG description generation ─────────────────────────────────────────────────

/**
 * Generate an Open Graph description from the first paragraph, keyword, and optional audience.
 *
 * Logic:
 * 1. Strip markdown from first paragraph.
 * 2. If keyword not in description (case-insensitive): prepend `${keyword}: `.
 * 3. If audience provided and total length <150c: append ` Tailored for ${audience}.`
 * 4. Truncate to 197c + "..." if >200c.
 * 5. Track wasTruncated.
 */
function buildOgDescription(
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

  // Step 3: append audience when short
  if (audience && desc.length < 150) {
    desc = `${desc} Tailored for ${audience}.`;
  }

  // Step 4: truncate if too long
  if (desc.length > 200) {
    desc = desc.slice(0, 197) + "...";
    wasTruncated = true;
  }

  return { tag: desc, wasTruncated };
}

// ── Copy snippet builder ──────────────────────────────────────────────────────

function buildCopySnippet(ogTitle: string, ogDescription: string): string {
  return [
    `<meta property="og:title" content="${escAttr(ogTitle)}" />`,
    `<meta property="og:description" content="${escAttr(ogDescription)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<!-- <meta name="twitter:image" content="YOUR_IMAGE_URL"> -->`,
  ].join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateOgTags(params: {
  keyword: string;
  title: string;
  /** First ~200 chars of the draft body (may contain markdown) */
  firstParagraph: string;
  audience?: string;
}): OgTagResult {
  const { keyword, title, firstParagraph, audience } = params;

  const { tag: ogTitle, wasTruncated: ogTitleWasTruncated } = buildOgTitle(
    keyword,
    title,
  );
  const { tag: ogDescription, wasTruncated: ogDescriptionWasTruncated } =
    buildOgDescription(keyword, firstParagraph, audience);

  const ogTitleLength = ogTitle.length;
  const ogDescriptionLength = ogDescription.length;

  const copySnippet = buildCopySnippet(ogTitle, ogDescription);

  return {
    ogTitle,
    ogTitleLength,
    ogTitleStatus: ogTitleStatus(ogTitleLength),
    ogDescription,
    ogDescriptionLength,
    ogDescriptionStatus: ogDescriptionStatus(ogDescriptionLength),
    ogType: "article",
    twitterCard: "summary_large_image",
    ogTitleWasTruncated,
    ogDescriptionWasTruncated,
    copySnippet,
  };
}
