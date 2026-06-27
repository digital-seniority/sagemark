/**
 * Share-of-Model per-client funnel-staged QUERY BANK (PR 021 / P1.C.4, lane
 * worker-runtime). RFC engineering-rfc.md §728; approved input
 * som-prompt-set-whispering-willows.md (James, 2026-06-26).
 *
 * WHAT THIS IS. The set of prompts the SoM ingestion cron poses to each tracked
 * answer engine, off the `clusterRole` / `funnelStage` map. Each entry carries the
 * NORMALIZED canonical text (so week-over-week compares like-for-like), its funnel
 * stage + cluster + type, and the per-client CITE-TARGET match list (the brand
 * strings / domain that count as a "cited" hit). Structured so OTHER clients are
 * added by registering another `ClientQueryBank` — Whispering Willows is the first.
 *
 * SoM FUNNEL STAGES are a SUPERSET of the 3 homepage stages (hub-homepage.ts:
 * awareness / consideration / decision) plus the SoM-only measurement stages the
 * approved set adds (competitor-comparison / brand-entity / retention). The three
 * homepage stages map 1:1; the extra three exist only for SoM measurement.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` (Tier-1 vitest, plain Node).
 */

import type { CiteTarget } from "./som-adapters/types";
import { normalizeQuery } from "./som-parse";

/**
 * The SoM funnel stages. The first three mirror `hub-homepage.FUNNEL_STAGES`
 * exactly; the last three are SoM-measurement-only stages from the approved set.
 */
export const SOM_FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "decision",
  "competitor-comparison",
  "brand-entity",
  "retention",
] as const;
export type SomFunnelStage = (typeof SOM_FUNNEL_STAGES)[number];

/** The kind of intent a prompt expresses (for per-type rollups). */
export type QueryType =
  | "informational"
  | "comparison"
  | "local-intent"
  | "cost"
  | "brand"
  | "competitor"
  | "retention";

/** One query-bank entry: the prompt + its funnel/cluster/type classification. */
export interface QueryBankEntry {
  /** 1-based ordinal matching the approved prompt set (audit traceability). */
  ordinal: number;
  /** The NORMALIZED prompt text actually sent + persisted (canonical phrasing). */
  text: string;
  /** The verbatim source prompt (pre-normalization), kept for audit traceability. */
  sourceText: string;
  funnelStage: SomFunnelStage;
  /** The cluster / spoke the prompt supports (for per-hub rollup). */
  cluster: string;
  type: QueryType;
}

/** A client's full query bank: the cite-target oracle + every prompt. */
export interface ClientQueryBank {
  /** The client this bank is for (stable key; resolved to a client_id at ingest). */
  clientKey: string;
  /** Human label for the client (for logs / heartbeats). */
  clientLabel: string;
  /** Geo the prompts are localized for (qualifies the citation rate). */
  geo: string;
  /** The cite-target oracle: a "cited" hit = any brand string or domain present. */
  citeTarget: CiteTarget;
  /** The normalized, classified prompts. */
  entries: QueryBankEntry[];
}

// ── Whispering Willows of Mount Vernon (the first client; approved 2026-06-26) ──

/**
 * The cite-target oracle (from the approved set): a "cited" hit = the answer names
 * "Whispering Willows of Mount Vernon" OR "Whispering Willows" OR links
 * whisperingwillows.com. Matched case-insensitively by `som-parse`.
 */
const WHISPERING_WILLOWS_CITE_TARGET: CiteTarget = {
  brandStrings: ["Whispering Willows of Mount Vernon", "Whispering Willows"],
  domains: ["whisperingwillows.com"],
};

/**
 * The 28 approved prompts, transcribed EXACTLY from
 * som-prompt-set-whispering-willows.md (read-only source). `sourceText` is the
 * verbatim prompt; `text` is its `normalizeQuery()` canonical form. The cluster
 * labels mirror the approved set's parenthetical cluster hints per section.
 */
const WHISPERING_WILLOWS_SOURCE_PROMPTS: ReadonlyArray<
  Omit<QueryBankEntry, "text">
> = [
  // Awareness (pillar `memory care`, spoke-early-signs `early signs of dementia`, faq)
  { ordinal: 1, sourceText: "What are the early signs of dementia in an aging parent?", funnelStage: "awareness", cluster: "early-signs-of-dementia", type: "informational" },
  { ordinal: 2, sourceText: "How do I know if my mom has dementia or just normal aging?", funnelStage: "awareness", cluster: "early-signs-of-dementia", type: "informational" },
  { ordinal: 3, sourceText: "What is memory care and how is it different from a nursing home or assisted living?", funnelStage: "awareness", cluster: "memory-care", type: "informational" },
  { ordinal: 4, sourceText: "Memory care and dementia resources for families in Skagit County, WA", funnelStage: "awareness", cluster: "memory-care", type: "local-intent" },
  { ordinal: 5, sourceText: "Where can I learn about dementia care options near Mount Vernon, WA?", funnelStage: "awareness", cluster: "memory-care", type: "local-intent" },

  // Consideration (vs-assisted-living, cost, signs-its-time, guilt)
  { ordinal: 6, sourceText: "What's the difference between memory care and assisted living?", funnelStage: "consideration", cluster: "vs-assisted-living", type: "comparison" },
  { ordinal: 7, sourceText: "When is it time to move a parent with dementia into memory care?", funnelStage: "consideration", cluster: "signs-its-time", type: "informational" },
  { ordinal: 8, sourceText: "How much does memory care cost in Skagit County / Washington state?", funnelStage: "consideration", cluster: "cost", type: "cost" },
  { ordinal: 9, sourceText: "How do families pay for memory care (Medicaid, VA benefits, long-term-care insurance) in WA?", funnelStage: "consideration", cluster: "cost", type: "cost" },
  { ordinal: 10, sourceText: "Is it normal to feel guilty about moving a parent to memory care?", funnelStage: "consideration", cluster: "guilt", type: "informational" },
  { ordinal: 11, sourceText: "What should a good memory care community provide for someone with Alzheimer's?", funnelStage: "consideration", cluster: "vs-assisted-living", type: "informational" },

  // Decision (location + choosing — highest SoM value)
  { ordinal: 12, sourceText: "Best memory care communities in Skagit County, WA", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },
  { ordinal: 13, sourceText: "Memory care facilities in Mount Vernon, WA", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },
  { ordinal: 14, sourceText: "Memory care near me in the Skagit Valley", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },
  { ordinal: 15, sourceText: "Memory care in Burlington / Anacortes / Sedro-Woolley, WA", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },
  { ordinal: 16, sourceText: "Dementia / Alzheimer's care communities near Mount Vernon that accept Medicaid", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },
  { ordinal: 17, sourceText: "What should I look for — and what questions should I ask — when touring a memory care community in the Skagit Valley?", funnelStage: "decision", cluster: "choosing", type: "informational" },
  { ordinal: 18, sourceText: "Specialized dementia care communities in Skagit County, WA", funnelStage: "decision", cluster: "location-choosing", type: "local-intent" },

  // Competitor-comparison (uses real nearby competitors)
  { ordinal: 19, sourceText: "Whispering Willows of Mount Vernon vs Lighthouse Memory Care (Anacortes) — which memory care is better?", funnelStage: "competitor-comparison", cluster: "competitor", type: "competitor" },
  { ordinal: 20, sourceText: "Whispering Willows vs Birchview Memory Care (Sedro-Woolley) for dementia care", funnelStage: "competitor-comparison", cluster: "competitor", type: "competitor" },
  { ordinal: 21, sourceText: "Whispering Willows vs Where The Heart Is (Burlington) memory care", funnelStage: "competitor-comparison", cluster: "competitor", type: "competitor" },
  { ordinal: 22, sourceText: "Best memory care in Mount Vernon: Whispering Willows vs The Bridge vs Fairmont Manor", funnelStage: "competitor-comparison", cluster: "competitor", type: "competitor" },
  { ordinal: 23, sourceText: "How does Whispering Willows of Mount Vernon compare to other memory care communities in Skagit County?", funnelStage: "competitor-comparison", cluster: "competitor", type: "competitor" },

  // Brand-entity (direct engine recall)
  { ordinal: 24, sourceText: "Is Whispering Willows of Mount Vernon a good memory care community?", funnelStage: "brand-entity", cluster: "brand", type: "brand" },
  { ordinal: 25, sourceText: "Tell me about Whispering Willows memory care in Mount Vernon / Skagit County.", funnelStage: "brand-entity", cluster: "brand", type: "brand" },
  { ordinal: 26, sourceText: "What do reviews say about Whispering Willows of Mount Vernon?", funnelStage: "brand-entity", cluster: "brand", type: "brand" },

  // Retention / post-decision
  { ordinal: 27, sourceText: "How do families stay involved after a parent moves into memory care?", funnelStage: "retention", cluster: "retention", type: "retention" },
  { ordinal: 28, sourceText: "What support do memory care communities offer families of dementia residents?", funnelStage: "retention", cluster: "retention", type: "retention" },
];

/** Build a normalized bank from a verbatim source set (text = normalizeQuery). */
function buildBank(
  meta: Omit<ClientQueryBank, "entries">,
  source: ReadonlyArray<Omit<QueryBankEntry, "text">>,
): ClientQueryBank {
  return {
    ...meta,
    entries: source.map((e) => ({ ...e, text: normalizeQuery(e.sourceText) })),
  };
}

/** The Whispering Willows of Mount Vernon query bank (28 approved prompts). */
export const WHISPERING_WILLOWS_QUERY_BANK: ClientQueryBank = buildBank(
  {
    clientKey: "whispering-willows",
    clientLabel: "Whispering Willows of Mount Vernon",
    geo: "Mount Vernon, WA / Skagit County",
    citeTarget: WHISPERING_WILLOWS_CITE_TARGET,
  },
  WHISPERING_WILLOWS_SOURCE_PROMPTS,
);

/** The registry of per-client query banks (add a client by registering one). */
export const QUERY_BANKS: Record<string, ClientQueryBank> = {
  [WHISPERING_WILLOWS_QUERY_BANK.clientKey]: WHISPERING_WILLOWS_QUERY_BANK,
};

/** Resolve a client's query bank by its stable key, or null when unregistered. */
export function getQueryBank(clientKey: string): ClientQueryBank | null {
  return QUERY_BANKS[clientKey] ?? null;
}
