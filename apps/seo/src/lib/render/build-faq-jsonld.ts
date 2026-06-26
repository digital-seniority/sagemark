/**
 * build-faq-jsonld — emit schema.org FAQPage JSON-LD for a published piece's
 * self-contained Q&A block (PR 015, lane render-geo).
 *
 * THE GEO SIGNAL. AI answer engines and rich-result crawlers read FAQPage
 * structured data to quote a page's questions/answers directly. The draft route
 * persists `faqData[]` as self-contained `{question, answer}` pairs (SKILL:
 * "answers stand alone for FAQPage JSON-LD and AI-answer citation"); this module
 * turns them into a valid FAQPage graph (acceptance criterion 2).
 *
 * The output mirrors the vendored whispering-willows demo `faq.html`:
 *   { "@context":"https://schema.org", "@type":"FAQPage",
 *     "mainEntity":[ { "@type":"Question","name":..,
 *                      "acceptedAnswer":{ "@type":"Answer","text":.. } } ] }
 *
 * Pure, deterministic. The answer text is the PLAIN answer (placeholders already
 * stripped upstream); JSON.stringify handles all escaping, so emitting this into
 * a <script type="application/ld+json"> is injection-safe (we additionally
 * neutralize the closing-tag + comment sequences and the JS line/paragraph
 * separators, the only bytes that could break out of a <script> element).
 */

import type { GeoFaqItem } from "@sagemark/core";

/** A schema.org Question node. */
export interface FaqQuestionNode {
  "@type": "Question";
  name: string;
  acceptedAnswer: { "@type": "Answer"; text: string };
}

/** A schema.org FAQPage graph. */
export interface FaqPageJsonLd {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: FaqQuestionNode[];
}

/**
 * Build the FAQPage JSON-LD object from a piece's `faqData`, or `null` when there
 * is no usable FAQ content (no entries, or every entry is blank). A null result
 * means the page emits NO FAQ script — never an empty `FAQPage` (an empty graph
 * is an invalid rich-result signal).
 *
 * @param faqData  The persisted `{question, answer}[]` (already placeholder-free).
 */
export function buildFaqJsonLd(
  faqData: GeoFaqItem[] | null | undefined,
): FaqPageJsonLd | null {
  if (!faqData || faqData.length === 0) return null;

  const mainEntity: FaqQuestionNode[] = [];
  for (const item of faqData) {
    const name = (item?.question ?? "").trim();
    const text = (item?.answer ?? "").trim();
    // A self-contained FAQ needs BOTH a question and a standalone answer.
    if (!name || !text) continue;
    mainEntity.push({
      "@type": "Question",
      name,
      acceptedAnswer: { "@type": "Answer", text },
    });
  }

  if (mainEntity.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

// The JS line-separator / paragraph-separator codepoints. They are legal inside
// a JSON string but NOT inside a raw <script> body, so they are escaped. Built
// from codepoints so no literal separator char appears in this source file.
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), "g");
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * Serialize the FAQPage graph for safe embedding in a `<script type=
 * "application/ld+json">`. JSON.stringify escapes quotes/backslashes; we ALSO
 * neutralize the `</script` and `<!--` sequences plus U+2028/U+2029 (the only
 * ways a string value could break out of the script element), so a hostile FAQ
 * answer cannot inject markup. Returns "" when there is no FAQ (caller emits
 * nothing).
 */
export function serializeFaqJsonLd(
  faqData: GeoFaqItem[] | null | undefined,
): string {
  const graph = buildFaqJsonLd(faqData);
  if (!graph) return "";
  return JSON.stringify(graph)
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\u0021--")
    .replace(LINE_SEP, "\\u2028")
    .replace(PARA_SEP, "\\u2029");
}
