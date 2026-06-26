/**
 * SerpPreview — the paired search-result preview on the client-review surface
 * (PR 018 / P1.C.1, lane client-review).
 *
 * Renders the SEARCH-ENGINE-RESULT shape of the piece (the title link, the
 * displayed URL breadcrumb, the meta description snippet) so the client reviews
 * how the piece will appear in a SERP alongside the live hub preview. This is a
 * presentational Server Component — it takes ONLY the public, review-safe fields
 * already resolved for the surface (title, displayed URL, meta description). It
 * does NOT expose any internal/gate field (no scorecard, credits, cost, model,
 * markdown export) — those never reach this component (AC#2).
 *
 * Colors are brand-token-driven (`--foreground`/`--background`), no hardcoded hue.
 * Meta description is truncated to a SERP-realistic length so the client sees the
 * actual snippet a crawler would render.
 */

import React from "react";

export interface SerpPreviewProps {
  /** The piece title (the blue SERP link text). */
  title: string;
  /** The displayed URL breadcrumb, e.g. "example.com › blog › slug". */
  displayUrl: string;
  /** The meta description snippet (truncated for the SERP). */
  metaDescription?: string | null;
}

/** Google truncates descriptions around ~160 chars — match that for realism. */
const SERP_SNIPPET_MAX = 160;

export function SerpPreview({
  title,
  displayUrl,
  metaDescription,
}: SerpPreviewProps) {
  const snippet = truncate(metaDescription ?? "", SERP_SNIPPET_MAX);
  return (
    <div
      data-testid="serp-preview"
      aria-label="Search result preview"
      style={{
        maxWidth: 600,
        borderRadius: 6,
        border: "1px solid color-mix(in srgb, var(--foreground) 12%, transparent)",
        background: "var(--background)",
        padding: 16,
      }}
    >
      <div
        data-testid="serp-url"
        style={{
          fontSize: 13,
          opacity: 0.7,
          marginBottom: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayUrl}
      </div>
      <div
        data-testid="serp-title"
        style={{
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.3,
          // The SERP title link uses the brand foreground as its accent.
          color: "var(--foreground)",
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      {snippet ? (
        <div
          data-testid="serp-snippet"
          style={{ fontSize: 14, lineHeight: 1.4, opacity: 0.85 }}
        >
          {snippet}
        </div>
      ) : null}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
