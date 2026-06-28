"use client";

/**
 * ExportMenu — the artifact-header export dropdown (Slice 4).
 *
 * Turns the CURRENT draft body into every handoff format, all client-side (no
 * server round-trip): copy markdown / HTML, download .md / standalone .html / a
 * CMS-paste fragment / a .zip bundle (html + md + JSON-LD + meta.json), and
 * print-to-PDF. The render core is the shared escape-first renderer (article-html),
 * so the exported HTML matches what publishes. Disabled until there's a body.
 *
 * Dark tokens, no hardcoded palette beyond the accent vars. Clean ASCII / UTF-8.
 */

import { useEffect, useRef, useState } from "react";
import type { ContentBrief } from "./BriefCard";
import {
  buildStandaloneHtml,
  buildFragmentHtml,
  buildMarkdown,
  buildMeta,
  exportStem,
  type ArticleExportInput,
} from "@/lib/export/article-html";
import { buildZip } from "@/lib/export/zip";
import { serializeFaqJsonLd } from "@/lib/render/build-faq-jsonld";

export interface ExportMenuProps {
  brief: ContentBrief | null;
  body: string;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return false;
}

/** Print via a hidden iframe (no popup-blocker, no navigation away). */
function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow!;
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  textAlign: "left",
  appearance: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12.5,
  color: "var(--foreground)",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  padding: "7px 9px",
};

export function ExportMenu({ brief, body }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const hasBody = (body ?? "").trim().length > 0;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const input: ArticleExportInput = {
    title: brief?.title ?? "Untitled",
    slug: brief?.slug ?? "",
    body: body ?? "",
    primaryKeyword: brief?.primaryKeyword ?? null,
  };
  const stem = exportStem(input.slug || input.title);

  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((m) => (m === msg ? null : m)), 1400);
  }

  async function run(action: string) {
    switch (action) {
      case "copy-md":
        flashMsg((await copyText(buildMarkdown(input.body))) ? "Markdown copied" : "Copy failed");
        break;
      case "copy-html":
        flashMsg((await copyText(buildStandaloneHtml(input))) ? "HTML copied" : "Copy failed");
        break;
      case "dl-md":
        downloadText(`${stem}.md`, buildMarkdown(input.body), "text/markdown");
        break;
      case "dl-html":
        downloadText(`${stem}.html`, buildStandaloneHtml(input), "text/html");
        break;
      case "dl-fragment":
        downloadText(`${stem}.fragment.html`, buildFragmentHtml(input.body), "text/html");
        break;
      case "dl-zip": {
        const faq = serializeFaqJsonLd(input.faqData);
        const entries = [
          { name: `${stem}.html`, data: buildStandaloneHtml(input) },
          { name: `${stem}.md`, data: buildMarkdown(input.body) },
          { name: "meta.json", data: JSON.stringify(buildMeta(input), null, 2) },
        ];
        if (faq) entries.push({ name: "faq.jsonld", data: faq });
        downloadBlob(`${stem}.zip`, buildZip(entries));
        break;
      }
      case "print":
        printHtml(buildStandaloneHtml(input));
        break;
    }
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="export-button"
        disabled={!hasBody}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: "none",
          cursor: hasBody ? "pointer" : "not-allowed",
          font: "inherit",
          fontSize: 11.5,
          display: "flex",
          alignItems: "center",
          gap: 5,
          color: "var(--foreground)",
          background: "transparent",
          border: "1px solid var(--line)",
          borderRadius: 7,
          padding: "4px 9px",
          opacity: hasBody ? 1 : 0.45,
        }}
      >
        {flash ?? "Export"} <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="export-menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            width: 188,
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: 9,
            padding: 5,
            boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
          }}
        >
          <button type="button" role="menuitem" data-testid="export-copy-md" style={ITEM_STYLE} onClick={() => run("copy-md")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>⧉</span> Copy markdown
          </button>
          <button type="button" role="menuitem" data-testid="export-copy-html" style={ITEM_STYLE} onClick={() => run("copy-html")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>⧉</span> Copy HTML
          </button>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <button type="button" role="menuitem" data-testid="export-dl-md" style={ITEM_STYLE} onClick={() => run("dl-md")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>↓</span> Download .md
          </button>
          <button type="button" role="menuitem" data-testid="export-dl-html" style={ITEM_STYLE} onClick={() => run("dl-html")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>↓</span> Download HTML
          </button>
          <button type="button" role="menuitem" data-testid="export-dl-fragment" style={ITEM_STYLE} onClick={() => run("dl-fragment")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>↓</span> CMS fragment
          </button>
          <button type="button" role="menuitem" data-testid="export-dl-zip" style={ITEM_STYLE} onClick={() => run("dl-zip")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>▦</span> ZIP bundle
          </button>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <button type="button" role="menuitem" data-testid="export-print" style={ITEM_STYLE} onClick={() => run("print")}>
            <span aria-hidden="true" style={{ color: "var(--muted)" }}>⎙</span> Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
