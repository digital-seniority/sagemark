/**
 * broken-chunk-linter — flags sections that are not liftable as a self-contained
 * answer (the "information island" failure for AI-answer-engine extraction).
 *
 * Pure, deterministic, no LLM, no network, no credits. Reuses the H2/H3
 * heading-split convention from content-score.ts (`/^#{2,3} .+$/gm`).
 *
 * A body is split into sections delimited by H2/H3 headings. A section fails if:
 *   1. It is a heading-less orphan block — prose appearing before the first
 *      heading (an island of content with no answerable question above it).
 *   2. It opens with an unresolved back-reference — "As mentioned above…",
 *      "As above", or a leading bare demonstrative ("This"/"These"/"That"/
 *      "Those"/"It") with no antecedent inside the section.
 *   3. It has a heading but an empty body (a dangling heading).
 *
 * Conservative by design: only clear cases are flagged to avoid over-vetoing
 * legitimate prose (the documented risk on this linter).
 */

export interface BrokenChunkResult {
  passed: boolean;
  brokenSections: string[]; // human-readable labels of the offending sections
  failureCode?: "VETO_BROKEN_CHUNK";
}

// ── Heading split (reuses content-score.ts convention) ───────────────────────

const HEADING_LINE = /^#{2,3} .+$/;

interface Section {
  /** Heading text without the leading #'s, or null for a pre-heading orphan. */
  heading: string | null;
  /** Non-heading body lines joined (trimmed). */
  body: string;
}

/**
 * Split a markdown body into H2/H3-delimited sections. Any prose that appears
 * before the first heading becomes a section with `heading: null`.
 */
function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (HEADING_LINE.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^#{2,3} /, "").trim(), body: "" };
    } else {
      if (!current) {
        // Pre-heading content → orphan section (heading: null)
        current = { heading: null, body: "" };
      }
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  // Normalize bodies (trim trailing/leading whitespace per section)
  return sections.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

// ── Detection helpers ────────────────────────────────────────────────────────

/**
 * Leading dangling-reference phrases. These open a section by pointing at
 * content that lives in a *different* section, so the block cannot be lifted
 * standalone. Anchored to the start of the section body.
 */
const DANGLING_OPENERS: RegExp[] = [
  /^as (?:mentioned|noted|discussed|described|stated|shown|explained|seen) (?:above|earlier|previously|before)\b/i,
  /^as above\b/i,
  /^as (?:we|i) (?:mentioned|noted|discussed|saw|said) (?:above|earlier|previously|before)\b/i,
  /^as (?:previously|earlier) (?:mentioned|noted|discussed|stated|described)\b/i,
  /^(?:building|continuing) (?:on|from) (?:the|that|this) (?:above|previous|last)\b/i,
  /^following (?:on )?from (?:the )?(?:above|previous|last)\b/i,
];

/**
 * Leading bare demonstrative pronouns with no antecedent. Only flagged when the
 * pronoun is the very first word AND is immediately followed by a verb/copula
 * (so "This guide explains…" — a self-contained noun phrase — is NOT flagged,
 * but "This is why…" / "These are the…" / "It works by…" — which reach back to a
 * prior section — is).
 */
const BARE_DEMONSTRATIVE =
  /^(?:this|these|those|that|it)\s+(?:is|are|was|were|works|means|happens|matters|explains why|comes from|results)\b/i;

function firstMeaningfulText(sectionBody: string): string {
  // Strip leading markdown list/blockquote markers so we inspect actual prose.
  return sectionBody
    .replace(/^[\s>*\-+]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function opensWithDanglingReference(sectionBody: string): boolean {
  const text = firstMeaningfulText(sectionBody);
  if (!text) return false;
  if (DANGLING_OPENERS.some((re) => re.test(text))) return true;
  if (BARE_DEMONSTRATIVE.test(text)) return true;
  return false;
}

function labelFor(section: Section, index: number): string {
  if (section.heading === null) {
    return `Orphan block (no heading) at position ${index + 1}`;
  }
  return section.heading;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Lint a markdown body for broken / non-liftable chunks.
 *
 * Empty or whitespace-only bodies pass (the gate treats empty content as a
 * separate concern). Never throws.
 */
export function lintBrokenChunks(body: string): BrokenChunkResult {
  if (!body || !body.trim()) {
    return { passed: true, brokenSections: [] };
  }

  const sections = splitSections(body);
  const brokenSections: string[] = [];

  const hasAnyHeading = sections.some((s) => s.heading !== null);

  sections.forEach((section, index) => {
    if (section.heading === null) {
      // A pre-heading orphan block is only a problem when the document is
      // otherwise structured with headings — a fully heading-less doc is a
      // different (length/structure) concern handled elsewhere.
      if (hasAnyHeading && section.body.length > 0) {
        brokenSections.push(labelFor(section, index));
      }
      return;
    }

    // Heading with no body → dangling heading.
    if (section.body.length === 0) {
      brokenSections.push(labelFor(section, index));
      return;
    }

    // Section opens with an unresolved back-reference.
    if (opensWithDanglingReference(section.body)) {
      brokenSections.push(labelFor(section, index));
    }
  });

  if (brokenSections.length === 0) {
    return { passed: true, brokenSections: [] };
  }

  return {
    passed: false,
    brokenSections,
    failureCode: "VETO_BROKEN_CHUNK",
  };
}
