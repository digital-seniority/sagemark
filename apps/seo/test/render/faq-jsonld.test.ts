/**
 * PR 015 acceptance criterion 2 — valid FAQPage JSON-LD is emitted for pieces
 * with FAQ content, parses, and matches the piece's Q&A.
 *
 * Asserts both the pure builder (`buildFaqJsonLd`) and the rendered page: the
 * <script type="application/ld+json"> block parses to a schema.org FAQPage whose
 * mainEntity matches the injected faqData. Also proves a piece with no FAQ emits
 * NO script block (never an empty/invalid FAQPage).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildFaqJsonLd,
  serializeFaqJsonLd,
  type FaqPageJsonLd,
} from "@/lib/render/build-faq-jsonld";
import { renderClientBlogPage } from "@/app/clients/[client]/blog/[slug]/page";
import { makePublicData, publishedPiece, CLIENT_SLUG } from "./fixtures";

function extractJsonLd(html: string): unknown {
  const m =
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error("no JSON-LD script found");
  return JSON.parse(m[1]!);
}

describe("FAQPage JSON-LD (criterion 2)", () => {
  it("buildFaqJsonLd produces a valid schema.org FAQPage graph", () => {
    const piece = publishedPiece();
    const graph = buildFaqJsonLd(piece.faqData);
    expect(graph).not.toBeNull();
    expect(graph!["@context"]).toBe("https://schema.org");
    expect(graph!["@type"]).toBe("FAQPage");
    expect(graph!.mainEntity).toHaveLength(2);
    expect(graph!.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "What is memory care?",
      acceptedAnswer: { "@type": "Answer" },
    });
    expect(graph!.mainEntity[0]!.acceptedAnswer.text).toContain(
      "Memory care is specialized long-term care",
    );
  });

  it("drops blank/incomplete Q&A entries and returns null when none remain", () => {
    expect(buildFaqJsonLd(null)).toBeNull();
    expect(buildFaqJsonLd([])).toBeNull();
    expect(
      buildFaqJsonLd([{ question: "Q only", answer: "" }]),
    ).toBeNull();
    const partial = buildFaqJsonLd([
      { question: "Good?", answer: "Yes." },
      { question: "", answer: "orphan answer" },
    ]);
    expect(partial!.mainEntity).toHaveLength(1);
  });

  it("renders a parseable FAQPage script that matches the piece Q&A", async () => {
    const data = makePublicData({ pieces: [publishedPiece()] });
    const element = await renderClientBlogPage(CLIENT_SLUG, "what-is-memory-care", {
      data,
    });
    const html = renderToStaticMarkup(element);

    const parsed = extractJsonLd(html) as {
      "@type": string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(parsed["@type"]).toBe("FAQPage");
    const names = parsed.mainEntity.map((q) => q.name);
    expect(names).toEqual([
      "What is memory care?",
      "Is memory care the same as a nursing home?",
    ]);
    expect(parsed.mainEntity[1]!.acceptedAnswer.text).toContain(
      "residential, home-like care",
    );
  });

  it("emits no FAQPage JSON-LD for a piece with no FAQ content", async () => {
    // Slice 10: Article pieces without faqData still emit Article+BreadcrumbList JSON-LD.
    // The important invariant is that no invalid (empty) FAQPage block is emitted.
    const data = makePublicData({
      pieces: [publishedPiece({ slug: "no-faq", faqData: null })],
    });
    const element = await renderClientBlogPage(CLIENT_SLUG, "no-faq", { data });
    const html = renderToStaticMarkup(element);
    // No FAQPage structured data (an empty one would be an invalid rich-result signal).
    expect(html).not.toContain('"FAQPage"');
  });

  it("neutralizes a </script> breakout attempt in an FAQ answer", () => {
    const out = serializeFaqJsonLd([
      { question: "Hostile?", answer: "</script><script>alert(1)</script>" },
    ]);
    // The literal closing-script sequence must be escaped in the serialized JSON.
    expect(out).not.toContain("</script>");
    expect(out).toContain("<\\/script>");
    // It still parses as valid JSON (escaping is JSON-safe).
    expect(() => JSON.parse(out)).not.toThrow();
  });

  // Regression for the AC2 defect: the `<!--` neutralization used to emit the
  // invalid JSON escape `<\!--` (\! is NOT a legal JSON string escape), so
  // JSON.parse rejected the script content with "Bad escaped character in JSON"
  // whenever a FAQ question/answer contained the HTML comment-open `<!--`.
  it("emits VALID JSON when FAQ content contains the HTML comment-open <!--", () => {
    const question = "Is <!-- a comment --> safe?";
    const answer =
      "Yes: a stray <!-- and even </script><!-- together stay neutralized.";
    const out = serializeFaqJsonLd([{ question, answer }]);

    // (a) The serialized JSON-LD parses — this is the exact regression.
    let parsed: FaqPageJsonLd;
    expect(() => {
      parsed = JSON.parse(out) as FaqPageJsonLd;
    }).not.toThrow();

    // (b) Round-trip: the parsed FAQPage mainEntity recovers the ORIGINAL text,
    //     `<!--` included (the valid ! escape parses back to the literal).
    parsed = JSON.parse(out) as FaqPageJsonLd;
    expect(parsed.mainEntity[0]!.name).toBe(question);
    expect(parsed.mainEntity[0]!.acceptedAnswer.text).toBe(answer);

    // (c) No literal `<!--` survives in the raw serialized source — so it can
    //     never open an HTML comment inside the <script> block.
    expect(out).not.toContain("<!--");
  });

  it("renders parseable JSON-LD with no literal <!-- in the script block", async () => {
    const data = makePublicData({
      pieces: [
        publishedPiece({
          slug: "comment-open-faq",
          faqData: [
            {
              question: "Does <!-- break the page?",
              answer:
                "No — </script><!-- breakout bytes are neutralized in the JSON-LD.",
            },
          ],
        }),
      ],
    });
    const element = await renderClientBlogPage(CLIENT_SLUG, "comment-open-faq", {
      data,
    });
    const html = renderToStaticMarkup(element);

    // The rendered JSON-LD script parses (would throw on the old `<\!--`).
    const parsed = extractJsonLd(html) as {
      "@type": string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity[0]!.name).toBe("Does <!-- break the page?");
    expect(parsed.mainEntity[0]!.acceptedAnswer.text).toContain("</script>");

    // No literal HTML comment-open inside the JSON-LD script block.
    const m =
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]!).not.toContain("<!--");
  });
});
