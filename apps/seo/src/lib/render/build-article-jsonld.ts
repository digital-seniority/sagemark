/**
 * build-article-jsonld — schema.org Article + BreadcrumbList JSON-LD for hub pages (Slice 10).
 *
 * Emits Article + BreadcrumbList structured data for AI answer engines and
 * Google rich results. Pure + sync; injection-safe: JSON.stringify escapes all
 * values (including U+2028/U+2029 line terminators); only the </script> and
 * <!-- sequences need extra neutralization so the payload is safe in a
 * <script type="application/ld+json"> element.
 */

/** Article JSON-LD graph (schema.org). */
export interface ArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "Article";
  headline: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  url?: string;
}

/** BreadcrumbList JSON-LD graph (schema.org). */
export interface BreadcrumbListJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
  }>;
}

/**
 * Neutralize sequences that could escape a `<script>` element.
 * JSON.stringify already escapes U+2028/U+2029, and all quote/bracket chars
 * inside string values. The only remaining risks for a <script> context are
 * the literal tokens `</script>` and `<!--`.
 */
function scriptSafe(json: string): string {
  return json
    .split("</script>").join("<\\/script>")
    .split("<!--").join("<\\!--");
}

/**
 * Build a schema.org Article JSON-LD string for one hub page, or null when the
 * headline is missing (schema.org Article requires a headline).
 */
export function buildArticleJsonLd(
  title: string,
  opts: {
    excerpt?: string | null;
    publishedAt?: string | null;
    updatedAt?: string | null;
    pageUrl?: string;
  } = {},
): string | null {
  if (!title.trim()) return null;

  const ld: ArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title.slice(0, 110),
  };
  if (opts.excerpt) ld.description = opts.excerpt.slice(0, 300);
  if (opts.publishedAt) ld.datePublished = opts.publishedAt.slice(0, 10);
  if (opts.updatedAt) ld.dateModified = opts.updatedAt.slice(0, 10);
  if (opts.pageUrl) ld.url = opts.pageUrl;

  return scriptSafe(JSON.stringify(ld));
}

/**
 * Build a schema.org BreadcrumbList JSON-LD string: Home → Article.
 * Returns null when both the hub URL and the title are missing.
 */
export function buildBreadcrumbJsonLd(
  hubUrl: string,
  hubName: string,
  pageTitle: string,
  pageUrl?: string,
): string | null {
  if (!hubUrl || !pageTitle) return null;

  const ld: BreadcrumbListJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: hubName,
        item: hubUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: pageTitle,
        ...(pageUrl ? { item: pageUrl } : {}),
      },
    ],
  };

  return scriptSafe(JSON.stringify(ld));
}
