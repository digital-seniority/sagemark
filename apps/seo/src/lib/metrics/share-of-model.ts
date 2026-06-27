/**
 * Share-of-model (the north-star KPI) + the gate-block-by-sourcing rate (the D3
 * reversal trigger) — PR 020 / P1.C.3, lane worker-runtime.
 *
 * SHARE-OF-MODEL. The north star is "share of model": across the AI answer
 * engines (ChatGPT · Claude · Gemini, DR-038), how often is a client's published
 * hub CITED for the queries it should own? A citation CHECK is persisted per
 * `(client_id, engine, query)` (the `share_of_model` table), and the checks roll
 * up to a per-hub citation rate (cited / total). `position` (rank in the answer)
 * is recorded so a weighted variant is possible later; the headline rate is the
 * unweighted cited-share.
 *
 * GATE-BLOCK-BY-SOURCING RATE (D3 reversal trigger). The RFC's D3 decision can
 * be REVERSED if the sourcing gate blocks too much editorial throughput. The
 * trigger metric is the share of gate results blocked BY SOURCING:
 *   - a hard `VETO_UNSOURCED_STAT` veto (a stat/quote not traced to a source), OR
 *   - a low-faithfulness-from-thin-sources block (a faithfulness fail whose
 *     cause is thin/insufficient sourcing).
 * Computed from EXISTING gate-result data (the `PersistedGateResult.sourcingBlocked`
 * seam projection / the gate `vetoes[]`) — NO new `gate_results` table (it does
 * not exist; the inline PR-020 migration adds none). Pure functions; the I/O
 * (reading gate results / persisting SoM checks) is the seam's job.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` marker (imported by
 * plain-Node vitest).
 */

/** The AI answer engines tracked for share-of-model (DR-038). Free text in DB. */
export const SHARE_OF_MODEL_ENGINES = ["ChatGPT", "Claude", "Gemini"] as const;
export type ShareOfModelEngine = (typeof SHARE_OF_MODEL_ENGINES)[number];

/** The Gateway direct-query default source channel (DR-038). */
export const DEFAULT_SOURCE_CHANNEL = "direct" as const;

/**
 * One persisted citation check — the `(client_id, engine, query)` grain. `cited`
 * is the load-bearing fact; `position` (1-based rank in the engine's answer, or
 * null when uncited / unknown) supports a future weighted rollup.
 */
export interface ShareOfModelCheck {
  workspaceId: string;
  clientId: string;
  /** The published hub this check is attributed to (null = client-level query). */
  pieceId: string | null;
  engine: string;
  query: string;
  cited: boolean;
  position: number | null;
  /** Gateway direct-query by default (DR-038). */
  sourceChannel?: string;
  /** Citation-parser confidence 0..1 (null when not scored). */
  parserConf?: number | null;
}

/** The per-hub (or per-client) citation-rate rollup. */
export interface CitationRollup {
  /** The piece these checks rolled up for (null = client-level). */
  pieceId: string | null;
  total: number;
  cited: number;
  /** cited / total in [0,1]; 0 when total is 0 (no checks → no citations). */
  citationRate: number;
  /** Per-engine breakdown (cited / total per engine). */
  byEngine: Record<string, { total: number; cited: number; rate: number }>;
}

/**
 * Roll a flat list of citation checks up to a per-hub citation rate (cited /
 * total), plus a per-engine breakdown. Pure. An empty list rolls up to rate 0
 * (no checks ⇒ no demonstrated citations — never a fabricated 100%).
 */
export function rollUpCitationRate(
  checks: ShareOfModelCheck[],
  pieceId: string | null = null,
): CitationRollup {
  const total = checks.length;
  const cited = checks.reduce((n, c) => n + (c.cited ? 1 : 0), 0);
  const byEngine: CitationRollup["byEngine"] = {};
  for (const c of checks) {
    const e = (byEngine[c.engine] ??= { total: 0, cited: 0, rate: 0 });
    e.total += 1;
    if (c.cited) e.cited += 1;
  }
  for (const e of Object.values(byEngine)) {
    e.rate = e.total === 0 ? 0 : e.cited / e.total;
  }
  return {
    pieceId,
    total,
    cited,
    citationRate: total === 0 ? 0 : cited / total,
    byEngine,
  };
}

/**
 * The persistence seam for share-of-model checks. The live impl is a
 * service-role client (every write scoped by workspace_id + client_id); tests
 * inject the in-memory impl. `persistCheck` writes ONE row per check at the
 * `(client_id, engine, query)` grain; `checksForPiece` reads them back scoped by
 * the bound tenancy for the rollup.
 */
export interface ShareOfModelStore {
  persistCheck(check: ShareOfModelCheck): Promise<void>;
  /** All checks for a (workspace, client, piece) — tenancy-scoped. */
  checksForPiece(
    workspaceId: string,
    clientId: string,
    pieceId: string,
  ): Promise<ShareOfModelCheck[]>;
}

/** In-memory `ShareOfModelStore` backing the Tier-1 rollup test (no live DB). */
export class InMemoryShareOfModelStore implements ShareOfModelStore {
  private readonly rows: ShareOfModelCheck[] = [];

  persistCheck(check: ShareOfModelCheck): Promise<void> {
    this.rows.push({
      sourceChannel: DEFAULT_SOURCE_CHANNEL,
      parserConf: null,
      ...check,
    });
    return Promise.resolve();
  }

  checksForPiece(
    workspaceId: string,
    clientId: string,
    pieceId: string,
  ): Promise<ShareOfModelCheck[]> {
    // Tenancy isolation: only the bound workspace+client+piece rows.
    return Promise.resolve(
      this.rows.filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.clientId === clientId &&
          r.pieceId === pieceId,
      ),
    );
  }
}

/**
 * Fail-closed live store (DR-026): not wired in this build. Throws loudly.
 * Swapped for the C.021.2 service-role impl when the live writer lands.
 */
export const NOT_WIRED_SHARE_OF_MODEL_STORE: ShareOfModelStore = {
  persistCheck: () => {
    throw new ShareOfModelNotWiredError("persistCheck");
  },
  checksForPiece: () => {
    throw new ShareOfModelNotWiredError("checksForPiece");
  },
};

class ShareOfModelNotWiredError extends Error {
  readonly code = "SHARE_OF_MODEL_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `share-of-model store is not wired: '${op}' has no live service-role ` +
        `backend in this build (DR-026/DR-006). Inject a ShareOfModelStore.`,
    );
    this.name = "ShareOfModelNotWiredError";
  }
}

export { ShareOfModelNotWiredError };

// ── Gate-block-by-sourcing rate (the D3 reversal trigger) ─────────────────────

/**
 * A single gate result projected for the sourcing-block-rate computation. Mirror
 * of the load-bearing fields of `PersistedGateResult` (src/lib/content/context.ts)
 * + the Stage-A veto codes (`@sagemark/core` failure-codes). A gate is
 * "blocked by sourcing" iff it fired the `VETO_UNSOURCED_STAT` hard veto OR it
 * was a low-faithfulness block whose cause is thin sourcing.
 */
export interface GateResultForSourcing {
  /** Whether a gate ran at all (a result was produced). */
  hasGate: boolean;
  /** The Stage-A hard-veto codes that fired (from the gate's vetoes[]). */
  vetoes: string[];
  /**
   * Whether the gate's faithfulness block was caused by THIN sourcing (a
   * low-faithfulness-from-thin-sources block). Distinct from a faithfulness fail
   * caused by a hallucination against ADEQUATE sources — only the thin-sourcing
   * cause counts toward the D3 reversal trigger.
   */
  lowFaithfulnessFromThinSources: boolean;
}

/** The stable Stage-A veto code for an unsourced stat/quote (mirror of core). */
export const VETO_UNSOURCED_STAT = "VETO_UNSOURCED_STAT" as const;

/** The computed gate-block-by-sourcing rate (the D3 reversal trigger metric). */
export interface SourcingBlockRate {
  /** Gate results that ran (the denominator). */
  totalGated: number;
  /** Gate results blocked by sourcing (the numerator). */
  blockedBySourcing: number;
  /** blockedBySourcing / totalGated in [0,1]; 0 when totalGated is 0. */
  rate: number;
  /** Of the blocks: how many were the hard VETO_UNSOURCED_STAT veto. */
  unsourcedStatVetoes: number;
  /** Of the blocks: how many were low-faithfulness-from-thin-sources. */
  thinSourceFaithfulnessBlocks: number;
}

/**
 * Is this gate result blocked BY SOURCING? True iff it fired the
 * `VETO_UNSOURCED_STAT` hard veto OR it was a low-faithfulness-from-thin-sources
 * block. A gate that did not run is never counted (no result to block). Pure.
 */
export function isBlockedBySourcing(g: GateResultForSourcing): boolean {
  if (!g.hasGate) return false;
  return (
    g.vetoes.includes(VETO_UNSOURCED_STAT) || g.lowFaithfulnessFromThinSources
  );
}

/**
 * Compute the gate-block-by-sourcing rate over a set of gate results (the D3
 * reversal trigger). The denominator is gate results that RAN (hasGate); a
 * never-run gate is excluded (it is not a block). Pure — the I/O (reading the
 * gate results) is the seam's job; this is the rate the reversal decision reads.
 */
export function computeSourcingBlockRate(
  results: GateResultForSourcing[],
): SourcingBlockRate {
  const gated = results.filter((g) => g.hasGate);
  const totalGated = gated.length;
  let unsourcedStatVetoes = 0;
  let thinSourceFaithfulnessBlocks = 0;
  let blockedBySourcing = 0;
  for (const g of gated) {
    const vetoUnsourced = g.vetoes.includes(VETO_UNSOURCED_STAT);
    const thin = g.lowFaithfulnessFromThinSources;
    if (vetoUnsourced) unsourcedStatVetoes += 1;
    if (thin) thinSourceFaithfulnessBlocks += 1;
    if (vetoUnsourced || thin) blockedBySourcing += 1;
  }
  return {
    totalGated,
    blockedBySourcing,
    rate: totalGated === 0 ? 0 : blockedBySourcing / totalGated,
    unsourcedStatVetoes,
    thinSourceFaithfulnessBlocks,
  };
}
