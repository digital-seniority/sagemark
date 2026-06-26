"use client";

/**
 * PinOverlay — absolutely positioned overlay above the review preview frame that
 * paints the drop pin (PR 018 / P1.C.1, lane client-review).
 *
 * PORTED from flywheel-main
 * `apps/agents/src/components/videogen/canvas/PinOverlay.tsx` (DR-001), adapted
 * to apps/seo: the hardcoded videogen amber (`rgb(245,158,11)` / `#0b0f17`) is
 * replaced by the brand THEME TOKENS — the marker/label/connector are driven by
 * `--foreground` / `--background` (globals.css) via CSS variables, so no
 * hardcoded color survives the port.
 *
 * Coords come in normalized (0..1) so the overlay stays correct across aspect
 * ratios + CSS resize without observing layout. Render contract:
 *   - `pin === null` → render nothing (overlay collapses out of the a11y tree).
 *   - `pointer-events: none` so the overlay never blocks the click-capture layer
 *     below it; only the marker is in the a11y tree (role="img" + aria-label).
 *
 * No timers, no randoms, no Date.now (paints what it's told).
 */

import React from "react";

export interface PinOverlayProps {
  /** Normalized pin coords, or `null` when no pin is dropped. */
  pin: { x: number; y: number } | null;
  /** Optional callout text. When present a label is painted above the marker. */
  label?: string;
}

export function PinOverlay({ pin, label }: PinOverlayProps) {
  if (!pin) return null;

  const xPct = `${clamp01(pin.x) * 100}%`;
  const yPct = `${clamp01(pin.y) * 100}%`;

  return (
    <div
      data-testid="pin-overlay"
      aria-hidden="false"
      className="pointer-events-none absolute inset-0"
    >
      <div
        data-testid="pin-marker"
        role="img"
        aria-label="Pin on review preview"
        style={{
          position: "absolute",
          left: xPct,
          top: yPct,
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Connector line from the dot up to the callout label (token-driven). */}
        {label ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              bottom: "100%",
              width: 1,
              height: 24,
              transform: "translateX(-50%)",
              backgroundColor: "var(--foreground)",
              opacity: 0.85,
            }}
          />
        ) : null}

        {/* Callout label — brand foreground bg / background text (tokens). */}
        {label ? (
          <div
            data-testid="pin-label"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              bottom: "calc(100% + 24px)",
              transform: "translateX(-50%)",
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: "var(--foreground)",
              color: "var(--background)",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        ) : null}

        {/* Pin dot — token-driven fill + ring. */}
        <div
          data-testid="pin-dot"
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: "var(--foreground)",
            border: "2px solid var(--background)",
            boxShadow: "0 0 0 2px var(--foreground)",
          }}
        />
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
