/**
 * Client-surface-exposure test (PR 018 / P1.C.1, AC#2). Proves the tokenized
 * /review surface NEVER renders the gate scorecard, credits, cost, model, or raw
 * markdown export — they are STRUCTURALLY ABSENT from the rendered tree.
 *
 * We render the Server Component `renderReviewPage(token, deps)` (with an injected
 * fixture token seam) to a STATIC HTML string via react-dom/server, then assert
 * the forbidden surface area is absent and the review-safe surface (SERP preview,
 * the same-origin sandboxed hub iframe pointing at the EXISTING SSR render route,
 * the section verbs) IS present.
 *
 * Also proves the fail-closed boundary: an unresolved token → notFound() (404),
 * never the content.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";

import {
  renderReviewPage,
  resolveReviewSurface,
  type ReviewPageDeps,
} from "@/app/review/[token]/page";
import {
  hashReviewToken,
  type ReviewScope,
  type ReviewPreviewTarget,
  type ReviewTokenDataAccess,
} from "@/lib/review/resolve-token";

const TOKEN = "tok_" + randomUUID().replace(/-/g, "");
const SCOPE: ReviewScope = {
  workspaceId: randomUUID(),
  clientId: randomUUID(),
  pieceId: randomUUID(),
  version: 2,
};
const TARGET: ReviewPreviewTarget = {
  clientBlogSlug: "willow-creek",
  pieceSlug: "what-is-memory-care",
  title: "What is memory care?",
  displayUrl: "willowcreek.example › blog › what-is-memory-care",
  metaDescription: "A plain-language guide to memory care for families.",
};

function makeDeps(opts: { resolves?: boolean; targetNull?: boolean } = {}): ReviewPageDeps {
  const resolves = opts.resolves ?? true;
  const tokens: ReviewTokenDataAccess = {
    resolveTokenByHash: async (hash) =>
      resolves && hash === hashReviewToken(TOKEN) ? SCOPE : null,
    resolvePreviewTarget: async () => (opts.targetNull ? null : TARGET),
  };
  return { tokens };
}

async function renderHtml(token: string, deps: ReviewPageDeps): Promise<string> {
  const element = await renderReviewPage(token, deps);
  return renderToStaticMarkup(element);
}

// The forbidden surface area — strings/markers that would betray internal/gate
// state leaking onto the client review link.
const FORBIDDEN = [
  "scorecard",
  "GateScorecard",
  "credits",
  "credit balance",
  "cost",
  "$0.0", // a rendered model cost figure
  "model:", // a model id tag
  "gpt-",
  "claude-",
  "markdown export",
  "Export markdown",
  "Stage A",
  "Stage B",
  "verdict",
];

describe("client-surface-exposure (AC#2)", () => {
  it("never renders the scorecard / credits / cost / model / markdown export", async () => {
    const html = await renderHtml(TOKEN, makeDeps());
    const lower = html.toLowerCase();
    for (const needle of FORBIDDEN) {
      expect(
        lower.includes(needle.toLowerCase()),
        `forbidden surface "${needle}" must be ABSENT from the client review tree`,
      ).toBe(false);
    }
  });

  it("renders the review-safe surface: SERP preview + the same-origin sandboxed hub iframe", async () => {
    const html = await renderHtml(TOKEN, makeDeps());
    // The SERP preview (review-safe display fields only).
    expect(html).toContain('data-testid="serp-preview"');
    expect(html).toContain("What is memory care?");
    // The REAL hub in a same-origin SANDBOXED iframe pointing at the EXISTING SSR
    // render route (NOT a forked renderer).
    expect(html).toContain('data-testid="review-preview-iframe"');
    expect(html).toContain('src="/clients/willow-creek/blog/what-is-memory-care"');
    expect(html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
    // The section verbs.
    expect(html).toContain('data-testid="section-approval-beat"');
    expect(html).toContain('data-testid="section-approve-btn"');
    expect(html).toContain('data-testid="request-changes-btn"');
  });

  it("does not embed the raw piece body/markdown on the client surface (iframe-only)", async () => {
    const html = await renderHtml(TOKEN, makeDeps());
    // The review page itself carries NO article-body container — the body is only
    // ever shown INSIDE the iframe (the public SSR hub), never inlined here.
    expect(html).not.toContain('data-role="article-body"');
  });

  it("fail-closed: an unknown token resolves to no surface (the page 404s)", async () => {
    const surface = await resolveReviewSurface("tok_" + "0".repeat(40), makeDeps());
    expect(surface).toBeNull();
    // renderReviewPage would call notFound() — assert it throws (Next's NEXT_NOT_FOUND).
    await expect(renderReviewPage("tok_" + "0".repeat(40), makeDeps())).rejects.toThrow();
  });

  it("fail-closed: a token whose tuple no longer resolves → no surface", async () => {
    const surface = await resolveReviewSurface(TOKEN, makeDeps({ targetNull: true }));
    expect(surface).toBeNull();
  });
});
