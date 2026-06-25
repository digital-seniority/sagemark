/**
 * Brand voice gate for ContentEngine (`content-engine/1.0`).
 *
 * After a draft is generated and faithfulness-checked, this gate runs a
 * second LLM pass that checks the article against the brand style guide
 * (brandMd). It provides section-level feedback on tone, prohibited terms,
 * marketing-speak, and audience fit.
 *
 * Independence note: we use claude-haiku-4-5 (smaller / faster) rather than
 * the draft model (claude-sonnet-4.5). Tone/language pattern checking does not
 * require the same reasoning depth as generation. This also differs from the
 * faithfulness gate which uses haiku for factual verification — same model,
 * different task and prompt.
 *
 * Safety contract: gate failure NEVER blocks the marketer.
 *   - No brandMd provided       → SKIP (skipped=true, skipReason='no_brand_bible')
 *   - brandMd too short (<50ch) → SKIP (skipped=true, skipReason='brand_bible_too_short')
 *   - LLM call throws           → SKIP (skipped=true, skipReason='gate_error')
 *
 * Gate is included in the existing 5-credit draft cost — no extra debit.
 *
 * PII rule: never log brand bible content or article body text.
 */

import "server-only";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface VoiceSection {
  /** e.g. 'introduction', 'body', 'conclusion', or 'overall' */
  section: string;
  status: VoiceStatus;
  /** What's wrong — quote the problematic phrase */
  issue?: string;
  /** How to fix it */
  suggestion?: string;
}

export interface VoiceGateResult {
  overallStatus: VoiceStatus;
  /** true if no section is FAIL (WARN is non-blocking) */
  passed: boolean;
  sections: VoiceSection[];
  skipped: boolean;
  skipReason?: "no_brand_bible" | "brand_bible_too_short" | "gate_error";
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Use haiku (smaller/faster) not the draft model — tone pattern checking does
 * not require deep reasoning. Different from draft model (claude-sonnet-4.5).
 *
 * Exported so the voice gate's verifier model can be asserted distinct from the
 * drafter in tests against `@sagemark/core`'s `config/models.ts`.
 */
export const GATE_MODEL = "anthropic/claude-haiku-4-5";
/**
 * 3s timeout keeps total budget within maxDuration=60s:
 * 45s draft + 12s faithfulness + 3s voice = 60s.
 * Haiku P99 latency for ~1500 tokens in + 1500 tokens out ≈ 2-3s.
 * Bug fix: was 15_000ms (would allow 45+12+15=72s > 60s maxDuration).
 *
 * Exported so the 3s-timeout budget can be asserted in tests (PR 002
 * acceptance criterion 2).
 */
export const GATE_TIMEOUT_MS = 3_000;
export const GATE_MAX_TOKENS = 1_500;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Minimum brand bible length to be actionable. */
const MIN_BRAND_MD_LENGTH = 50;

/**
 * Truncation limit for article body — covers ~1000 words (full 1200-word article).
 * Bug fix: was 3000 chars (≈480 words), only covering 40% of a typical article.
 */
const MAX_ARTICLE_BODY_CHARS = 6_000;

/**
 * Truncation limit for brand bible to keep prompt within haiku's context.
 * Consistent with the adgen gate pattern (BRAND_MD_MAX_CHARS = 2000).
 */
const MAX_BRAND_MD_CHARS = 2_000;

// ── System prompt ─────────────────────────────────────────────────────────────

const GATE_SYSTEM = `You are a brand guardian reviewing a long-form article against a brand style guide. You will check:
1. Does the tone match the brand voice?
2. Are there prohibited words or phrases the brand has forbidden?
3. Is there marketing-speak that should be replaced with specific language?
4. Does the article speak to the right audience in the right register?

Provide section-level feedback for: introduction, body, conclusion, and an overall verdict.

Be specific — quote the problematic phrase. Only flag real violations, not minor preferences.

For each section, assign:
- "PASS" — section fully aligns with the brand bible
- "WARN" — minor concern, worth noting but non-blocking
- "FAIL" — direct contradiction of brand voice, uses prohibited term, or misses the target audience

Your output must be valid JSON only — no prose, no markdown.`;

// ── JSON schema for structured output ────────────────────────────────────────

const GATE_JSON_SCHEMA = {
  type: "object",
  required: ["overallStatus", "sections"],
  additionalProperties: false,
  properties: {
    overallStatus: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["section", "status"],
        additionalProperties: false,
        properties: {
          section: {
            type: "string",
            enum: ["introduction", "body", "conclusion", "overall"],
          },
          status: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

// ── Skip result factories ─────────────────────────────────────────────────────

function skipResult(
  skipReason: VoiceGateResult["skipReason"],
): VoiceGateResult {
  return {
    overallStatus: "SKIP",
    passed: true,
    sections: [],
    skipped: true,
    skipReason,
  };
}

/**
 * Normalizes LLM-returned section labels to the canonical enum values.
 * Fallback defence in case the model ignores the JSON schema enum constraint.
 */
function normalizeSection(
  s: string,
): "introduction" | "body" | "conclusion" | "overall" {
  const map: Record<string, "introduction" | "body" | "conclusion" | "overall"> =
    {
      intro: "introduction",
      introduction: "introduction",
      body: "body",
      main: "body",
      content: "body",
      conclusion: "conclusion",
      closing: "conclusion",
      outro: "conclusion",
      overall: "overall",
      summary: "overall",
    };
  return map[s.toLowerCase()] ?? "body";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the brand voice gate against the generated article.
 *
 * @param draft    - the generated content draft ({ title, body } used)
 * @param brandMd  - brand style guide in Markdown (optional — gate skipped if absent)
 * @returns        VoiceGateResult — never throws; failure returns skipped=true
 */
export async function runContentVoiceGate(
  draft: { title: string; body: string },
  brandMd: string | undefined,
): Promise<VoiceGateResult> {
  // Gate is skipped when no brand bible is provided.
  if (!brandMd || brandMd.trim().length === 0) {
    return skipResult("no_brand_bible");
  }

  // Gate is skipped when brand bible is too short to be meaningful.
  if (brandMd.trim().length < MIN_BRAND_MD_LENGTH) {
    return skipResult("brand_bible_too_short");
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey || openrouterKey.trim().length === 0) {
    return skipResult("gate_error");
  }

  // Truncate brand bible and article body to keep the prompt within haiku's context.
  const brandContext = brandMd.trim().slice(0, MAX_BRAND_MD_CHARS);
  const bodyExcerpt =
    draft.body.length > MAX_ARTICLE_BODY_CHARS
      ? draft.body.slice(0, MAX_ARTICLE_BODY_CHARS) + "\n\n[…article truncated for review…]"
      : draft.body;

  const userPrompt = `BRAND STYLE GUIDE:
---
${brandContext}
---

ARTICLE TITLE: ${draft.title}

ARTICLE BODY:
${bodyExcerpt}

Check the article's introduction, body, and conclusion against the brand style guide. Return JSON:
{
  "overallStatus": "PASS" | "WARN" | "FAIL",
  "sections": [
    {
      "section": "introduction" | "body" | "conclusion" | "overall",
      "status": "PASS" | "WARN" | "FAIL",
      "issue": "<optional — quote the problematic phrase>",
      "suggestion": "<optional — how to fix it>"
    }
  ]
}

Only include issue and suggestion for non-PASS sections. The overallStatus should be the worst status across all sections (FAIL > WARN > PASS).`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agents.flywheel.love",
        "X-Title": "ContentEngine Voice Gate",
      },
      body: JSON.stringify({
        model: GATE_MODEL,
        messages: [
          { role: "system", content: GATE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        max_tokens: GATE_MAX_TOKENS,
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "voice_gate_result",
            strict: true,
            schema: GATE_JSON_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return skipResult("gate_error");
  }
  clearTimeout(timer);

  if (!res.ok) {
    return skipResult("gate_error");
  }

  let rawContent: string | undefined;
  try {
    const rawBody = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawContent = rawBody.choices?.[0]?.message?.content;
  } catch {
    return skipResult("gate_error");
  }

  if (!rawContent || typeof rawContent !== "string") {
    return skipResult("gate_error");
  }

  // Parse the JSON response — strip markdown fences if present.
  let parsed: unknown;
  try {
    const cleaned = rawContent.replace(/```(?:json)?/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    if (jsonStart === -1) return skipResult("gate_error");
    parsed = JSON.parse(cleaned.slice(jsonStart));
  } catch {
    return skipResult("gate_error");
  }

  // Validate shape.
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).overallStatus !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).sections)
  ) {
    return skipResult("gate_error");
  }

  const raw = parsed as { overallStatus: string; sections: unknown[] };

  // Validate overallStatus.
  const validStatuses = ["PASS", "WARN", "FAIL"] as const;
  if (!validStatuses.includes(raw.overallStatus as (typeof validStatuses)[number])) {
    return skipResult("gate_error");
  }

  const overallStatus = raw.overallStatus as "PASS" | "WARN" | "FAIL";

  // Coerce each section, dropping malformed entries.
  const sections: VoiceSection[] = raw.sections.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const s = item as Record<string, unknown>;
    if (typeof s.section !== "string" || typeof s.status !== "string") return [];
    if (!validStatuses.includes(s.status as (typeof validStatuses)[number])) return [];

    const section: VoiceSection = {
      section: normalizeSection(s.section as string),
      status: s.status as "PASS" | "WARN" | "FAIL",
    };
    if (typeof s.issue === "string" && s.issue.trim().length > 0) {
      section.issue = s.issue;
    }
    if (typeof s.suggestion === "string" && s.suggestion.trim().length > 0) {
      section.suggestion = s.suggestion;
    }
    return [section];
  });

  // passed = overall is not FAIL (WARN is non-blocking)
  const passed = overallStatus !== "FAIL";

  return {
    overallStatus,
    passed,
    sections,
    skipped: false,
  };
}
