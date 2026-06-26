/**
 * resolve-placeholders — strip the draft-time editorial placeholder tokens out of
 * a content body BEFORE it is rendered to the public (PR 015, lane render-geo).
 *
 * THE LEAK GUARD. The draft route (seo-blog-writer) emits `[photo:...]` and
 * `[cta:...]` markers in the body — they are render-time directives, never real
 * images/links, and MUST NOT reach the public HTML (PRD/SKILL: "resolved at
 * render, never real images/links"). A leaked `[photo:]` is an SEO/credibility
 * defect (acceptance criterion 3). This module is the single chokepoint that
 * removes every `[...]`-shaped token.
 *
 * Scope (deliberately conservative):
 *   - We strip ANY `[token:...]` directive (`[photo:...]`, `[cta:...]`, and any
 *     future `[kind:...]`) — the colon marks it as an editorial directive.
 *   - We also strip bare bracket markers like `[photo]` / `[cta]` (no colon).
 *   - We DO NOT touch markdown links `[text](url)` — those are legitimate body
 *     content the renderer turns into <a>. A directive never has a `(...)` tail,
 *     so the link form is preserved by construction.
 *
 * Pure, deterministic, no network/LLM. ASCII/UTF-8.
 */

/**
 * Matches an editorial placeholder directive:
 *   - `[kind:...]`  — a colon-delimited directive with optional payload, OR
 *   - `[kind]`      — a bare directive (photo|cta|image|video|link|asset|embed)
 * but NEVER a markdown link `[text](url)` (negative lookahead on the `(`).
 *
 * `kind` is restricted to word chars so we don't eat arbitrary `[bracketed]`
 * prose; the colon form accepts any payload up to the closing bracket.
 */
const COLON_DIRECTIVE = /\[[a-z][\w-]*:[^\]]*\](?!\()/gi;
const BARE_DIRECTIVE = /\[(?:photo|cta|image|img|video|link|asset|embed|placeholder)\](?!\()/gi;

/**
 * Remove every placeholder directive from a body string, collapsing the
 * whitespace a removed inline/own-line token would otherwise leave behind.
 *
 * @param body  Raw markdown body (may contain `[photo:]`/`[cta:]` markers).
 * @returns     The body with all directive tokens stripped.
 */
export function resolvePlaceholders(body: string): string {
  if (!body) return "";
  let out = body.replace(COLON_DIRECTIVE, "").replace(BARE_DIRECTIVE, "");
  // A token that occupied its own line leaves a blank line — collapse runs of
  // 3+ newlines back to a paragraph break, and trim trailing spaces per line.
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return out;
}

/**
 * True iff a string still contains any `[...]`-shaped marker that looks like an
 * editorial directive (used by tests / a defensive render-time assertion to
 * prove nothing leaked). Markdown links `[text](url)` are NOT flagged.
 */
export function hasLeakedPlaceholder(s: string): boolean {
  // Re-run the directive detectors (fresh regex state — the module-level ones
  // are /g and stateful). Any match means a directive survived.
  return /\[[a-z][\w-]*:[^\]]*\](?!\()/i.test(s) ||
    /\[(?:photo|cta|image|img|video|link|asset|embed|placeholder)\](?!\()/i.test(s);
}
