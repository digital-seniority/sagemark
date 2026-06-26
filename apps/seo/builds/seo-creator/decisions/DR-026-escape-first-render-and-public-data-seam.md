# DR-026 — escape-first-render-and-public-data-seam

**Date:** 2026-06-26
**Run:** #015 (P1.R.1 / PR 015)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.R.1 built the public content-hub SSR render route — the first public-facing surface. It needed to render a published piece's markdown body to HTML server-side (body-in-initial-HTML for SEO/GEO) without introducing a stored-XSS vector from piece content, and to read published pieces without a wired DB yet.

## Decisions

**1. Escape-first, no-markdown-library renderer.** `lib/render/client-blog.ts` HTML-escapes the body text FIRST, then emits only renderer-authored tags (headings, lists, links with an allow-listed scheme). No third-party markdown library that emits raw HTML is used. **The escape-first property IS the XSS guard** on the public surface. Invariant: never add a markdown dependency that emits unescaped/raw HTML into this route; if richer rendering is needed, extend `renderArticleBody` behind the same escape-first contract. (Judge also caught + fixed an invalid-JSON `<!--` escape in the FAQ JSON-LD serializer → must use valid-JSON escapes like `!`, never `\!`.)

**2. Public read seam.** A `PublicContentDataAccess` (read-only, published-only) + `PublishedPiece`/`PublicClient` projection + a fail-closed `NOT_WIRED_PUBLIC_DATA_ACCESS` stub were added to `lib/content/context.ts`. The render route is fail-closed by construction: unknown client / non-published / cross-client → 404, and the production default throws until the real anon/published-only Drizzle impl is wired.

## Consequences

- Public render = body-in-initial-HTML (Server Component, `force-dynamic`, no client body injection); only `status='published'` ever served (defense-in-depth over the anon RLS `content_pieces_public_read`, DR-023).
- **The schema-tenancy lane must wire the real `PublicContentDataAccess` (anon, published-only) Drizzle impl** before production render works (currently throws). Add a Tier-2 render-against-live-DB test then.
- The `PublishedPiece` projection must never expose draft/internal fields (private-by-default).

## Revisit if

- A markdown library is genuinely needed (re-evaluate the escape-first invariant; require a security review).
- The public-data Drizzle impl lands (flip the stub; add Tier-2).

## Related

- Anchor: prd.md §11 (private-by-default; published = only public surface), §2 (render)
- Predecessors: [[DR-023]] (RLS zero-policy / anon published-only)
- PR: P1.R.1 (PR 015)

---

*Authored by /seo-creator-build · Run #015 · 2026-06-26*
