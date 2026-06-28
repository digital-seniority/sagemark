/**
 * brand-theme.test.ts — injection-safety + output shape for buildBrandStyleTag.
 *
 * CRITICAL: every test that passes attacker-controlled input verifies the injected
 * value does NOT appear in the output verbatim. The goal is that no CSS injection
 * vector (semicolons, braces, url(), javascript:, angle brackets) can escape via
 * any BrandSpec field.
 */

import { describe, it, expect } from "vitest";
import {
  buildBrandStyleTag,
  parseBrandSpec,
  NEUTRAL_BRAND,
} from "../../src/lib/render/brand-theme";

// ── Sanity: fallback output ────────────────────────────────────────────────────

describe("buildBrandStyleTag — neutral brand", () => {
  it("renders :root with all NEUTRAL_BRAND vars when brand is null", () => {
    const css = buildBrandStyleTag(null);
    expect(css).toContain(":root {");
    expect(css).toContain(`--brand-color: ${NEUTRAL_BRAND.palette.brand}`);
    expect(css).toContain(`--brand-accent: ${NEUTRAL_BRAND.palette.accent}`);
    expect(css).toContain(`--brand-bg: ${NEUTRAL_BRAND.palette.bg}`);
    expect(css).toContain("--brand-heading-font:");
    expect(css).toContain("--brand-body-font:");
  });

  it("does not include a logo-url var when brand has no logo", () => {
    const css = buildBrandStyleTag({});
    expect(css).not.toContain("--brand-logo-url");
  });
});

// ── Valid brand spec ──────────────────────────────────────────────────────────

describe("buildBrandStyleTag — valid brand", () => {
  it("uses the client hex colors when they are valid", () => {
    const css = buildBrandStyleTag({
      palette: {
        brand: "#1a2b3c",
        brandDark: "#0f1a27",
        accent: "#e87c5a",
        ink: "#111111",
        bg: "#f5f5f0",
        surface: "#ffffff",
      },
    });
    expect(css).toContain("--brand-color: #1a2b3c");
    expect(css).toContain("--brand-dark: #0f1a27");
    expect(css).toContain("--brand-accent: #e87c5a");
  });

  it("includes a logo-url var for a valid https URL", () => {
    const css = buildBrandStyleTag({
      logo: { url: "https://example.com/logo.svg", alt: "Acme Inc" },
    });
    expect(css).toContain("--brand-logo-url: url('https://example.com/logo.svg')");
    expect(css).toContain("--brand-logo-alt: 'Acme Inc'");
  });

  it("emits quoted font-family strings for known Google fonts", () => {
    const css = buildBrandStyleTag({
      typography: {
        headingFamily: "'Playfair Display', Georgia, serif",
        bodyFamily: "'Open Sans', sans-serif",
      },
    });
    expect(css).toContain("--brand-heading-font: 'Playfair Display', Georgia, serif");
    expect(css).toContain("--brand-body-font: 'Open Sans', sans-serif");
  });

  it("falls back to NEUTRAL_BRAND heading when headingFamily is missing", () => {
    const css = buildBrandStyleTag({ palette: { brand: "#aabbcc" } });
    expect(css).toContain(`--brand-heading-font: ${NEUTRAL_BRAND.typography.headingFamily}`);
  });
});

// ── Injection safety ──────────────────────────────────────────────────────────

describe("buildBrandStyleTag — injection safety", () => {
  it("rejects a hex value that contains CSS function syntax", () => {
    const css = buildBrandStyleTag({ palette: { brand: "url(javascript:alert(1))" } });
    expect(css).not.toContain("javascript");
    expect(css).not.toContain("url(");
    // Falls back to NEUTRAL_BRAND
    expect(css).toContain(`--brand-color: ${NEUTRAL_BRAND.palette.brand}`);
  });

  it("rejects a hex value with semicolon (CSS injection)", () => {
    const css = buildBrandStyleTag({ palette: { brand: "#aabbcc; color: red" } });
    expect(css).not.toContain("color: red");
    expect(css).toContain(`--brand-color: ${NEUTRAL_BRAND.palette.brand}`);
  });

  it("rejects a font-family with CSS function call (var() injection)", () => {
    const css = buildBrandStyleTag({
      typography: { headingFamily: "var(--evil, 'foo'); color:red" },
    });
    expect(css).not.toContain("var(--evil");
    expect(css).not.toContain("color:red");
  });

  it("rejects a font-family with curly-brace injection", () => {
    const css = buildBrandStyleTag({
      typography: { headingFamily: "Arial } body { color: red; font-family: Arial" },
    });
    expect(css).not.toContain("color: red");
    // The attacker's injected closing brace should not appear inside the CSS vars section
    expect(css).not.toContain("body {");
  });

  it("rejects a non-https logo URL", () => {
    const css = buildBrandStyleTag({
      logo: { url: "javascript:alert(document.cookie)" },
    });
    expect(css).not.toContain("javascript");
    expect(css).not.toContain("--brand-logo-url");
  });

  it("rejects a data: URI logo URL", () => {
    const css = buildBrandStyleTag({
      logo: { url: "data:text/html,<script>alert(1)</script>" },
    });
    expect(css).not.toContain("data:");
    expect(css).not.toContain("--brand-logo-url");
  });

  it("strips HTML/CSS special chars from logo alt text", () => {
    const css = buildBrandStyleTag({
      logo: {
        url: "https://example.com/logo.svg",
        alt: `<script>alert(1)</script> "quoted" {braces}`,
      },
    });
    expect(css).not.toContain("<script>");
    expect(css).not.toContain("{braces}");
    // alt text should be present but stripped
    expect(css).toContain("--brand-logo-alt:");
  });

  it("does not emit a logo-url for an http (non-https) URL", () => {
    const css = buildBrandStyleTag({ logo: { url: "http://example.com/logo.svg" } });
    expect(css).not.toContain("--brand-logo-url");
  });
});

// ── parseBrandSpec ────────────────────────────────────────────────────────────

describe("parseBrandSpec", () => {
  it("returns null for null input", () => {
    expect(parseBrandSpec(null)).toBeNull();
  });
  it("returns null for non-object input", () => {
    expect(parseBrandSpec("string")).toBeNull();
    expect(parseBrandSpec(42)).toBeNull();
    expect(parseBrandSpec([])).toBeNull();
  });
  it("returns the object for a valid-shaped blob", () => {
    const blob = { palette: { brand: "#ff0000" }, name: "Acme" };
    expect(parseBrandSpec(blob)).toBe(blob);
  });
});
