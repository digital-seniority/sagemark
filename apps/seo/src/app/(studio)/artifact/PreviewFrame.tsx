"use client";

/**
 * PreviewFrame — the artifact Preview tab: the rendered reading view (Slice 4).
 *
 * Shows the operator what the page will actually look like — a paired SERP snippet
 * (reusing the client-review SerpPreview) plus the full article rendered into a
 * SANDBOXED, same-origin iframe via `srcdoc`. The HTML is built from the CURRENT
 * draft body by the shared escape-first exporter (buildStandaloneHtml), so the
 * preview always reflects the live body and exactly matches the export/publish
 * output. The iframe sandbox is empty (no scripts) — the document is inert.
 *
 * Dark tokens for the chrome; the iframe document itself is the light article doc.
 * Clean ASCII / UTF-8.
 */

import type { ContentBrief } from "./BriefCard";
import { SerpPreview } from "@/app/review/[token]/SerpPreview";
import { buildStandaloneHtml, deriveMetaDescription } from "@/lib/export/article-html";

export interface PreviewFrameProps {
  brief: ContentBrief | null;
  body: string;
}

export function PreviewFrame({ brief, body }: PreviewFrameProps) {
  const hasBody = (body ?? "").trim().length > 0;

  if (!hasBody) {
    return (
      <p data-testid="preview-empty" style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
        The rendered preview appears once the draft has a body. Switch to{" "}
        <strong>Draft</strong> to start it.
      </p>
    );
  }

  const title = brief?.title ?? "Untitled";
  const slug = brief?.slug ?? "";
  const metaDescription = deriveMetaDescription(body);
  const html = buildStandaloneHtml({ title, slug, body, metaDescription });

  return (
    <div data-testid="preview-frame-zone" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <p
          style={{
            margin: "0 0 7px",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted-2)",
          }}
        >
          Search result
        </p>
        <SerpPreview
          title={title}
          displayUrl={`sagemark.app › blog › ${slug || "your-article"}`}
          metaDescription={metaDescription}
        />
      </div>

      <div>
        <p
          style={{
            margin: "0 0 7px",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted-2)",
          }}
        >
          Rendered page
        </p>
        <iframe
          data-testid="preview-frame"
          title="Rendered page preview"
          // Inert document (no scripts execute under an empty sandbox); the body is
          // escape-first rendered, so srcdoc is safe.
          sandbox=""
          srcDoc={html}
          style={{
            width: "100%",
            height: 520,
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "#ffffff",
          }}
        />
      </div>
    </div>
  );
}

export default PreviewFrame;
