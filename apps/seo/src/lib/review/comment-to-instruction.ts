/**
 * comment-to-instruction — map a client "Request changes" comment into a BOUNDED
 * `/api/edit` instruction (PR 019 / P1.C.2, lane client-review).
 *
 * THE ROUTING SEAM. A client leaves a `request-changes` `comment_threads` row on
 * the tokenized review surface (PR 018): a free-text body plus an OPTIONAL anchor
 * carrying an `elementHint` (the best-effort selector/heading the client clicked)
 * and normalized 0..1 coords. PR 012's `/api/edit` does NOT take "a comment" — it
 * takes a SCOPED region (`section` / `paragraph` / `span`) + a bounded instruction.
 * This module is the PURE, host-side adapter between the two:
 *
 *   - The REGION is resolved from the comment's anchor `elementHint` when it names
 *     a section heading; otherwise the operator MUST supply an explicit region at
 *     triage time (the comment alone does not address a span). We NEVER fabricate
 *     a span from raw 0..1 coords — pixel coords are not a character range, and a
 *     guessed span would let a client instruction silently rewrite the wrong text.
 *   - The INSTRUCTION is the comment body, prefixed with a fixed, host-authored
 *     framing that marks it as a CLIENT REQUEST (advisory) — never an authority to
 *     bypass the gate. The gate re-runs host-side on the edited body regardless
 *     (PR 012 §7), so this framing is purely descriptive.
 *
 * BOUND-PRESERVING: the produced region is the SAME `EditRegion` discriminated
 * union `/api/edit` validates; an oversized/empty body is rejected downstream by
 * the edit route's resolver — this module only SHAPES the request, it never
 * widens the edit window.
 *
 * PURE: no Next APIs, no DB, no LLM, no `server-only` marker — fully unit-testable.
 * Clean ASCII / UTF-8.
 */

import {
  EditInstructionSchema,
  type EditRegion,
} from "@/lib/edit/constrained-edit-contract";

/** A `request-changes` comment as read from a `comment_threads` row (the subset). */
export interface RequestChangesComment {
  /** The comment kind — MUST be `request-changes` (a pin/section-approve is not routable). */
  kind: string;
  /** The free-text change request the client typed. */
  body: string;
  /** The normalized pin anchor (elementHint + 0..1 coords), or null for a bare section verb. */
  anchor: { x?: number; y?: number; elementHint?: string } | null;
}

/** The operator's triage decision — an EXPLICIT region override when the comment
 * does not (or cannot) self-address a section. The operator is the only actor that
 * can scope a span; a client comment never picks a `span` itself. */
export type TriageRegion =
  | { kind: "section"; heading: string }
  | { kind: "paragraph"; index: number }
  | { kind: "span"; start: number; end: number };

/** The bounded-edit request fragment this module produces (region + instruction). */
export interface RoutedEditInstruction {
  region: EditRegion;
  instruction: string;
}

/** Why a comment cannot be routed to a bounded edit (stable, never prose). */
export type CommentRoutingError =
  | "not-request-changes" // a pin / section-approve is not a change request
  | "empty-body" // no instruction text to act on
  | "no-region"; // no section anchor AND no operator-supplied region

export type CommentRoutingResult =
  | { ok: true; routed: RoutedEditInstruction }
  | { ok: false; reason: CommentRoutingError };

/**
 * The fixed, host-authored framing prefix. Marks the instruction as a CLIENT
 * REQUEST so the bounded-edit model treats it as advisory copy guidance — it is
 * NOT an authority to relax faithfulness/YMYL (the gate re-runs host-side on the
 * edited body regardless). Kept short so it does not crowd the bounded instruction.
 */
export const CLIENT_REQUEST_FRAMING =
  "Client review request (advisory; the content gate still applies): ";

/**
 * Extract a section heading from a comment's `elementHint`. The review pin's
 * elementHint is a best-effort selector/data-key (e.g. `section#costs h2`, or a
 * raw heading text). We recognize ONLY an explicit heading hint of the form
 * `heading:<text>` and return its text; anything else yields null (the operator
 * must scope it). This is deliberately conservative: a wrong auto-resolution would
 * let a client comment rewrite the wrong section.
 */
export function headingFromElementHint(elementHint: string | undefined): string | null {
  if (!elementHint || typeof elementHint !== "string") return null;
  const trimmed = elementHint.trim();
  if (trimmed.length === 0) return null;
  // Explicit `heading:Some Heading` convention emitted by the review UI when the
  // clicked element is (or is inside) a heading.
  const m = /^heading:\s*(.+)$/i.exec(trimmed);
  if (m && m[1]) {
    const heading = m[1].trim();
    return heading.length > 0 ? heading.slice(0, 300) : null;
  }
  return null;
}

/**
 * Map a `request-changes` comment (+ optional operator-supplied region) into a
 * bounded `/api/edit` `{ region, instruction }`.
 *
 * Region resolution (in priority order):
 *   1. an EXPLICIT operator-supplied `triageRegion` (the operator scoped it), else
 *   2. a `section` region derived from the comment anchor's `elementHint`
 *      (`heading:<text>`), else
 *   3. `no-region` — the comment did not self-address a section and the operator
 *      did not supply one (a comment alone cannot pick a character span).
 *
 * The instruction is the comment body (trimmed, framed, length-bounded to the same
 * 2000-char ceiling `/api/edit` enforces — an over-long body is truncated, never
 * rejected, so a verbose client note still routes).
 */
export function commentToInstruction(
  comment: RequestChangesComment,
  triageRegion?: TriageRegion,
): CommentRoutingResult {
  if (comment.kind !== "request-changes") {
    return { ok: false, reason: "not-request-changes" };
  }

  const bodyText = (comment.body ?? "").trim();
  if (bodyText.length === 0) {
    return { ok: false, reason: "empty-body" };
  }

  // 1. Resolve the region — operator override wins; else derive a section from the
  //    anchor's elementHint; else fail (no-region — the operator must scope it).
  let region: EditRegion | null = null;
  if (triageRegion) {
    region = triageRegion;
  } else {
    const heading = headingFromElementHint(comment.anchor?.elementHint);
    if (heading) {
      region = { kind: "section", heading };
    }
  }
  if (!region) {
    return { ok: false, reason: "no-region" };
  }

  // 2. Frame + bound the instruction. The 2000-char ceiling mirrors
  //    EditInstructionSchema; we TRUNCATE the framed instruction to fit so a long
  //    client note still routes (the schema would otherwise reject it).
  const framed = CLIENT_REQUEST_FRAMING + bodyText;
  const instruction = framed.slice(0, 2_000);

  // Defensive: the produced instruction MUST satisfy the edit route's schema (it
  // can fail only if the truncation produced an empty string, which the non-empty
  // bodyText guard above already precludes — but we assert it, never fabricate).
  const valid = EditInstructionSchema.safeParse(instruction);
  if (!valid.success) {
    return { ok: false, reason: "empty-body" };
  }

  return { ok: true, routed: { region, instruction } };
}
