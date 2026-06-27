"use client";

/**
 * use-client-scorers — zero-credit deterministic LIVE PREVIEW scorers for the
 * Inspector sidebar (PR 011 / P1.U.2).
 *
 * THE DISTINCTION THAT MATTERS. The authoritative gate scorecard (Stage-A vetoes,
 * Stage-B 8-dimension composite, verdict band) comes ONLY from the server `gate`
 * SSE events folded by `use-ui-message-stream.ts`. THIS hook is a separate,
 * client-only LIVE PREVIEW: it recomputes a handful of the deterministic SEO
 * scorers over the CURRENT editor body in a `useMemo`, so the operator sees signal
 * move as the draft fills in WITHOUT spending a model call or a gate run (zero
 * credit). It never calls an LLM, never reserves credit, never hits the network —
 * it reuses the SAME pure deterministic functions the real gate composes
 * (`@sagemark/core`), so a preview number agrees with the authoritative gate's
 * deterministic inputs by construction. The UI labels these "LIVE PREVIEW
 * (uncredited)" so they are never confused with the authoritative server verdict.
 *
 * WE DO NOT RE-IMPLEMENT SCORERS. Every signal here is imported from
 * `@sagemark/core` (`computeFleschKincaid`, `analyzeKeywordDensity`,
 * `detectPassiveVoice`, `scoreContentBreakdown`) — the exact functions the
 * non-compensatory gate runs in Stage A/B. The hook only orchestrates them in a
 * memo over the live body; it adds no scoring logic of its own.
 *
 * The LLM gates (faithfulness / voice) and the Stage-A vetoes that need them are
 * deliberately EXCLUDED here — those cost credit and belong to the server gate.
 *
 * Clean ASCII / UTF-8.
 */

import { useMemo } from "react";
// IMPORTANT: import the deterministic scorers from their SUBPATH modules, NOT the
// `@sagemark/core` barrel. The barrel (`index.ts`) re-exports the LLM
// faithfulness/voice gates, which carry `import "server-only"` — pulling the
// barrel into this Client Component would drag a server-only module into the
// browser bundle and fail the build. The per-scorer subpaths are pure + isomorphic
// (no `server-only`, no network), so the live preview stays zero-credit and
// client-safe. (`@sagemark/core` package.json exports `./*` -> `./src/*.ts`.)
import {
  computeFleschKincaid,
  type FleschKincaidResult,
} from "@sagemark/core/scorers/flesch-kincaid";
import {
  analyzeKeywordDensity,
  type KeywordDensityResult,
} from "@sagemark/core/scorers/keyword-density";
import {
  detectPassiveVoice,
  type PassiveVoiceResult,
} from "@sagemark/core/scorers/passive-voice";
import {
  scoreContentBreakdown,
  type ContentScoreBreakdown,
} from "@sagemark/core/scorers/content-score";

/** The zero-credit live-preview projection the Inspector renders. */
export interface ClientScorers {
  /** Whether the body had enough text to compute meaningful signal. */
  hasBody: boolean;
  /** Flesch-Kincaid readability (grade level + reading ease). */
  readability: FleschKincaidResult;
  /** Keyword density for the brief's primary keyword (under/optimal/stuffed). */
  keyword: KeywordDensityResult;
  /** Passive-voice ratio (HIGH/MODERATE/LOW). */
  passive: PassiveVoiceResult;
  /** The deterministic 0-100 content-score composite + 0-5 dimension breakdown. */
  content: ContentScoreBreakdown;
  /** Word count (cheap, surfaced as the at-a-glance length signal). */
  wordCount: number;
}

/**
 * Recompute the zero-credit deterministic preview scorers over the live editor
 * body. Pure + memoized on `[body, keyword]` — re-runs only when the operator's
 * body (or the target keyword) changes, never on every render and never on a
 * model/gate call.
 *
 * @param body    - the current editor markdown body (the live `token-delta` accrual)
 * @param keyword - the brief's primary keyword (drives keyword density); "" when none
 */
export function useClientScorers(body: string, keyword: string | null | undefined): ClientScorers {
  const kw = (keyword ?? "").trim();
  return useMemo<ClientScorers>(() => {
    const text = body ?? "";
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return {
      hasBody: text.trim().length > 0,
      readability: computeFleschKincaid(text),
      keyword: analyzeKeywordDensity(text, kw),
      passive: detectPassiveVoice(text),
      content: scoreContentBreakdown(text, kw),
      wordCount,
    };
  }, [body, kw]);
}
