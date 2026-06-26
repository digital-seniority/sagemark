/**
 * constrained-edit-contract — the bounded conversational-edit contract
 * (PR 012 / P1.U.3, lane agent-ui / cross-cutting).
 *
 * THE EDIT IS BOUNDED, NOT A FREE REWRITE. A studio operator asks for a scoped
 * change: "{region}: {instruction}" — e.g. region `{ kind: "section", heading:
 * "Costs" }` + instruction "soften the cost claim". The model returns a SCOPED
 * markdown diff (the replacement text for THAT region plus a one-line summary),
 * NEVER a whole new article. This module:
 *
 *   1. defines the `{region, instruction}` request shape + the bounded-diff
 *      RESPONSE shape the model must return (`BoundedDiff`);
 *   2. RESOLVES the addressed region to an exact `[start, end)` span of the
 *      current body (so the edit window is a host-computed fact, never trusted
 *      from the model);
 *   3. APPLIES a bounded diff by splicing ONLY that span — the prose outside the
 *      region is byte-identical before/after;
 *   4. ENFORCES the bound: a model reply whose proposed replacement would change
 *      text outside the region, or which exceeds the per-edit growth ceiling, is
 *      REJECTED/CLAMPED (`EditBoundExceededError`) before anything is applied.
 *
 * WHY NOT videogen's `{op:'update',changes:{props}}`. Videogen edits a typed
 * scene-prop object (a clip's duration, a layer's color) — a structured patch
 * over a known schema. Prose has no such prop schema: the unit of a copy edit is
 * a CONTIGUOUS REGION of markdown, addressed semantically (a heading, a
 * paragraph index, an explicit char span), and the model's job is to rewrite
 * THAT REGION. So this contract is net-new: region-addressed text splice, not a
 * prop patch. (engineering-rfc.md "PR 012".)
 *
 * PURE + ISOMORPHIC: no Next APIs, no DB, no LLM call, no `server-only` marker.
 * The region resolution + bound enforcement are deterministic and unit-tested
 * with NO provider key (the live model edit is a Tier-3 NEEDS-INPUT seam — the
 * route injects an `EditModel`; this module only validates + applies its output).
 * Clean ASCII / UTF-8.
 */

import { z } from "zod";
import { createHash } from "node:crypto";

// ── The region a bounded edit addresses ───────────────────────────────────────

/**
 * The region of the body an edit is scoped to. Exactly three address modes, in
 * increasing specificity:
 *
 *   - `section`   — the markdown section under a heading (the heading line through
 *                   the line before the next same-or-higher-level heading, or EOF).
 *                   The natural unit for "tighten the Costs section".
 *   - `paragraph` — the Nth blank-line-delimited paragraph (0-based). The unit for
 *                   "rewrite the opening paragraph".
 *   - `span`      — an explicit half-open `[start, end)` character range. The unit
 *                   the studio's text-selection UI sends (the operator highlighted
 *                   exactly these chars).
 *
 * The discriminant is load-bearing: the resolver maps EACH mode to a single
 * `[start, end)` span, and the bound enforcement is "the model may only change
 * text inside that span".
 */
export const EditRegionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("section"),
      /** The heading text (without leading `#`s), matched case-insensitively. */
      heading: z.string().min(1).max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal("paragraph"),
      /** 0-based index of the blank-line-delimited paragraph. */
      index: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("span"),
      /** Half-open character range start (inclusive). */
      start: z.number().int().min(0),
      /** Half-open character range end (exclusive); must be > start. */
      end: z.number().int().min(1),
    })
    .strict(),
]);

export type EditRegion = z.infer<typeof EditRegionSchema>;

/** The conversational-edit instruction the operator typed. Bounded length. */
export const EditInstructionSchema = z.string().min(1).max(2_000);

/**
 * The full bounded-edit REQUEST. `baseVersionHash` is the SHA-256 of the body the
 * operator was looking at — the stale-edit guard (the route 409s if it does not
 * match the current persisted version's hash). Tenancy is NOT here: it is bound
 * SERVER-side by the route (criterion 7), never trusted from the request.
 */
export const ConstrainedEditRequestSchema = z
  .object({
    region: EditRegionSchema,
    instruction: EditInstructionSchema,
    /** SHA-256 (hex) of the body the client based this edit on (stale guard). */
    baseVersionHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "baseVersionHash must be a 64-char lowercase hex SHA-256"),
  })
  .strict();

export type ConstrainedEditRequest = z.infer<typeof ConstrainedEditRequestSchema>;

// ── The bounded diff the model returns ────────────────────────────────────────

/**
 * The model's reply: the replacement text for the addressed region + a one-line
 * summary of what changed. It carries NO span of its own — the host resolves the
 * span from the request region against the current body, so the model can never
 * widen the edit window by lying about coordinates. This is the bounded-diff
 * shape: scoped replacement + summary, NOT a whole-article rewrite.
 */
export const BoundedDiffSchema = z
  .object({
    /** The new markdown for the addressed region (replaces the resolved span). */
    replacement: z.string(),
    /** A one-line, human-readable summary of the change (shown in the ActivityFeed). */
    summary: z.string().min(1).max(300),
  })
  .strict();

export type BoundedDiff = z.infer<typeof BoundedDiffSchema>;

// ── Resolved span + bound-enforcement constants ───────────────────────────────

/** A resolved half-open `[start, end)` span of the body (host-computed fact). */
export interface ResolvedSpan {
  start: number;
  end: number;
  /** The current text occupying the span (what the replacement supersedes). */
  text: string;
}

/**
 * The bounded-edit growth ceiling. A bounded edit may rewrite the region, but it
 * may NOT smuggle a whole new article in through `replacement`: the replacement
 * is rejected if it exceeds `max(MIN_GROWTH_FLOOR, region_len * GROWTH_FACTOR)`
 * characters. This is the "reject/clamp an edit that exceeds the bounded region"
 * invariant in its concrete form — a scoped rewrite can reasonably grow, but a
 * 50-char region cannot legitimately balloon into a 5,000-char essay.
 */
export const GROWTH_FACTOR = 3;
/** Floor so a tiny region can still be replaced by a normal sentence (chars). */
export const MIN_GROWTH_FLOOR = 600;

/** The error thrown when a bounded edit breaks its bound (region resolution or growth). */
export class EditBoundExceededError extends Error {
  readonly code = "EDIT_BOUND_EXCEEDED" as const;
  constructor(
    readonly reason:
      | "region-not-found"
      | "region-out-of-range"
      | "replacement-too-large"
      | "empty-body",
    message: string,
  ) {
    super(message);
    this.name = "EditBoundExceededError";
  }
}

// ── SHA-256 base-version hashing (the stale-edit guard primitive) ──────────────

/**
 * The canonical SHA-256 (hex) of a body. Both the client (when it loads a piece)
 * and the host (when it checks for a stale edit) hash with THIS function, so the
 * comparison is exact. The route 409s when the request's `baseVersionHash` does
 * not equal `hashBody(currentPersistedBody)` — a no-lost-update guard.
 */
export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

// ── Region resolution (host-computed span — never trusted from the model) ──────

/**
 * Resolve an addressed region to an exact `[start, end)` span of `body`. PURE +
 * deterministic. Throws `EditBoundExceededError` when the region cannot be
 * located (a bad heading / out-of-range paragraph / out-of-bounds span) — the
 * route maps that to a 422 (the edit window is undefined, so nothing is applied).
 */
export function resolveRegion(body: string, region: EditRegion): ResolvedSpan {
  if (body.length === 0) {
    throw new EditBoundExceededError("empty-body", "cannot edit an empty body");
  }

  switch (region.kind) {
    case "span": {
      if (region.end <= region.start || region.end > body.length) {
        throw new EditBoundExceededError(
          "region-out-of-range",
          `span [${region.start}, ${region.end}) is out of range for a ${body.length}-char body`,
        );
      }
      return { start: region.start, end: region.end, text: body.slice(region.start, region.end) };
    }

    case "paragraph": {
      const span = resolveParagraphSpan(body, region.index);
      if (!span) {
        throw new EditBoundExceededError(
          "region-out-of-range",
          `paragraph index ${region.index} does not exist`,
        );
      }
      return span;
    }

    case "section": {
      const span = resolveSectionSpan(body, region.heading);
      if (!span) {
        throw new EditBoundExceededError(
          "region-not-found",
          `no markdown section with heading "${region.heading}"`,
        );
      }
      return span;
    }
  }
}

/** Resolve the Nth blank-line-delimited paragraph to a `[start, end)` span. */
function resolveParagraphSpan(body: string, index: number): ResolvedSpan | null {
  // Match paragraph blocks separated by one or more blank lines. We walk the
  // body tracking absolute offsets so the span is exact (slice round-trips).
  const blocks: Array<{ start: number; end: number }> = [];
  const re = /\n[ \t]*\n/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const end = m.index;
    if (end > cursor) blocks.push({ start: cursor, end });
    cursor = re.lastIndex;
  }
  if (cursor < body.length) blocks.push({ start: cursor, end: body.length });

  const block = blocks[index];
  if (!block) return null;
  // Trim only the trailing newline run inside the span boundary is unnecessary —
  // the block boundaries already exclude the blank-line separators.
  return { start: block.start, end: block.end, text: body.slice(block.start, block.end) };
}

/**
 * Resolve the markdown section under `heading` to a `[start, end)` span. The span
 * runs from the heading line through the line BEFORE the next heading of the same
 * or higher level (fewer/equal `#`s), or to EOF. Case-insensitive heading match.
 */
function resolveSectionSpan(body: string, heading: string): ResolvedSpan | null {
  const wanted = heading.trim().toLowerCase();
  const lines = body.split("\n");
  // Precompute the absolute start offset of each line.
  const lineStart: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineStart.push(off);
    off += line.length + 1; // + the "\n" (the last one is a virtual separator)
  }

  let headingLine = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const hm = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (hm && hm[2]!.trim().toLowerCase() === wanted) {
      headingLine = i;
      headingLevel = hm[1]!.length;
      break;
    }
  }
  if (headingLine === -1) return null;

  // Find the next heading at the same or higher level.
  let endLine = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    const hm = /^(#{1,6})\s+/.exec(lines[i]!);
    if (hm && hm[1]!.length <= headingLevel) {
      endLine = i;
      break;
    }
  }

  const start = lineStart[headingLine]!;
  // End is the start of endLine, minus the trailing newline that joins the last
  // in-section line to the next heading (so the section span does not swallow the
  // separator). When endLine === lines.length the section runs to EOF.
  const end =
    endLine < lines.length ? lineStart[endLine]! - 1 : body.length;
  const safeEnd = Math.max(start, Math.min(end, body.length));
  return { start, end: safeEnd, text: body.slice(start, safeEnd) };
}

// ── Bound enforcement + application (the splice) ───────────────────────────────

/** The growth ceiling (chars) a replacement for `spanLen` chars may not exceed. */
export function growthCeiling(spanLen: number): number {
  return Math.max(MIN_GROWTH_FLOOR, spanLen * GROWTH_FACTOR);
}

/**
 * Validate a bounded diff against its resolved span WITHOUT applying it. Throws
 * `EditBoundExceededError("replacement-too-large")` when the replacement exceeds
 * the growth ceiling for the region (the "reject an edit that exceeds the bounded
 * region" guard). Returns silently when the diff is within bounds.
 */
export function assertWithinBound(diff: BoundedDiff, span: ResolvedSpan): void {
  const ceiling = growthCeiling(span.end - span.start);
  if (diff.replacement.length > ceiling) {
    throw new EditBoundExceededError(
      "replacement-too-large",
      `replacement (${diff.replacement.length} chars) exceeds the bounded-region ceiling ` +
        `(${ceiling}) for a ${span.end - span.start}-char region — a bounded edit is not a free rewrite`,
    );
  }
}

/** The result of applying a bounded edit: the new body + the span that changed. */
export interface AppliedEdit {
  /** The new body — identical to the old EXCEPT the spliced region. */
  body: string;
  /** The span (in the ORIGINAL body) that was replaced. */
  replacedSpan: ResolvedSpan;
  /** The new body's SHA-256 (the next version's base hash). */
  newHash: string;
  /** The model's one-line change summary (for the ActivityFeed). */
  summary: string;
}

/**
 * Apply a bounded diff to `body` by splicing ONLY the resolved span. The text
 * before `span.start` and after `span.end` is byte-identical in the result — the
 * structural proof that the edit is bounded (a free rewrite would change text
 * outside the region; this splice provably cannot). Throws if the diff breaks its
 * bound.
 *
 * @returns the new body + the replaced span + the new SHA-256 + the summary.
 */
export function applyBoundedEdit(
  body: string,
  region: EditRegion,
  diff: BoundedDiff,
): AppliedEdit {
  const span = resolveRegion(body, region);
  assertWithinBound(diff, span);

  const before = body.slice(0, span.start);
  const after = body.slice(span.end);
  const newBody = before + diff.replacement + after;

  // Structural bound proof (defense in depth): the prose outside the span is
  // identical. A splice cannot violate this, but assert it so any future refactor
  // that breaks boundedness fails loudly rather than silently widening the edit.
  if (newBody.slice(0, span.start) !== before) {
    throw new EditBoundExceededError(
      "replacement-too-large",
      "bounded edit changed text BEFORE the region — refusing to apply",
    );
  }
  if (newBody.slice(span.start + diff.replacement.length) !== after) {
    throw new EditBoundExceededError(
      "replacement-too-large",
      "bounded edit changed text AFTER the region — refusing to apply",
    );
  }

  return {
    body: newBody,
    replacedSpan: span,
    newHash: hashBody(newBody),
    summary: diff.summary,
  };
}
