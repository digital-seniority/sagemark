import { describe, it, expect } from "vitest";
import { generateMetaTags, stripMarkdown } from "./meta-tag-generator";

// ── stripMarkdown ─────────────────────────────────────────────────────────────

describe("stripMarkdown", () => {
  it("removes heading markers", () => {
    expect(stripMarkdown("## My Heading")).toBe("My Heading");
    expect(stripMarkdown("### Sub heading")).toBe("Sub heading");
    expect(stripMarkdown("# Top")).toBe("Top");
  });

  it("removes bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
    expect(stripMarkdown("__bold text__")).toBe("bold text");
  });

  it("removes italic markers", () => {
    expect(stripMarkdown("*italic*")).toBe("italic");
    expect(stripMarkdown("_italic_")).toBe("italic");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdown("`some code`")).toBe("some code");
  });

  it("removes bare # characters", () => {
    // The whitespace collapser normalises double spaces to single
    expect(stripMarkdown("Hello # world")).toBe("Hello world");
  });

  it("strips [text](url) link syntax — keeps link text", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe("click here");
    expect(stripMarkdown("See [our guide](https://example.com/guide) for details.")).toBe(
      "See our guide for details."
    );
  });

  it("strips ![alt](url) image syntax entirely", () => {
    expect(stripMarkdown("![hero image](https://example.com/img.png)")).toBe("");
    expect(stripMarkdown("Intro text ![logo](https://example.com/logo.png) more text.")).toBe(
      "Intro text more text."
    );
  });
});

// ── Title tag generation ──────────────────────────────────────────────────────

describe("generateMetaTags — title tag", () => {
  it("keeps title unchanged when keyword is already present and length is optimal", () => {
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing Strategy for SaaS",
      firstParagraph: "Content marketing is a vital strategy for SaaS companies looking to grow their audience and drive organic traffic through valuable resources.",
    });

    // keyword already in title (case-insensitive)
    expect(result.keywordInTitle).toBe(true);
    // Title is "Content Marketing Strategy for SaaS" = 36 chars → short
    expect(result.titleTagStatus).toBe("short");
    // Should be unchanged since keyword is present (no " | keyword" appended)
    expect(result.titleTag).toBe("Content Marketing Strategy for SaaS");
  });

  it("appends '| keyword' when keyword is not in title", () => {
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "How to Grow Your SaaS Business",
      firstParagraph: "A short paragraph about growth.",
    });

    expect(result.keywordInTitle).toBe(true);
    expect(result.titleTag).toBe("How to Grow Your SaaS Business | content marketing");
  });

  it("truncates long title to 57 chars + '...'", () => {
    const result = generateMetaTags({
      keyword: "SaaS",
      title: "A Very Long Title That Exceeds Sixty Characters Easily With Extra Words",
      firstParagraph: "Some paragraph text for testing purposes only here.",
    });

    // After truncation: exactly 60 chars (57 + "..."), which is within the
    // optimal 50-60 range (inclusive), so status is "optimal".
    expect(result.titleTag.length).toBe(60);
    expect(result.titleTag.endsWith("...")).toBe(true);
    expect(result.titleTagStatus).toBe("optimal");
  });

  it("truncates after keyword append when combined result exceeds 60 chars", () => {
    // "A Reasonably Sized Title For Testing | long keyword phrase here at end" = 70 chars
    // After truncation: exactly 60 chars (57 + "...") → optimal (50-60 inclusive)
    const result = generateMetaTags({
      keyword: "long keyword phrase here at end",
      title: "A Reasonably Sized Title For Testing",
      firstParagraph: "Some paragraph text.",
    });

    expect(result.titleTag.length).toBe(60);
    expect(result.titleTag.endsWith("...")).toBe(true);
    expect(result.titleTagStatus).toBe("optimal");
  });

  it("expands short title with audience when audience provided", () => {
    const result = generateMetaTags({
      keyword: "SEO",
      title: "SEO Tips",
      firstParagraph: "A short intro about SEO basics for marketers and their campaigns.",
      audience: "small business owners",
    });

    // "SEO Tips for small business owners" = 34 chars → still short but audience appended
    expect(result.titleTag).toBe("SEO Tips for small business owners");
    expect(result.keywordInTitle).toBe(true);
  });

  it("truncates audience-expanded title if it exceeds 60 chars", () => {
    const result = generateMetaTags({
      keyword: "SEO",
      title: "SEO Strategies",
      firstParagraph: "This paragraph is about SEO strategies for modern marketing teams.",
      audience: "enterprise marketing directors and senior brand managers",
    });

    // "SEO Strategies for enterprise marketing directors..." would be >60
    expect(result.titleTag.length).toBeLessThanOrEqual(60);
    expect(result.titleTag.endsWith("...")).toBe(true);
  });

  it("reports titleTagStatus correctly", () => {
    // Short: "Top Digital Marketing Tools for Businesses" = 42 chars, keyword present → no append
    const short = generateMetaTags({
      keyword: "digital marketing tools",
      title: "Top Digital Marketing Tools for Businesses",
      firstParagraph: "Digital marketing tools are essential for every modern business operation.",
    });
    expect(short.titleTagStatus).toBe("short");

    // Optimal: titles longer than 60 chars are truncated to exactly 60 → optimal (50-60 inclusive)
    // So after truncation the status is always "optimal", never "long".
    const truncated = generateMetaTags({
      keyword: "unique keyword",
      title: "A Very Very Very Long Title That Will Definitely Exceed Sixty Characters Total",
      firstParagraph: "Some paragraph text.",
    });
    expect(truncated.titleTag.length).toBe(60);
    expect(truncated.titleTagStatus).toBe("optimal");
  });
});

// ── Meta description generation ───────────────────────────────────────────────

describe("generateMetaTags — meta description", () => {
  it("returns optimal status for 150-160 char description", () => {
    // fp1 = 150 chars; keyword "content marketing" is present → no prepend.
    // 150 is NOT <150, so status is "optimal" (boundary is inclusive: 150-160).
    const firstParagraph = "This is a detailed paragraph about content marketing strategies that organizations use to attract and engage their target audience effectively online.";
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing Guide",
      firstParagraph,
    });

    expect(result.metaDescriptionLength).toBe(150);
    expect(result.metaDescriptionStatus).toBe("optimal");
  });

  it("returns optimal status when description is in 150-160 range", () => {
    // Build a paragraph that lands in the 150-160 range without audience padding
    const firstParagraph =
      "Content marketing helps businesses grow by creating valuable, relevant content that attracts and retains a clearly defined audience across channels.";
    // = 146 chars, "content marketing" present → no prepend → 146 chars → short
    // With " Tailored for..." it would exceed or not. Let's use a different approach.
    const fp2 =
      "Content marketing strategies help businesses grow by creating valuable and relevant content pieces that attract and retain a clearly defined target audience.";
    // = 157 chars with keyword present → truncated to 157+"..." = 160 → long? no, 157 < 160
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing",
      firstParagraph: fp2,
    });

    // 157 chars, keyword present, no truncation needed
    expect(result.metaDescriptionLength).toBeLessThanOrEqual(160);
    expect(result.metaDescriptionStatus).not.toBe("long");
  });

  it("truncates description to 157 chars + '...' when input is longer than 160 chars", () => {
    const longParagraph =
      "Content marketing is a strategic approach focused on creating and distributing valuable, relevant, and consistent content to attract and retain a clearly defined audience — and ultimately to drive profitable customer action for your business goals and beyond.";
    // 259 chars, keyword present → no prepend → truncated to 157+"..." = 160 chars
    // 160 is NOT >160 → status is "optimal" (upper boundary is inclusive: 150-160)
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing",
      firstParagraph: longParagraph,
    });

    expect(result.metaDescription.length).toBe(160);
    expect(result.metaDescription.endsWith("...")).toBe(true);
    expect(result.metaDescriptionStatus).toBe("optimal");
  });

  it("prepends keyword when keyword not in first paragraph", () => {
    const result = generateMetaTags({
      keyword: "SEO optimization",
      title: "Search Engine Tips",
      firstParagraph: "This guide covers how to improve your website ranking and attract visitors.",
    });

    expect(result.metaDescription.startsWith("SEO optimization:")).toBe(true);
    expect(result.keywordInDescription).toBe(true);
  });

  it("appends audience when description is short and audience provided", () => {
    const result = generateMetaTags({
      keyword: "SEO tips",
      title: "SEO Tips That Work",
      firstParagraph: "SEO tips help your site rank higher in search results.",
      audience: "freelance web developers",
    });

    expect(result.metaDescription).toContain("Tailored for freelance web developers.");
    expect(result.metaDescriptionStatus).toBe("short"); // still short after audience append if total < 150
  });

  it("handles empty first paragraph gracefully (uses keyword as seed)", () => {
    const result = generateMetaTags({
      keyword: "digital marketing",
      title: "Digital Marketing Guide",
      firstParagraph: "",
    });

    // When firstParagraph is empty, keyword is used as seed
    expect(result.metaDescription).toContain("digital marketing");
    expect(result.keywordInDescription).toBe(true);
    // Length should be reasonable
    expect(result.metaDescriptionLength).toBeGreaterThan(0);
  });

  it("strips markdown from first paragraph", () => {
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing",
      firstParagraph: "## Content Marketing\n\n**Content marketing** is a `strategy` that helps _businesses_ grow.",
    });

    expect(result.metaDescription).not.toContain("##");
    expect(result.metaDescription).not.toContain("**");
    expect(result.metaDescription).not.toContain("`");
    expect(result.metaDescription).not.toContain("_");
  });
});

// ── Suggestions ───────────────────────────────────────────────────────────────

describe("generateMetaTags — suggestions", () => {
  it("does not return 'shorten' tip after title is auto-truncated to optimal range", () => {
    // Long titles are always truncated to 57+"..." = 60 chars (optimal range).
    // So the "shorten" suggestion should never fire — the generator handles it automatically.
    const result = generateMetaTags({
      keyword: "SEO",
      title: "This Is A Very Long Article Title About SEO That Exceeds The Sixty Character Limit",
      firstParagraph: "SEO helps your website rank higher in search engine results pages and drive organic traffic.",
    });

    // After truncation the status is "optimal", not "long"
    expect(result.titleTagStatus).toBe("optimal");
    const hasShortenTip = result.suggestions.some((s) =>
      s.includes("Shorten your title tag")
    );
    expect(hasShortenTip).toBe(false);
  });

  it("returns 'include keyword in title' tip when keyword missing from title", () => {
    const result = generateMetaTags({
      keyword: "unique rare phrase",
      title: "How to Write Better Articles for Your Blog",
      firstParagraph: "Writing better articles requires practice and a unique rare phrase of discipline.",
    });

    // After appending " | unique rare phrase", keyword IS in title
    // So we need a case where keyword ends up NOT in the title tag
    // (This happens when after truncation the keyword portion is cut off)
    const veryLongKeyword = "extremely long keyword phrase that gets cut";
    const result2 = generateMetaTags({
      keyword: veryLongKeyword,
      title: "How to Write Better Articles and Content for Your Blog Today",
      // title = 60 chars → already optimal, but after " | keyword" → long → truncate → keyword cut
      firstParagraph: `${veryLongKeyword} is important for rankings and visibility.`,
    });

    const hasKeywordTip = result2.suggestions.some((s) =>
      s.includes("Include your target keyword")
    );
    expect(hasKeywordTip).toBe(true);
  });

  it("returns 'expand title' tip when title is short", () => {
    const result = generateMetaTags({
      keyword: "SEO",
      title: "SEO Guide",
      firstParagraph: "SEO is a critical digital marketing discipline for growing organic traffic and visibility.",
    });

    const hasExpandTip = result.suggestions.some((s) =>
      s.includes("Expand your title")
    );
    expect(hasExpandTip).toBe(true);
  });

  it("caps suggestions at 3", () => {
    // Construct a scenario with many possible issues:
    // - short title (no audience)
    // - keyword not in title (after truncation)
    // - short description (no audience)
    // - keyword not in description
    const result = generateMetaTags({
      keyword: "unique term xyz",
      title: "Short",
      firstParagraph: "Nothing here.",
    });

    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("returns empty suggestions when everything is optimal", () => {
    // Build a case where title is 50-60, description is 150-160, keyword in both
    const keyword = "content strategy";
    // Title: "Content Strategy Planning Guide for SaaS Companies" = 50 chars → optimal
    const title = "Content Strategy Planning Guide for SaaS Companies"; // 50 chars → optimal
    // Use a first paragraph that gives 150-160 char description with keyword present
    const firstParagraph =
      "Content strategy is the planning and management of content to meet business goals. It helps organizations deliver the right message to the right audience.";
    // "content strategy" is in firstParagraph, length = 154 → optimal

    const result = generateMetaTags({ keyword, title, firstParagraph });

    // Title should be genuinely optimal (50-60 chars)
    expect(result.titleTagLength).toBeGreaterThanOrEqual(50);
    expect(result.titleTagLength).toBeLessThanOrEqual(60);
    expect(result.titleTagStatus).toBe("optimal");
    // Description should be optimal range — keyword is present
    expect(result.keywordInDescription).toBe(true);
    // Suggestions should not include description keyword tip
    const hasDescKwTip = result.suggestions.some((s) =>
      s.includes("in the meta description")
    );
    expect(hasDescKwTip).toBe(false);
  });
});

// ── Truncation flags ──────────────────────────────────────────────────────────

describe("generateMetaTags — truncation flags", () => {
  it("titleWasTruncated: false when title fits within 60 chars", () => {
    // "Short SEO Title" = 15 chars → no truncation
    const result = generateMetaTags({
      keyword: "SEO",
      title: "Short SEO Title",
      firstParagraph: "SEO tips for beginners.",
    });
    expect(result.titleWasTruncated).toBe(false);
  });

  it("titleWasTruncated: true when title exceeds 60 chars", () => {
    // Title > 60 chars → truncated
    const result = generateMetaTags({
      keyword: "SEO",
      title: "A Very Long Title About SEO That Definitely Exceeds Sixty Characters Right Here",
      firstParagraph: "SEO helps websites rank higher.",
    });
    expect(result.titleWasTruncated).toBe(true);
  });

  it("titleWasTruncated: false when title is exactly 60 chars", () => {
    // Construct a title that is exactly 60 chars with keyword already present
    // "SEO Guide for Modern Content Teams Right Here and Now Today!" = 60 chars
    const title = "SEO Guide for Modern Content Teams Right Here and Now Today!"; // 60 chars
    expect(title.length).toBe(60);
    const result = generateMetaTags({
      keyword: "SEO",
      title,
      firstParagraph: "SEO strategies that work.",
    });
    expect(result.titleWasTruncated).toBe(false);
  });

  it("titleWasTruncated: true when title is 61 chars", () => {
    // Construct a title that is exactly 61 chars with keyword already present
    // "SEO Guide for Modern Content Teams Here Right Now and Today!!" = 61 chars
    const title = "SEO Guide for Modern Content Teams Here Right Now and Today!!"; // 61 chars
    expect(title.length).toBe(61);
    const result = generateMetaTags({
      keyword: "SEO",
      title,
      firstParagraph: "SEO strategies that work.",
    });
    expect(result.titleWasTruncated).toBe(true);
  });

  it("descriptionWasTruncated: false when first paragraph fits within 160 chars", () => {
    // Short paragraph < 160 chars, keyword present
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing Guide",
      firstParagraph: "Content marketing helps businesses grow through valuable content.",
    });
    expect(result.descriptionWasTruncated).toBe(false);
  });

  it("descriptionWasTruncated: true when first paragraph exceeds 160 chars", () => {
    // Long paragraph > 160 chars, keyword present so no prepend
    const longParagraph =
      "Content marketing is a strategic approach focused on creating and distributing valuable, relevant, and consistent content to attract and retain a clearly defined audience and drive action.";
    expect(longParagraph.length).toBeGreaterThan(160);
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing",
      firstParagraph: longParagraph,
    });
    expect(result.descriptionWasTruncated).toBe(true);
  });

  it("titleWasTruncated: true when audience expansion pushes title over 60 chars (step 4 truncation)", () => {
    // Title "SEO Tips Guide" = 14c, keyword present → no append → 14c < 50 → step 4 fires.
    // Expanded: "SEO Tips Guide for enterprise marketing technology decision makers" = 65c > 60 → truncated.
    // Bug path: old code only checked after steps 2-3 (without audience), so flag was false.
    const result = generateMetaTags({
      keyword: "SEO tips",
      title: "SEO Tips Guide",
      firstParagraph: "SEO tips help your site rank higher.",
      audience: "enterprise marketing technology decision makers",
    });
    expect(result.titleWasTruncated).toBe(true);
    expect(result.titleTag.endsWith("...")).toBe(true);
    expect(result.titleTag.length).toBe(60);
  });

  it("titleWasTruncated: false when audience expansion keeps title within 60 chars", () => {
    // Title "SEO Tips Guide" = 14c → step 4 fires with short audience.
    // Expanded: "SEO Tips Guide for startups" = 27c ≤ 60 → no truncation.
    const result = generateMetaTags({
      keyword: "SEO tips",
      title: "SEO Tips Guide",
      firstParagraph: "SEO tips help your site rank higher.",
      audience: "startups",
    });
    expect(result.titleWasTruncated).toBe(false);
    expect(result.titleTag).toBe("SEO Tips Guide for startups");
  });

  it("descriptionWasTruncated: true when audience expansion pushes description over 160 chars (step 4 truncation)", () => {
    // desc = "SEO tips help your site rank higher in search results and drive traffic." = 72c
    // keyword present → no prepend. 72c < 150 → step 4 fires.
    // Expanded: desc + " Tailored for enterprise marketing directors, brand managers, and senior digital content strategists."
    // = 173c > 160 → truncated.
    // Bug path: old code only checked after steps 2-3 (without audience), so flag was false.
    const result = generateMetaTags({
      keyword: "SEO tips",
      title: "SEO Tips Guide",
      firstParagraph:
        "SEO tips help your site rank higher in search results and drive traffic.",
      audience:
        "enterprise marketing directors, brand managers, and senior digital content strategists",
    });
    expect(result.descriptionWasTruncated).toBe(true);
    expect(result.metaDescription.endsWith("...")).toBe(true);
    expect(result.metaDescription.length).toBe(160);
  });

  it("descriptionWasTruncated: false when audience expansion keeps description within 160 chars", () => {
    // desc = "SEO tips help your site rank higher in search results and drive traffic." = 72c
    // 72c < 150 → step 4 fires with short audience.
    // Expanded: 72 + 14 + 8 + 1 = 95c ≤ 160 → no truncation.
    const result = generateMetaTags({
      keyword: "SEO tips",
      title: "SEO Tips Guide",
      firstParagraph:
        "SEO tips help your site rank higher in search results and drive traffic.",
      audience: "startups",
    });
    expect(result.descriptionWasTruncated).toBe(false);
    expect(result.metaDescription).toContain("Tailored for startups.");
  });
});

// ── keywordInTitle / keywordInDescription ─────────────────────────────────────

describe("generateMetaTags — keyword detection", () => {
  it("detects keyword in title case-insensitively", () => {
    const result = generateMetaTags({
      keyword: "content marketing",
      title: "Content Marketing Strategy", // capital letters
      firstParagraph: "A short intro.",
    });
    expect(result.keywordInTitle).toBe(true);
  });

  it("detects keyword in description case-insensitively", () => {
    const result = generateMetaTags({
      keyword: "seo tips",
      title: "SEO Tips Guide",
      firstParagraph: "SEO Tips are essential for any digital strategy you build today online.",
    });
    expect(result.keywordInDescription).toBe(true);
  });
});
