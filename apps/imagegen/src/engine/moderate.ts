/**
 * ImageGen — Pre-spend moderation + typed refusal (`imagegen/1`).
 *
 * PORTED ~verbatim from flywheel-main `packages/videogen/imagegen/moderate.ts`.
 *
 * Two safety pieces (audit A11; ImageGen Bible ch.10):
 *
 *  1. PRE-SPEND prompt moderation — gate the prompt BEFORE the paid generate
 *     call, never after. Ships a conservative local deny-list as the default
 *     `PromptModerator`; the interface is injected so a real moderation-model
 *     call (e.g. OpenAI omni-moderation via the gateway) can swap in without
 *     touching callers.
 *
 *  2. TYPED REFUSAL classification — a provider refusal is NOT a generic error.
 *     A content-policy block is NON-RETRIABLE (retrying burns money at 0%
 *     success); a transient/rate-limit error IS retriable.
 */

// ── Pre-spend moderation ────────────────────────────────────────────

export interface ModerationVerdict {
  allowed: boolean;
  /** When blocked: a short machine reason (logged, not user-facing verbatim). */
  reason?: string;
}

export interface PromptModerator {
  moderate(prompt: string): Promise<ModerationVerdict>;
}

/**
 * Conservative local moderator (default). Blocks a small, high-precision
 * deny-list — it is a FLOOR, not a real classifier. SEO hero/photo images are
 * low-risk (no faces/text requested), so the floor mostly guards against
 * egregiously unsafe seed concepts leaking in.
 */
export function makeLocalPromptModerator(): PromptModerator {
  const denyPatterns: RegExp[] = [
    /\bchild\b[^.]*\b(sexual|nude|explicit)\b/i,
    /\bcsam\b/i,
    /\b(gore|beheading|dismember)/i,
    /\bnonconsensual\b/i,
  ];
  return {
    async moderate(prompt: string): Promise<ModerationVerdict> {
      for (const re of denyPatterns) {
        if (re.test(prompt)) {
          return { allowed: false, reason: "local-denylist" };
        }
      }
      return { allowed: true };
    },
  };
}

// ── Typed refusal / error classification ────────────────────────────

export type GenerationErrorClass =
  | "content_policy" // provider refused on policy — NON-retriable
  | "rate_limit" // throttled — retriable after backoff
  | "transient" // 5xx / network — retriable
  | "unknown"; // anything else — treat as non-retriable to be safe

/** Whether a class is worth retrying. content_policy + unknown are NOT. */
export function isRetriable(cls: GenerationErrorClass): boolean {
  return cls === "rate_limit" || cls === "transient";
}

/**
 * Classify a thrown generation error. Reads HTTP status + message heuristics
 * (the AI SDK surfaces `statusCode`/`status` on provider errors). Conservative:
 * unknown → non-retriable, so we never grind money on an unclassified failure.
 */
export function classifyProviderError(err: unknown): GenerationErrorClass {
  const status = readStatus(err);
  const msg = (
    err instanceof Error ? err.message : String(err ?? "")
  ).toLowerCase();

  if (
    status === 400 ||
    status === 422 ||
    /content[_ -]?policy|moderation|safety|nsfw|blocked|refus/.test(msg)
  ) {
    return "content_policy";
  }
  if (status === 429 || /rate.?limit|too many requests/.test(msg)) {
    return "rate_limit";
  }
  if (
    (status !== undefined && status >= 500) ||
    /timeout|econn|network|fetch failed|503|502/.test(msg)
  ) {
    return "transient";
  }
  return "unknown";
}

function readStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    for (const k of ["statusCode", "status", "code"]) {
      const v = e[k];
      if (typeof v === "number") return v;
    }
  }
  return undefined;
}
