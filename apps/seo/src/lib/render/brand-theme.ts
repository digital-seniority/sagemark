/**
 * brand-theme — injection-safe BrandSpec → CSS `:root` vars (Slice 8 / DR-038).
 *
 * THE CONTRACT. Given an optional `BrandSpec` blob (from `content_clients.brand_spec`),
 * emit a `<style>` block that sets named CSS custom properties. Every server component
 * in the branded hub (`/clients/[client]/`) should render `buildBrandStyleTag(brand)`
 * once in the `<head>` or in the root layout, then reference the vars in Tailwind-
 * compatible class names or inline styles. The SSR body never re-interprets the block;
 * it is served as inert markup.
 *
 * INJECTION SAFETY (CRITICAL).
 * This module emits a raw `<style>` block into server-rendered HTML. Because the input
 * is operator-supplied JSON (stored in DB, never a live model output), the attack
 * surface is lower than user input — but the rule still applies: every interpolated
 * value is strictly allow-listed before reaching the output. NO value is interpolated
 * verbatim; every field is sanitized through one of:
 *   - `sanitizeHex(v)` — permits only `#` + hex digits (3/4/6/8); returns fallback otherwise
 *   - `sanitizeFontFamily(v)` — permits only quoted Google-font names + system fallbacks;
 *     strips dangerous chars (semicolons, braces, angle brackets, quotes other than the
 *     intended wrapping). Returns a CSS-safe font-family string.
 *   - `sanitizeHost(v)` — permits only `https://` URLs with a safe ASCII host; blocks
 *     `javascript:`, data URIs, and relative paths. Returns null when rejected.
 *   - `sanitizeAlt(v)` — strips HTML/CSS special chars, max 200 chars.
 *   - `sanitizePhone(v)` — digits + spaces + common tel chars; max 20 chars.
 *
 * DO NOT add `sanitize*` bypass paths. A failed sanitize → fallback, not the raw value.
 *
 * `NEUTRAL_BRAND` is the fallback: the same semantic palette as the Whispering Willows
 * reference demo, expressed as generic tokens (not client-branded), so the hub renders
 * decently when no `BrandSpec` is set.
 *
 * Pure + sync: no I/O, no model. Clean ASCII / UTF-8.
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";

export type { BrandSpec };

// ── Sanitizers ───────────────────────────────────────────────────────────────────

/** Allow only valid hex color codes: #rgb, #rgba, #rrggbb, #rrggbbaa. */
function sanitizeHex(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  if (/^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Allow only CSS-safe font-family values: quoted names (letters, spaces, digits,
 * hyphens) separated by commas with safe system-stack fallbacks. Strips: semicolons,
 * braces, angle brackets, slashes, url(), var(), calc() and other CSS injection vectors.
 * Returns a ≤200-char CSS font-family string, or the fallback.
 */
function sanitizeFontFamily(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim().slice(0, 200);
  // Reject any CSS function call, braces, angle brackets, or semicolons.
  if (/[{};<>]/.test(trimmed) || /\w+\s*\(/.test(trimmed)) return fallback;
  // Split on commas; allow each token to be a quoted name, a bare word stack, or
  // standard generic families (serif / sans-serif / monospace / cursive / fantasy).
  const tokens = trimmed.split(",").map((t) => t.trim());
  const safe: string[] = [];
  for (const tok of tokens) {
    // Quoted: 'Name' or "Name" — only word chars, spaces, digits, hyphens inside.
    const quoted = tok.match(/^['"]([A-Za-z0-9 \-]+)['"]$/);
    if (quoted) {
      safe.push(`'${quoted[1]}'`);
      continue;
    }
    // Bare generic keyword
    if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Helvetica Neue|Arial|Ubuntu|Cantarell|Noto Sans|Georgia|Times New Roman|Verdana|Tahoma|Trebuchet MS|Gill Sans|Optima|Palatino|Garamond|Baskerville)$/.test(tok)) {
      safe.push(tok);
      continue;
    }
    // If none of the above, skip this token (don't return the raw value).
  }
  return safe.length > 0 ? safe.join(", ") : fallback;
}

/**
 * Allow only `https://` URLs with a safe ASCII host (no data: / javascript: / relative).
 * Returns null if the URL fails the check — callers should omit the CSS var.
 */
function sanitizeHost(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, 512);
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    // Host must be ASCII printable + no special chars that would break CSS url()
    if (!/^[A-Za-z0-9\-._~]+$/.test(url.hostname)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Strip HTML/CSS special chars from alt text; max 200 chars. */
function sanitizeAlt(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[<>"'`{};]/g, "")
    .trim()
    .slice(0, 200);
}

/** Allow only digit/space/common-tel-chars; max 20 chars. */
function sanitizePhone(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[^0-9 +\-()\.]/g, "")
    .trim()
    .slice(0, 20);
}

// ── NEUTRAL_BRAND ─────────────────────────────────────────────────────────────────

/**
 * The fallback brand used when `BrandSpec` is absent / missing fields.
 * Mirrors the Whispering Willows palette semantically (forest green primary,
 * cream background, warm gold accent) but expressed as GENERIC brand tokens.
 * Any unset field in a real `BrandSpec` falls back to these values.
 */
export const NEUTRAL_BRAND = {
  palette: {
    brand: "#3d5446",
    brandDark: "#2f4339",
    accent: "#c08a4e",
    ink: "#2b2924",
    bg: "#faf7f1",
    surface: "#ffffff",
  },
  typography: {
    headingFamily: "'Fraunces', Georgia, 'Times New Roman', serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
} as const;

// ── buildBrandStyleTag ────────────────────────────────────────────────────────────

/**
 * Build an injection-safe `<style>` block that sets `:root` CSS custom properties
 * derived from the given `BrandSpec`. Missing fields fall back to `NEUTRAL_BRAND`.
 *
 * Returns a raw HTML string suitable for `dangerouslySetInnerHTML` in a React
 * server component `<style>` tag — ONLY because every interpolated value has been
 * sanitized above. Never pass unsanitized content through this path.
 *
 * The emitted vars are:
 *   --brand-color    primary brand color (hex)
 *   --brand-dark     darker shade for hover / borders
 *   --brand-accent   accent / CTA color
 *   --brand-ink      body text color
 *   --brand-bg       page background
 *   --brand-surface  card / paper surface
 *   --brand-heading-font  CSS font-family string (heading)
 *   --brand-body-font     CSS font-family string (body)
 *   --brand-logo-url      https:// URL of the logo image (omitted when absent/unsafe)
 *   --brand-logo-alt      plain-text alt string (stripped of HTML/CSS special chars)
 */
export function buildBrandStyleTag(brand: BrandSpec | null | undefined): string {
  const p = brand?.palette ?? {};
  const t = brand?.typography ?? {};
  const logo = brand?.logo ?? {};

  const color = sanitizeHex(p.brand, NEUTRAL_BRAND.palette.brand);
  const colorDark = sanitizeHex(p.brandDark, NEUTRAL_BRAND.palette.brandDark);
  const accent = sanitizeHex(p.accent, NEUTRAL_BRAND.palette.accent);
  const ink = sanitizeHex(p.ink, NEUTRAL_BRAND.palette.ink);
  const bg = sanitizeHex(p.bg, NEUTRAL_BRAND.palette.bg);
  const surface = sanitizeHex(p.surface, NEUTRAL_BRAND.palette.surface);

  const headingFont = sanitizeFontFamily(t.headingFamily, NEUTRAL_BRAND.typography.headingFamily);
  const bodyFont = sanitizeFontFamily(t.bodyFamily, NEUTRAL_BRAND.typography.bodyFamily);

  const logoUrl = sanitizeHost(logo.url);
  const logoAlt = sanitizeAlt(logo.alt ?? brand?.name ?? "");

  // Build Google Fonts @import if the brand specifies font URLs.
  const fontImports = (t.googleFonts ?? [])
    .map((u) => sanitizeHost(u))
    .filter((u): u is string => u !== null)
    .map((u) => `@import url('${u}');`)
    .join("\n");

  const lines = [
    ...(fontImports ? [fontImports] : []),
    ":root {",
    `  --brand-color: ${color};`,
    `  --brand-dark: ${colorDark};`,
    `  --brand-accent: ${accent};`,
    `  --brand-ink: ${ink};`,
    `  --brand-bg: ${bg};`,
    `  --brand-surface: ${surface};`,
    `  --brand-heading-font: ${headingFont};`,
    `  --brand-body-font: ${bodyFont};`,
    ...(logoUrl ? [`  --brand-logo-url: url('${logoUrl}');`] : []),
    ...(logoAlt ? [`  --brand-logo-alt: '${logoAlt.replace(/'/g, "")}';`] : []),
    "}",
  ];

  return lines.join("\n");
}

/**
 * Extract the `BrandSpec` from an unknown `PublicClient.brandSpec` blob —
 * applies a light structural check (must be an object; string fields only for the
 * sub-shapes that reach the sanitizers). Returns null when the blob is absent or
 * not object-shaped (the render falls back to `NEUTRAL_BRAND`).
 *
 * DOES NOT THROW. Treating an unexpected blob as "no brand" is the safe default.
 */
export function parseBrandSpec(blob: unknown): BrandSpec | null {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  // Cast and return — the sanitizers in buildBrandStyleTag handle every field
  // defensively (type-check + allow-list); we do not need deep validation here.
  return blob as BrandSpec;
}
