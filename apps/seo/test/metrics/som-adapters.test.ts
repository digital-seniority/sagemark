/**
 * Tier-1 SoM measurement-subsystem tests (PR 021 / P1.C.4) — fully mocked.
 *
 * Proves the INERT/flag-gate, the citation parser + confidence, prompt
 * normalization, audit sampling, the per-engine rate-limit-budget defer, the
 * direct-Gateway channel (fake runner — no key, no network), the vendor-API
 * fallback channel, channel selection, and the exact 28-prompt query-bank
 * transcription + cite-target list.
 *
 * Runner: vitest (node env) — globbed via `test/metrics/**` in vitest.config.ts.
 * NO live Gateway, NO provider key, NO vendor: the direct runner + vendor client
 * are injected fakes; the env is injected so the INERT gate is driven both ways.
 */

import { describe, expect, it, vi } from "vitest";

import {
  BaseSomAdapter,
  makeChatgptAdapter,
  makeClaudeAdapter,
  makeGeminiAdapter,
  makeDefaultSomAdapters,
  RateLimiter,
  somLiveEnabled,
  adapterActivation,
  NOT_WIRED_VENDOR_API,
  VendorApiNotWiredError,
  DirectRunnerNotWiredError,
  gatewayDirectRunner,
  type DirectProbeRunner,
  type VendorApiClient,
  type SomProbeRequest,
} from "@/lib/metrics/som-adapters";
import {
  extractCitation,
  normalizeQuery,
  isAuditSampled,
  rollUpBySourceChannel,
  type RollupRow,
} from "@/lib/metrics/som-parse";
import {
  WHISPERING_WILLOWS_QUERY_BANK,
  getQueryBank,
  SOM_FUNNEL_STAGES,
} from "@/lib/metrics/query-bank";

const CITE_TARGET = {
  brandStrings: ["Whispering Willows of Mount Vernon", "Whispering Willows"],
  domains: ["whisperingwillows.com"],
};

const REQ: SomProbeRequest = {
  query: "memory care facilities in mount vernon, wa",
  citeTarget: CITE_TARGET,
};

/** A live env (flag on + a Gateway cred) so the direct channel activates. */
const LIVE_DIRECT_ENV = { SOM_LIVE: "1", AI_GATEWAY_API_KEY: "test-key" } as NodeJS.ProcessEnv;
/** A live env (flag on + a vendor cred) so the vendor channel activates. */
const LIVE_VENDOR_ENV = { SOM_LIVE: "1", SOM_VENDOR_API_KEY: "vendor-key" } as NodeJS.ProcessEnv;

// ── The INERT / flag gate ──────────────────────────────────────────────────────

describe("INERT flag gate (the hard constraint)", () => {
  it("somLiveEnabled is false unless SOM_LIVE is explicitly 1/true", () => {
    expect(somLiveEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(somLiveEnabled({ SOM_LIVE: "" } as NodeJS.ProcessEnv)).toBe(false);
    expect(somLiveEnabled({ SOM_LIVE: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(somLiveEnabled({ SOM_LIVE: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(somLiveEnabled({ SOM_LIVE: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(somLiveEnabled({ SOM_LIVE: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(somLiveEnabled({ SOM_LIVE: "TRUE" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("adapterActivation is 'inert' with SOM_LIVE unset — even with creds present", () => {
    expect(adapterActivation({ AI_GATEWAY_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe("inert");
    expect(adapterActivation({ SOM_VENDOR_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe("inert");
  });

  it("adapterActivation is 'inert' with SOM_LIVE on but NO creds", () => {
    expect(adapterActivation({ SOM_LIVE: "1" } as NodeJS.ProcessEnv)).toBe("inert");
  });

  it("vendor channel takes precedence over direct when both creds present", () => {
    expect(
      adapterActivation({ SOM_LIVE: "1", AI_GATEWAY_API_KEY: "k", SOM_VENDOR_API_KEY: "v" } as NodeJS.ProcessEnv),
    ).toBe("vendor-api");
    expect(adapterActivation(LIVE_DIRECT_ENV)).toBe("direct");
    expect(adapterActivation(LIVE_VENDOR_ENV)).toBe("vendor-api");
  });

  it("INERT PROOF: a probe with SOM_LIVE unset makes ZERO direct/vendor calls", async () => {
    const directRunner = vi.fn<DirectProbeRunner>();
    const vendorClient: VendorApiClient = { fetchCitation: vi.fn() };
    const adapter = makeChatgptAdapter({
      directRunner,
      vendorClient,
      env: {} as NodeJS.ProcessEnv, // SOM_LIVE unset
    });

    const outcome = await adapter.probe(REQ, 0);

    expect(outcome.status).toBe("miss");
    expect(directRunner).not.toHaveBeenCalled();
    expect(vendorClient.fetchCitation).not.toHaveBeenCalled();
  });
});

// ── Citation parse + confidence ────────────────────────────────────────────────

describe("citation extraction + parser confidence", () => {
  it("detects a full brand-name citation with high confidence", () => {
    const v = extractCitation(
      "For memory care, Whispering Willows of Mount Vernon is a strong option.",
      CITE_TARGET,
    );
    expect(v.cited).toBe(true);
    expect(v.parserConf).toBeGreaterThanOrEqual(0.9);
    expect(v.matchedOn).toBe("Whispering Willows of Mount Vernon");
    expect(v.position).toBeGreaterThanOrEqual(1);
  });

  it("detects a domain citation with the highest confidence", () => {
    const v = extractCitation("See whisperingwillows.com for details.", CITE_TARGET);
    expect(v.cited).toBe(true);
    expect(v.matchedOn).toBe("whisperingwillows.com");
    expect(v.parserConf).toBeGreaterThanOrEqual(0.95);
  });

  it("a confident NO-match on a usable response (target absent)", () => {
    const v = extractCitation(
      "The best memory care in Skagit County is Lighthouse Memory Care in Anacortes.",
      CITE_TARGET,
    );
    expect(v.cited).toBe(false);
    expect(v.position).toBeNull();
    expect(v.parserConf).toBeGreaterThanOrEqual(0.85);
  });

  it("an empty / unusable response yields low confidence (absence untrusted)", () => {
    const v = extractCitation("", CITE_TARGET);
    expect(v.cited).toBe(false);
    expect(v.parserConf).toBeLessThan(0.5);
  });

  it("position ranks an early mention above a buried one", () => {
    const early = extractCitation("Whispering Willows " + "x".repeat(200), CITE_TARGET);
    const late = extractCitation("x".repeat(200) + " Whispering Willows", CITE_TARGET);
    expect(early.position).toBeLessThan(late.position as number);
  });
});

// ── Prompt normalization ───────────────────────────────────────────────────────

describe("prompt normalization", () => {
  it("collapses whitespace, lowercases, strips trailing punctuation", () => {
    expect(normalizeQuery("  Memory   Care  facilities?  ")).toBe(
      "memory care facilities",
    );
  });

  it("is idempotent", () => {
    const once = normalizeQuery("Best memory care in Mount Vernon / Skagit County!");
    expect(normalizeQuery(once)).toBe(once);
  });

  it("canonicalizes slash-spacing for the alternative lists", () => {
    expect(normalizeQuery("Burlington/Anacortes / Sedro-Woolley")).toBe(
      "burlington / anacortes / sedro-woolley",
    );
  });
});

// ── Audit sampling ─────────────────────────────────────────────────────────────

describe("audit sampling", () => {
  it("is deterministic for the same query", () => {
    const q = "memory care facilities in mount vernon, wa";
    expect(isAuditSampled(q, 0.5)).toBe(isAuditSampled(q, 0.5));
  });

  it("rate 0 samples nothing; rate 1 samples everything", () => {
    expect(isAuditSampled("anything", 0)).toBe(false);
    expect(isAuditSampled("anything", 1)).toBe(true);
  });

  it("samples roughly the configured fraction over the 28-prompt bank", () => {
    const rate = 0.25;
    const sampled = WHISPERING_WILLOWS_QUERY_BANK.entries.filter((e) =>
      isAuditSampled(e.text, rate),
    ).length;
    // A loose band — deterministic but not exactly 25% on 28 items.
    expect(sampled).toBeGreaterThan(0);
    expect(sampled).toBeLessThan(WHISPERING_WILLOWS_QUERY_BANK.entries.length);
  });
});

// ── Rate-limit budget defer ─────────────────────────────────────────────────────

describe("per-engine rate-limit budget", () => {
  it("RateLimiter allows up to the budget then refuses within the window", () => {
    const rl = new RateLimiter({ maxRequestsPerWindow: 2, windowMs: 1000 });
    expect(rl.tryConsume(0)).toBe(true);
    expect(rl.tryConsume(10)).toBe(true);
    expect(rl.tryConsume(20)).toBe(false); // over budget
    expect(rl.tryConsume(1001)).toBe(true); // window rolled over
  });

  it("an over-budget probe DEFERS (never crashes / bans)", async () => {
    const directRunner = vi.fn<DirectProbeRunner>(async () => "no citation here at all");
    const adapter = new BaseSomAdapter(
      { engine: "ChatGPT", modelId: "openai/x", useWebSearch: false, budget: { maxRequestsPerWindow: 1, windowMs: 1000 } },
      { directRunner, env: LIVE_DIRECT_ENV },
    );
    const first = await adapter.probe(REQ, 0);
    const second = await adapter.probe(REQ, 1); // same window, over budget
    expect(first.status).toBe("ok");
    expect(second.status).toBe("deferred");
    expect(directRunner).toHaveBeenCalledTimes(1); // the deferred probe did NOT call
  });
});

// ── Direct channel (fake Gateway runner) ────────────────────────────────────────

describe("direct channel (Gateway, fake runner — no key/network)", () => {
  it("routes through the direct runner and parses the citation", async () => {
    const directRunner = vi.fn<DirectProbeRunner>(
      async () => "I recommend Whispering Willows of Mount Vernon for memory care.",
    );
    const adapter = makeClaudeAdapter({ directRunner, env: LIVE_DIRECT_ENV });
    const outcome = await adapter.probe(REQ, 0);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    // Claude's direct path is the REAL-citation channel (web-search tool).
    expect(outcome.result.sourceChannel).toBe("direct-citation");
    expect(outcome.result.cited).toBe(true);
    expect(outcome.result.engine).toBe("Claude");
    expect(outcome.result.parserConf).toBeGreaterThan(0.5);
    expect(directRunner).toHaveBeenCalledOnce();
  });

  it("a direct-runner error degrades to a logged MISS (never crashes)", async () => {
    const directRunner = vi.fn<DirectProbeRunner>(async () => {
      throw new Error("gateway 500");
    });
    const adapter = makeGeminiAdapter({ directRunner, env: LIVE_DIRECT_ENV });
    const outcome = await adapter.probe(REQ, 0);
    expect(outcome.status).toBe("miss");
  });

  it("the default direct runner is fail-closed NOT_WIRED (no AI SDK import)", () => {
    expect(() => gatewayDirectRunner({ engine: "ChatGPT", modelId: "x", useWebSearch: false, query: "q", context: { locale: "en-US", deviceProfile: "desktop" } })).toThrow(
      DirectRunnerNotWiredError,
    );
  });
});

// ── Vendor-API fallback channel ─────────────────────────────────────────────────

describe("vendor-API fallback channel (the ToS fallback seam)", () => {
  it("routes through the injected vendor client when the vendor cred is present", async () => {
    const vendorClient: VendorApiClient = {
      fetchCitation: vi.fn(async () => ({
        rawResponse: "GEO-tracker: Whispering Willows cited in ChatGPT answer #1",
        cited: true,
        position: 1,
      })),
    };
    const directRunner = vi.fn<DirectProbeRunner>();
    const adapter = makeChatgptAdapter({ vendorClient, directRunner, env: LIVE_VENDOR_ENV });
    const outcome = await adapter.probe(REQ, 0);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.result.sourceChannel).toBe("vendor");
    expect(outcome.result.cited).toBe(true);
    expect(outcome.result.position).toBe(1);
    expect(vendorClient.fetchCitation).toHaveBeenCalledOnce();
    // The direct path must NOT run when the vendor channel is selected.
    expect(directRunner).not.toHaveBeenCalled();
  });

  it("the default vendor client is fail-closed NOT_WIRED", () => {
    expect(() =>
      NOT_WIRED_VENDOR_API.fetchCitation({
        engine: "ChatGPT",
        query: "q",
        context: { locale: "en-US", deviceProfile: "desktop" },
      }),
    ).toThrow(VendorApiNotWiredError);
  });

  it("a reached-but-unwired vendor channel degrades to a MISS (caught, not crash)", async () => {
    const adapter = makeChatgptAdapter({ env: LIVE_VENDOR_ENV }); // default NOT_WIRED vendor
    const outcome = await adapter.probe(REQ, 0);
    expect(outcome.status).toBe("miss");
  });
});

// ── The default adapter set ─────────────────────────────────────────────────────

describe("default adapter set", () => {
  it("builds exactly ChatGPT/Claude/Gemini (perplexity deferred per DR-038)", () => {
    const set = makeDefaultSomAdapters();
    expect(set.map((a) => a.engine)).toEqual(["ChatGPT", "Claude", "Gemini"]);
  });
});

// ── Query bank: the 28 approved prompts + cite-target list ───────────────────────

describe("Whispering Willows query bank (approved input, exact transcription)", () => {
  const bank = WHISPERING_WILLOWS_QUERY_BANK;

  it("has exactly 28 prompts", () => {
    expect(bank.entries).toHaveLength(28);
  });

  it("ordinals are 1..28 contiguous", () => {
    expect(bank.entries.map((e) => e.ordinal)).toEqual(
      Array.from({ length: 28 }, (_, i) => i + 1),
    );
  });

  it("carries the exact cite-target match list", () => {
    expect(bank.citeTarget.brandStrings).toEqual([
      "Whispering Willows of Mount Vernon",
      "Whispering Willows",
    ]);
    expect(bank.citeTarget.domains).toEqual(["whisperingwillows.com"]);
  });

  it("transcribes verbatim source prompts exactly (spot check)", () => {
    const byOrd = (n: number) => bank.entries.find((e) => e.ordinal === n)!;
    expect(byOrd(1).sourceText).toBe(
      "What are the early signs of dementia in an aging parent?",
    );
    expect(byOrd(13).sourceText).toBe("Memory care facilities in Mount Vernon, WA");
    expect(byOrd(19).sourceText).toBe(
      "Whispering Willows of Mount Vernon vs Lighthouse Memory Care (Anacortes) — which memory care is better?",
    );
    expect(byOrd(28).sourceText).toBe(
      "What support do memory care communities offer families of dementia residents?",
    );
  });

  it("every entry's normalized text equals normalizeQuery(sourceText)", () => {
    for (const e of bank.entries) {
      expect(e.text).toBe(normalizeQuery(e.sourceText));
    }
  });

  it("covers all six SoM funnel stages", () => {
    const stages = new Set(bank.entries.map((e) => e.funnelStage));
    for (const s of SOM_FUNNEL_STAGES) expect(stages.has(s)).toBe(true);
  });

  it("is resolvable from the registry by key", () => {
    expect(getQueryBank("whispering-willows")).toBe(bank);
    expect(getQueryBank("nope")).toBeNull();
  });
});

// ── HYBRID per-engine source_channel labeling (the load-bearing decision) ────────

describe("per-engine source_channel labeling (HYBRID decision)", () => {
  /** A direct runner that always names the brand, so cited=true on every engine. */
  const citingRunner: DirectProbeRunner = async () =>
    "Whispering Willows of Mount Vernon is a top memory care community.";

  it("Claude direct path is labeled 'direct-citation' (web-search, real sources)", async () => {
    const adapter = makeClaudeAdapter({ directRunner: citingRunner, env: LIVE_DIRECT_ENV });
    const outcome = await adapter.probe(REQ, 0);
    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.sourceChannel).toBe("direct-citation");
  });

  it("ChatGPT direct path is labeled 'direct-proxy' (model-answer mention)", async () => {
    const adapter = makeChatgptAdapter({ directRunner: citingRunner, env: LIVE_DIRECT_ENV });
    const outcome = await adapter.probe(REQ, 0);
    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.sourceChannel).toBe("direct-proxy");
  });

  it("Gemini direct path is labeled 'direct-proxy' (no AIO citation API)", async () => {
    const adapter = makeGeminiAdapter({ directRunner: citingRunner, env: LIVE_DIRECT_ENV });
    const outcome = await adapter.probe(REQ, 0);
    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.sourceChannel).toBe("direct-proxy");
  });

  it("the vendor channel is labeled 'vendor' regardless of engine", async () => {
    const vendorClient: VendorApiClient = {
      fetchCitation: async () => ({ rawResponse: "cited", cited: true, position: 1 }),
    };
    for (const make of [makeChatgptAdapter, makeGeminiAdapter, makeClaudeAdapter]) {
      const adapter = make({ vendorClient, env: LIVE_VENDOR_ENV });
      const outcome = await adapter.probe(REQ, 0);
      if (outcome.status !== "ok") throw new Error("expected ok");
      expect(outcome.result.sourceChannel).toBe("vendor");
    }
  });
});

describe("channel-segmented rollup (proxy never summed as citation)", () => {
  it("keeps the proxy mention-rate SEPARATE from the real citation rate", () => {
    const rows: RollupRow[] = [
      // Claude (real citation channel): 2 of 2 cited.
      { cited: true, sourceChannel: "direct-citation" },
      { cited: true, sourceChannel: "direct-citation" },
      // ChatGPT/Gemini (proxy): 1 of 2 mentioned.
      { cited: true, sourceChannel: "direct-proxy" },
      { cited: false, sourceChannel: "direct-proxy" },
    ];
    const seg = rollUpBySourceChannel(rows);

    // The headline citation rate sums ONLY the real-citation channel.
    expect(seg.citation.total).toBe(2);
    expect(seg.citation.cited).toBe(2);
    expect(seg.citation.rate).toBe(1);

    // The proxy mention-rate is a DISTINCT bucket (never folded into citation).
    expect(seg.proxy.total).toBe(2);
    expect(seg.proxy.cited).toBe(1);
    expect(seg.proxy.rate).toBe(0.5);

    // There is no combined rate mixing the two; per-channel detail is preserved.
    expect(seg.perChannel["direct-citation"].rate).toBe(1);
    expect(seg.perChannel["direct-proxy"].rate).toBe(0.5);
  });

  it("vendor rows count toward the real citation rate (sanctioned signal)", () => {
    const seg = rollUpBySourceChannel([
      { cited: true, sourceChannel: "vendor" },
      { cited: false, sourceChannel: "vendor" },
    ]);
    expect(seg.citation.total).toBe(2);
    expect(seg.citation.cited).toBe(1);
    expect(seg.proxy.total).toBe(0);
  });
});
