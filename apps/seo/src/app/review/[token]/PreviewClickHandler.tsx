"use client";

/**
 * PreviewClickHandler — invisible click-capture layer over the review preview
 * (PR 018 / P1.C.1, lane client-review).
 *
 * PORTED from flywheel-main
 * `apps/agents/src/components/videogen/canvas/PreviewClickHandler.tsx` (DR-001),
 * adapted to apps/seo (drops the videogen "pause-first" framing — a static SSR
 * hub has no playback to pause — to a "comment-mode-first" gate: a click while
 * not in comment mode arms it; the next click drops a pin). Colors are
 * token-driven (`ring-foreground/40`), no hardcoded hue.
 *
 * The capture layer is `role="button"` + `tabIndex={0}` so keyboard users get
 * the same affordance: Enter/Space arm comment mode, then drop a center pin
 * (no coord from a keypress). Esc bubbles to the parent's clear-pin policy.
 *
 * Coord normalization: `getBoundingClientRect()` of the layer (sized to the
 * preview frame); `(clientX - rect.left) / rect.width` → x∈[0,1], clamped.
 *
 * No timers, no random (frame-deterministic).
 */

import React, { useCallback, useRef, useState } from "react";

import { PinOverlay } from "./PinOverlay";
import {
  useIframePinDrop,
  type PinDropPayload,
} from "./hooks/useIframePinDrop";

export interface PreviewClickHandlerProps {
  /**
   * Called the first time the user clicks/keys onto the preview while NOT in
   * comment mode. The parent flips comment mode on (and may echo it back via
   * `externalArmed`).
   */
  onArmRequest: () => void;
  /** Called on the next interaction; coords are normalized to [0,1]. */
  onPinDrop: (pin: { x: number; y: number }) => void;
  /**
   * Whether the layer should treat the next click as a "drop pin" interaction.
   * Production callers wire this to the parent's comment-mode state; the layer
   * also keeps a local latch so the arm-first contract holds without it.
   */
  externalArmed?: boolean;
  /** Children = the preview iframe (visually beneath, click-wise above us). */
  children?: React.ReactNode;
}

export function PreviewClickHandler({
  onArmRequest,
  onPinDrop,
  externalArmed,
  children,
}: PreviewClickHandlerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [localArmed, setLocalArmed] = useState(false);

  const isArmed = Boolean(externalArmed) || localArmed;

  const dropPin = useCallback(
    (clientX: number, clientY: number) => {
      const rect = layerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        // Defensive: degenerate layout → center pin so the user still sees feedback.
        onPinDrop({ x: 0.5, y: 0.5 });
        return;
      }
      const x = clamp01((clientX - rect.left) / rect.width);
      const y = clamp01((clientY - rect.top) / rect.height);
      onPinDrop({ x, y });
    },
    [onPinDrop],
  );

  const handleActivate = useCallback(
    (kind: "pointer" | "keyboard", clientX?: number, clientY?: number) => {
      if (!isArmed) {
        setLocalArmed(true);
        onArmRequest();
        return;
      }
      if (kind === "pointer" && clientX !== undefined && clientY !== undefined) {
        dropPin(clientX, clientY);
      } else {
        const rect = layerRef.current?.getBoundingClientRect();
        if (rect) {
          dropPin(rect.left + rect.width / 2, rect.top + rect.height / 2);
        } else {
          onPinDrop({ x: 0.5, y: 0.5 });
        }
      }
    },
    [isArmed, dropPin, onArmRequest, onPinDrop],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleActivate("pointer", e.clientX, e.clientY);
    },
    [handleActivate],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        handleActivate("keyboard");
      }
      // Esc is intentionally not handled here — the parent owns "clear pin".
    },
    [handleActivate],
  );

  return (
    <div
      ref={layerRef}
      data-testid="review-preview-click-handler"
      data-armed={isArmed ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-label={
        isArmed
          ? "Click to drop a comment pin on the preview"
          : "Click to start commenting on the preview"
      }
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="absolute inset-0 cursor-crosshair focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      {children}
    </div>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ───────────────────────────────────────────────────────────────────────────
// ReviewPinCanvas — the interactive client island for the /review page.
//
// Composes the reused primitives (PinOverlay + PreviewClickHandler +
// useIframePinDrop) over the SAME-ORIGIN, SANDBOXED iframe that renders the REAL
// SSR hub (the existing `/clients/[client]/blog/[slug]` render route — NOT a
// forked renderer). Owns the pin state and posts a persisted pin comment to
// `/api/review/comments` scoped by the OPAQUE TOKEN ONLY (no tenancy fields).
//
// A drop can arrive two ways, both normalized to [0,1]:
//   - a click on the capture layer (PreviewClickHandler), or
//   - a validated `seo-pin-drop` postMessage from inside the iframe
//     (useIframePinDrop — strict origin/source/type/finite-coord checks).
// The persisted pin carries the normalized anchor + elementHint + the
// version_left_on (recorded server-side from the token's tuple).
// ───────────────────────────────────────────────────────────────────────────

export interface ReviewPinCanvasProps {
  /** The opaque review token (sent as-is to the comments API). */
  token: string;
  /** Same-origin src for the iframe (the existing SSR hub render route). */
  previewSrc: string;
  /** The reviewing client contact (persisted as the comment author). */
  author: string;
  /** Injected POST fn (tests pass a spy). Returns the created pin id or null. */
  submitPin?: (input: {
    token: string;
    kind: "pin";
    anchor: { x: number; y: number; elementHint?: string };
    body: string;
    author: string;
  }) => Promise<{ id: string } | null>;
}

async function defaultSubmitPin(input: {
  token: string;
  kind: "pin";
  anchor: { x: number; y: number; elementHint?: string };
  body: string;
  author: string;
}): Promise<{ id: string } | null> {
  const res = await fetch("/api/review/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string };
}

export function ReviewPinCanvas({
  token,
  previewSrc,
  author,
  submitPin = defaultSubmitPin,
}: ReviewPinCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [pin, setPin] = useState<{
    x: number;
    y: number;
    elementHint?: string;
  } | null>(null);

  const persistPin = useCallback(
    (next: { x: number; y: number; elementHint?: string }) => {
      setPin(next);
      // Fire-and-forget persist; the server re-validates the anchor + binds
      // tenancy from the token. Errors leave the visual pin in place.
      void submitPin({
        token,
        kind: "pin",
        anchor: next,
        body: "",
        author,
      });
    },
    [submitPin, token, author],
  );

  // Pins dropped from inside the iframe (validated postMessage).
  useIframePinDrop({
    iframeRef,
    onPin: (p: PinDropPayload) =>
      persistPin({ x: p.x, y: p.y, elementHint: p.elementHint }),
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <PreviewClickHandler
        onArmRequest={() => {
          /* arming handled by the layer's local latch */
        }}
        onPinDrop={(p) => persistPin({ x: p.x, y: p.y })}
      >
        {/* The REAL hub, same-origin + sandboxed (allow-scripts allow-same-origin
            so the pin-drop postMessage fires; no allow-forms/allow-popups). */}
        <iframe
          ref={iframeRef}
          data-testid="review-preview-iframe"
          src={previewSrc}
          title="Content review preview"
          sandbox="allow-scripts allow-same-origin"
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </PreviewClickHandler>
      <PinOverlay pin={pin} label={pin ? "Comment" : undefined} />
    </div>
  );
}
