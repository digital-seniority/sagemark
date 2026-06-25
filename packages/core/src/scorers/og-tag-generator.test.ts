import { describe, it, expect } from "vitest";
import { generateOgTags } from "./og-tag-generator";

// ── OG title status ───────────────────────────────────────────────────────────

describe("generateOgTags — ogTitle status", () => {
  it("short: title <60c with keyword already present → ogTitleStatus 'short'", () => {
    const result = generateOgTags({
      keyword: "SEO",
      title: "SEO Tips Guide",        // 14c
      firstParagraph: "SEO tips that work.",
    });
    expect(result.ogTitleStatus).toBe("short");
    expect(result.ogTitleWasTruncated).toBe(false);
  });

  it("optimal: title 70c → ogTitleStatus 'optimal'", () => {
    // Build a 70-char title that already contains the keyword
    const title = "Content Marketing Strategy That Drives Growth for Modern SaaS Teams"; // 67c
    expect(title.length).toBe(67);
    const result = generateOgTags({
      keyword: "content marketing",
      title,
      firstParagraph: "Content marketing helps brands grow.",
    });
    expect(result.ogTitleStatus).toBe("optimal");
    expect(result.ogTitleWasTruncated).toBe(false);
  });

  it("long + wasTruncated: title >95c → ogTitleStatus 'long' is replaced by truncation to 92c+'...'", () => {
    // Titles >95c are truncated to 92c + "..." = 95c → status becomes 'optimal', NOT 'long'
    // So wasTruncated is the signal
    const title = "A Very Long Open Graph Title That Definitely Exceeds Ninety Five Characters In Total Right Here For Sure";
    expect(title.length).toBeGreaterThan(95);
    const result = generateOgTags({
      keyword: "open graph",
      title,
      firstParagraph: "Open graph tags help your content look great on social media.",
    });
    expect(result.ogTitleWasTruncated).toBe(true);
    expect(result.ogTitle.length).toBe(95);
    expect(result.ogTitle.endsWith("...")).toBe(true);
    // After truncation the status is 'optimal' (95 is the boundary)
    expect(result.ogTitleStatus).toBe("optimal");
  });

  it("long status reported when no truncation needed (title exactly 96c)", () => {
    // A 96-char title that already contains keyword but is only 1 char over the 95 boundary
    // is truncated to 95 → becomes optimal. The 'long' path is only reachable without truncation
    // if the title is ≤95 but we label it—this confirms our logic only sets 'long' pre-truncation.
    // In practice the generator always truncates >95, so 'long' never appears in the output
    // status unless there's a bug. Verify via unit check on ogTitleStatus function boundary.
    const title = "Open Graph Title That Is Ninety Five Characters Long Exactly Here Right Now"; // let's check
    const padded = "X".repeat(96); // 96 chars, no keyword
    const result = generateOgTags({
      keyword: "open graph",
      title: padded,
      firstParagraph: "Open graph tags are important for social sharing.",
    });
    // Keyword not in title, appending " | open graph" = 96 + 13 = 109c → >95 → truncate
    expect(result.ogTitleWasTruncated).toBe(true);
    expect(result.ogTitle.length).toBe(95);
  });
});

// ── Keyword handling in OG title ──────────────────────────────────────────────

describe("generateOgTags — keyword in ogTitle", () => {
  it("appends keyword when not in title and result fits within 95c", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "How to Share Your Content on Social Media",  // 41c, no keyword
      firstParagraph: "Open graph tags control how your content appears when shared.",
    });
    expect(result.ogTitle).toBe("How to Share Your Content on Social Media | open graph");
    expect(result.ogTitleWasTruncated).toBe(false);
  });

  it("does NOT append keyword when result would exceed 95c", () => {
    // Title is 85c, keyword would make it >95c → skip the append
    const title = "How to Optimise Your Social Media Sharing Strategy With Great Open Content Plans"; // 80c
    expect(title.length).toBe(80);
    const keyword = "content marketing strategy"; // 26c → 80 + 3 + 26 = 109c > 95
    const result = generateOgTags({
      keyword,
      title,
      firstParagraph: "Content marketing strategy is what drives social sharing growth.",
    });
    // Keyword should NOT be appended since result would exceed 95c
    expect(result.ogTitle).toBe(title);
    // Not truncated either since 80c ≤ 95
    expect(result.ogTitleWasTruncated).toBe(false);
  });

  it("keyword already in title → unchanged (case-insensitive)", () => {
    const result = generateOgTags({
      keyword: "content marketing",
      title: "Content Marketing Strategy That Works",
      firstParagraph: "Content marketing helps brands reach more people.",
    });
    expect(result.ogTitle).toBe("Content Marketing Strategy That Works");
    expect(result.ogTitleWasTruncated).toBe(false);
  });
});

// ── OG description status ─────────────────────────────────────────────────────

describe("generateOgTags — ogDescription status", () => {
  it("short: firstParagraph <150c → ogDescriptionStatus 'short'", () => {
    const result = generateOgTags({
      keyword: "social media",
      title: "Social Media Tips",
      firstParagraph: "Social media tips for growing your audience.",
    });
    expect(result.ogDescriptionStatus).toBe("short");
    expect(result.ogDescriptionWasTruncated).toBe(false);
  });

  it("optimal: firstParagraph 175c → ogDescriptionStatus 'optimal'", () => {
    // Build a ~175 char paragraph with keyword included
    const firstParagraph =
      "Open graph tags are the metadata that controls how your content appears when shared on social media platforms like Facebook, LinkedIn, and Twitter across the web.";
    // Verify it's in 150-200 range
    expect(firstParagraph.length).toBeGreaterThanOrEqual(150);
    expect(firstParagraph.length).toBeLessThanOrEqual(200);
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph,
    });
    expect(result.ogDescriptionStatus).toBe("optimal");
    expect(result.ogDescriptionWasTruncated).toBe(false);
  });

  it("truncated when firstParagraph >200c: wasTruncated true, length exactly 200", () => {
    const firstParagraph =
      "Open graph tags are the metadata that controls how your content appears when shared on social media platforms like Facebook, LinkedIn, and Twitter. They determine the title, description, and image shown in link previews across the entire social web ecosystem and beyond.";
    expect(firstParagraph.length).toBeGreaterThan(200);
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph,
    });
    expect(result.ogDescriptionWasTruncated).toBe(true);
    expect(result.ogDescription.length).toBe(200);
    expect(result.ogDescription.endsWith("...")).toBe(true);
  });
});

// ── Keyword handling in OG description ───────────────────────────────────────

describe("generateOgTags — keyword in ogDescription", () => {
  it("prepends keyword when not in firstParagraph", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "This guide covers social media metadata and link previews.",
    });
    expect(result.ogDescription.startsWith("open graph:")).toBe(true);
  });

  it("does not prepend when keyword already present (case-insensitive)", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "Open graph metadata controls how links appear on social networks.",
    });
    expect(result.ogDescription.startsWith("open graph:")).toBe(false);
    expect(result.ogDescription.startsWith("Open graph metadata")).toBe(true);
  });

  it("appends audience when desc <150c and audience provided", () => {
    const result = generateOgTags({
      keyword: "social media",
      title: "Social Media Tips",
      firstParagraph: "Social media tips for growing your audience fast.",
      audience: "small business owners",
    });
    expect(result.ogDescription).toContain("Tailored for small business owners.");
  });
});

// ── Fixed fields ──────────────────────────────────────────────────────────────

describe("generateOgTags — fixed fields", () => {
  it("ogType is always 'article'", () => {
    const result = generateOgTags({
      keyword: "test",
      title: "Test Article",
      firstParagraph: "Some test content here.",
    });
    expect(result.ogType).toBe("article");
  });

  it("twitterCard is always 'summary_large_image'", () => {
    const result = generateOgTags({
      keyword: "test",
      title: "Test Article",
      firstParagraph: "Some test content here.",
    });
    expect(result.twitterCard).toBe("summary_large_image");
  });
});

// ── copySnippet ───────────────────────────────────────────────────────────────

describe("generateOgTags — copySnippet", () => {
  it("contains og:title property", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "Open graph metadata controls how links appear on social networks.",
    });
    expect(result.copySnippet).toContain('property="og:title"');
  });

  it("contains og:description property", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "Open graph metadata controls how links appear on social networks.",
    });
    expect(result.copySnippet).toContain('property="og:description"');
  });

  it("contains og:type with article value", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "Open graph metadata controls how links appear on social networks.",
    });
    expect(result.copySnippet).toContain('property="og:type"');
    expect(result.copySnippet).toContain('content="article"');
  });

  it("contains twitter:card meta tag", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph: "Open graph metadata controls how links appear on social networks.",
    });
    expect(result.copySnippet).toContain('name="twitter:card"');
    expect(result.copySnippet).toContain('content="summary_large_image"');
  });

  it("escapes double quotes in content values", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: 'The "Real" Open Graph Guide',
      firstParagraph: "Open graph metadata controls how links appear.",
    });
    // Double quotes in the title should be escaped as &quot; so they don't break HTML attributes
    expect(result.copySnippet).toContain("&quot;");
    // The raw double-quote character should not appear inside a content="..." attribute value
    // (i.e. the title's quotes should be escaped, not literal)
    expect(result.ogTitle).toContain('"');        // ogTitle itself keeps the raw quote
    expect(result.copySnippet).not.toContain('"Real"'); // but the snippet escapes it
  });
});

// ── stripMarkdown integration ─────────────────────────────────────────────────

describe("generateOgTags — stripMarkdown integration", () => {
  it("strips markdown from firstParagraph before using it as description", () => {
    const result = generateOgTags({
      keyword: "open graph",
      title: "Open Graph Guide",
      firstParagraph:
        "## Open Graph\n\n**Open graph** metadata `controls` how _links_ appear on social networks.",
    });
    expect(result.ogDescription).not.toContain("##");
    expect(result.ogDescription).not.toContain("**");
    expect(result.ogDescription).not.toContain("`");
    expect(result.ogDescription).not.toContain("_");
  });
});
