"use client";

/**
 * useIframePinDrop — receive pin-drop selection events from the same-origin,
 * sandboxed review iframe and forward them to the parent's pin-comment system
 * (PR 018 / P1.C.1, lane client-review).
 *
 * PORTED from flywheel-main
 * `apps/agents/src/components/videogen/canvas/hooks/useIframePinDrop.ts` (DR-001),
 * adapted to the SEO client-review surface: the message `type` is
 * `"seo-pin-drop"` and the normalized payload carries the iframe-reported
 * `elementHint` (the element-anchored requirement of AC#3) rather than the
 * videogen chapter/step fields.
 *
 * Protocol:
 *   Sender (inside the iframe, injected by the review route):
 *     window.parent.postMessage({
 *       type: "seo-pin-drop",
 *       x: <doc-relative click x in CSS px>,
 *       y: <doc-relative click y in CSS px>,
 *       docWidth:  <document client width in px>,
 *       docHeight: <document client height in px>,
 *       elementHint: <best-effort selector/data-key of the clicked element>,
 *     }, window.location.origin);
 *
 *   Receiver (this hook, on the parent), four STRICT checks:
 *     1. event.origin === window.location.origin            (no foreign origin)
 *     2. event.source === iframeRef.current?.contentWindow  (no sibling iframe)
 *     3. event.data?.type === "seo-pin-drop"                (no devtools/HMR)
 *     4. coords are FINITE numbers                          (no junk)
 *
 *   Normalization: the sender reports document-relative pixels + the doc
 *   width/height; the receiver normalizes to [0,1] and clamps. More stable than
 *   the iframe element's bounding rect (the iframe can scale visually
 *   independent of its document size).
 *
 * SECURITY: same-origin allowlist + source-window check + type check; never reads
 * `event.data` blindly (pulls only the typed fields, bails on anything
 * malformed). NO tenancy field (workspace_id/client_id/version) is read or
 * trusted from the iframe — the parent reconciles the pin against its own
 * token-resolved scope, and the server re-validates on persist.
 */

import { useEffect } from "react";

/** Wire-format payload sent by the iframe. */
export interface IframePinDropMessage {
  type: "seo-pin-drop";
  /** Document-relative click x in CSS pixels. */
  x: number;
  /** Document-relative click y in CSS pixels. */
  y: number;
  /** Iframe document's `documentElement.clientWidth` at send time. */
  docWidth: number;
  /** Iframe document's `documentElement.clientHeight` at send time. */
  docHeight: number;
  /** Best-effort selector or data-key of the clicked element (element anchor). */
  elementHint?: string;
}

/** Normalized payload handed to the parent (coords in [0,1]). */
export interface PinDropPayload {
  /** x normalized to [0, 1] of the iframe document. */
  x: number;
  /** y normalized to [0, 1] of the iframe document. */
  y: number;
  /** Best-effort selector / data-key hint (the element anchor). */
  elementHint?: string;
}

export interface UseIframePinDropOptions {
  /** Ref to the iframe element we accept events from. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /**
   * Called once per VALID pin-drop event. Coords are normalized to [0, 1]. The
   * parent maps this to its pin-comment data model + the POST /api/review/comments.
   */
  onPin: (pin: PinDropPayload) => void;
  /**
   * When false the listener is not installed (stable hook order). Defaults true.
   */
  enabled?: boolean;
}

export const PIN_DROP_MESSAGE_TYPE = "seo-pin-drop" as const;

/**
 * Validate + normalize an incoming message payload. Exported for unit tests so
 * the normalization can be exercised without a DOM listener. Returns null on a
 * malformed payload; never throws.
 */
export function normalizeIframePinDropMessage(
  raw: unknown,
): PinDropPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== PIN_DROP_MESSAGE_TYPE) return null;

  const x = numberOrNull(r.x);
  const y = numberOrNull(r.y);
  const dw = numberOrNull(r.docWidth);
  const dh = numberOrNull(r.docHeight);
  if (x === null || y === null || dw === null || dh === null) return null;
  if (dw <= 0 || dh <= 0) return null;

  const elementHint =
    typeof r.elementHint === "string" && r.elementHint.length > 0
      ? r.elementHint
      : undefined;

  return {
    x: clamp01(x / dw),
    y: clamp01(y / dh),
    elementHint,
  };
}

/**
 * React hook: while mounted, listens for `seo-pin-drop` postMessage events from
 * the iframe ref'd by `iframeRef`, and calls `onPin` with the normalized payload
 * on each ACCEPTED message. The listener is on `window` (the iframe sandbox is
 * `allow-scripts allow-same-origin` so the message fires on `window`).
 */
export function useIframePinDrop({
  iframeRef,
  onPin,
  enabled = true,
}: UseIframePinDropOptions): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    function handler(event: MessageEvent) {
      // 1. Strict origin allowlist — only same-origin events accepted.
      if (event.origin !== window.location.origin) return;
      // 2. Strict source check — only THIS iframe's contentWindow.
      const expectedSource = iframeRef.current?.contentWindow ?? null;
      if (!expectedSource || event.source !== expectedSource) return;
      // 3. + 4. Type check + finite-coord normalization.
      const normalized = normalizeIframePinDropMessage(event.data);
      if (!normalized) return;
      onPin(normalized);
    }

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [iframeRef, onPin, enabled]);
}

function numberOrNull(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (!Number.isFinite(n)) return null;
  return n;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
