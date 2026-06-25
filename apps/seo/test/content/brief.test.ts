/**
 * /content/api/brief — criterion 4/5 end-to-end through the route (SSRF-safe
 * SERP grounding + graded sources) + criterion 2 (voice-spec hard stop) +
 * criterion 7 (tenancy).
 */

import { describe, it, expect, vi } from "vitest";
import { handleBrief, type SerpProvider } from "@/app/content/api/brief/route";
import {
  makeData,
  workspace,
  approvedVoiceSpec,
  jsonRequest,
  WORKSPACE_A,
  CLIENT_A,
  CLIENT_B,
} from "./fixtures";

function briefBody(over: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_A,
    keyword: "memory care for parents",
    audience: "adult children",
    contentType: "blog-post",
    tone: "educational",
    ...over,
  };
}

/** A SERP provider that returns a mix of authority classes + an SSRF-unsafe URL. */
const mixedSerp: SerpProvider = async () => [
  { url: "https://www.nia.nih.gov/health/x", title: "NIA", snippet: "authoritative stat" },
  { url: "https://myclinicblog.example/y", title: "Clinic", snippet: "client fact" },
  { url: "http://169.254.169.254/meta", title: "metadata", snippet: "secret" }, // unsafe → dropped
  { url: "https://randomblog.example/z", title: "Blog", snippet: "rumor" },
];

const noopFetcher = vi.fn(async () => new Response("", { status: 200 }));

describe("brief — criterion 5: graded sources with authority class", () => {
  it("returns sources graded a/b/c with url+domain+fetched-at, unsafe URL dropped", async () => {
    const data = makeData({
      getApprovedVoiceSpec: vi.fn(async () =>
        approvedVoiceSpec({ spec: { attributionSources: ["myclinicblog.example"], authors: [] } }),
      ),
    });
    const res = await handleBrief(jsonRequest(briefBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      serpProvider: mixedSerp,
      fetcher: noopFetcher,
      now: () => new Date("2026-04-04T00:00:00Z"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byDomain = Object.fromEntries(
      body.sources.map((s: { domain: string; authorityClass: string }) => [
        s.domain,
        s.authorityClass,
      ]),
    );
    expect(byDomain["nia.nih.gov"]).toBe("medical-authority"); // (a)
    expect(byDomain["myclinicblog.example"]).toBe("client-fact"); // (b)
    expect(byDomain["randomblog.example"]).toBe("low-authority"); // (c)
    // criterion 4: the SSRF-unsafe metadata URL never became a source.
    expect(body.sources.some((s: { domain: string }) => s.domain.includes("169.254"))).toBe(false);
    for (const s of body.sources) {
      expect(s.fetchedAt).toBe("2026-04-04T00:00:00.000Z");
      expect(typeof s.url).toBe("string");
    }
  });
});

describe("brief — criterion 2: voice-spec hard stop", () => {
  it("refuses the brief when there is no approved voice spec (409)", async () => {
    const data = makeData({ getApprovedVoiceSpec: vi.fn(async () => null) });
    const res = await handleBrief(jsonRequest(briefBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      serpProvider: mixedSerp,
      fetcher: noopFetcher,
      now: () => new Date(),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no-approved-voice-spec");
  });
});

describe("brief — criterion 7: tenancy", () => {
  it("cross-tenant clientId → 404", async () => {
    const data = makeData();
    const res = await handleBrief(jsonRequest(briefBody({ clientId: CLIENT_B })), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      serpProvider: mixedSerp,
      fetcher: noopFetcher,
      now: () => new Date(),
    });
    expect(res.status).toBe(404);
  });

  it("unauthenticated → 401", async () => {
    const data = makeData();
    const res = await handleBrief(jsonRequest(briefBody()), {
      data,
      resolveWorkspace: async () => null,
      serpProvider: mixedSerp,
      fetcher: noopFetcher,
      now: () => new Date(),
    });
    expect(res.status).toBe(401);
  });
});

describe("brief — criterion 8: contract version", () => {
  it("rejects a mismatched caller contract version (409)", async () => {
    const data = makeData();
    const res = await handleBrief(
      jsonRequest(briefBody({ contractVersion: "content-engine/0.9" })),
      {
        data,
        resolveWorkspace: async () => workspace(WORKSPACE_A),
        serpProvider: mixedSerp,
        fetcher: noopFetcher,
        now: () => new Date(),
      },
    );
    // The literal mismatch is caught by zod (.literal) as a 400 bad-request OR the
    // contract check as 409 — either way the call is REJECTED, never silently run.
    expect([400, 409]).toContain(res.status);
  });
});
