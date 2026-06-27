/**
 * serp-fetch — criterion 4 (SSRF + scheme block + content cap, untrusted text)
 * + criterion 5 (authority class a/b/c + dedup + robots).
 */

import { describe, it, expect, vi } from "vitest";
import {
  isPrivateHost,
  isFetchableUrl,
  classifyAuthority,
  attributionDomainSet,
  dedupeSources,
  robotsAllows,
  fetchPageText,
  assembleSources,
  sourcesForYmylGrounding,
  MAX_PAGE_CHARS,
  type RawSerpResult,
} from "@/lib/content/serp-fetch";
import type { BriefSource } from "@/lib/content/contract";

describe("criterion 4 — SSRF host guard", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.9.9",
    "172.31.255.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.170.2",
    "::1",
    "fd00:abcd::1",
    "0.0.0.0",
  ])("blocks private/loopback/link-local host %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["example.com", "nia.nih.gov", "8.8.8.8", "203.0.113.5"])(
    "allows public host %s",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});

describe("criterion 4 — scheme + URL guard", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8080/admin",
  ])("rejects non-http(s) or private URL %s", (url) => {
    expect(isFetchableUrl(url)).toBe(false);
  });

  it.each(["http://example.com", "https://nia.nih.gov/health"])(
    "accepts public http(s) URL %s",
    (url) => {
      expect(isFetchableUrl(url)).toBe(true);
    },
  );
});

describe("criterion 4 — fetched content is capped + never fetched when blocked", () => {
  it("returns null (never fetches) for an SSRF-blocked URL", async () => {
    const fetcher = vi.fn(async () => new Response("secret", { status: 200 }));
    const out = await fetchPageText("http://169.254.169.254/latest/meta-data/", fetcher);
    expect(out).toBeNull();
    expect(fetcher).not.toHaveBeenCalled(); // guard runs BEFORE any connection
  });

  it("caps fetched page text at MAX_PAGE_CHARS and strips scripts", async () => {
    const huge =
      "<html><script>steal()</script><body>" + "a".repeat(MAX_PAGE_CHARS * 3) + "</body></html>";
    const fetcher = vi.fn(async () => new Response(huge, { status: 200 }));
    const out = await fetchPageText("https://example.com/big", fetcher);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    // The <script> body never survives into the snippet (untrusted-text discipline).
    expect(out).not.toContain("steal()");
  });
});

describe("criterion 5 — authority classification (a / b / c)", () => {
  const attribution = attributionDomainSet([
    "myclinicblog.example",
    "https://partnersite.example/about",
  ]);

  it("(a) named medical authority + .gov/.edu → medical-authority", () => {
    expect(classifyAuthority("https://www.nia.nih.gov/x", attribution)).toBe("medical-authority");
    expect(classifyAuthority("https://cdc.gov/data", attribution)).toBe("medical-authority");
    expect(classifyAuthority("https://www.alz.org/facts", attribution)).toBe("medical-authority");
    expect(classifyAuthority("https://research.harvard.edu/study", attribution)).toBe(
      "medical-authority",
    );
  });

  it("(b) a plain attributionSources entry → client-fact, NOT medical", () => {
    expect(classifyAuthority("https://myclinicblog.example/post", attribution)).toBe(
      "client-fact",
    );
    expect(classifyAuthority("https://partnersite.example/x", attribution)).toBe("client-fact");
  });

  it("(c) unknown domain → low-authority", () => {
    expect(classifyAuthority("https://randomblog.example/post", attribution)).toBe(
      "low-authority",
    );
  });

  it("a client CANNOT launder a low-authority domain into (a) by listing it", () => {
    // Even if the client lists a non-authority domain, it classifies as (b), not (a).
    const attr = attributionDomainSet(["randomblog.example"]);
    expect(classifyAuthority("https://randomblog.example/post", attr)).toBe("client-fact");
    // And a real authority listed by the client is still (a) on its own merit.
    expect(classifyAuthority("https://nia.nih.gov/x", attr)).toBe("medical-authority");
  });
});

describe("criterion 5 — near-duplicate dropping", () => {
  function src(url: string, snippet: string): BriefSource {
    return {
      url,
      domain: new URL(url).hostname,
      title: "t",
      snippet,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      authorityClass: "low-authority",
    };
  }
  it("drops sources sharing an identical content fingerprint", () => {
    const out = dedupeSources([
      src("https://a.example/1", "the same exact body text about seniors and care"),
      src("https://b.example/2", "the same exact body text about seniors and care"), // dup
      src("https://c.example/3", "a totally different unique snippet entirely here"),
    ]);
    expect(out.map((s) => s.url)).toEqual(["https://a.example/1", "https://c.example/3"]);
  });
});

describe("criterion 5 — robots.txt honored", () => {
  it("blocks a Disallow path for User-agent: *", () => {
    const robots = "User-agent: *\nDisallow: /private";
    expect(robotsAllows(robots, "/private/page")).toBe(false);
    expect(robotsAllows(robots, "/public/page")).toBe(true);
  });
  it("allows when robots is absent/unparseable (conservative)", () => {
    expect(robotsAllows(null, "/anything")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
});

describe("criterion 5 — assembleSources grades + drops unsafe URLs", () => {
  it("drops an SSRF-unsafe URL and grades the rest with fetched-at + class", () => {
    const attribution = attributionDomainSet(["myclinicblog.example"]);
    const raw: RawSerpResult[] = [
      { url: "http://169.254.169.254/meta", title: "metadata", snippet: "secret" }, // dropped
      { url: "https://nia.nih.gov/a", title: "NIA", snippet: "stat" },
      { url: "https://myclinicblog.example/b", title: "Clinic", snippet: "client fact" },
      { url: "https://randomblog.example/c", title: "Blog", snippet: "rumor" },
    ];
    const out = assembleSources(raw, attribution, () => new Date("2026-03-03T00:00:00Z"));
    expect(out.map((s) => s.url)).not.toContain("http://169.254.169.254/meta");
    const byClass = Object.fromEntries(out.map((s) => [s.domain, s.authorityClass]));
    expect(byClass["nia.nih.gov"]).toBe("medical-authority");
    expect(byClass["myclinicblog.example"]).toBe("client-fact");
    expect(byClass["randomblog.example"]).toBe("low-authority");
    // Every entry carries canonical url + domain + fetched-at + authority class.
    for (const s of out) {
      expect(s.fetchedAt).toBe("2026-03-03T00:00:00.000Z");
      expect(s.domain).toBeTruthy();
    }
  });
});

describe("criterion 6 — sourcesForYmylGrounding filters to class (a) for YMYL", () => {
  const sources: BriefSource[] = [
    { url: "https://nia.nih.gov/a", domain: "nia.nih.gov", title: "a", snippet: "x", fetchedAt: "t", authorityClass: "medical-authority" },
    { url: "https://myclinicblog.example/b", domain: "myclinicblog.example", title: "b", snippet: "y", fetchedAt: "t", authorityClass: "client-fact" },
    { url: "https://randomblog.example/c", domain: "randomblog.example", title: "c", snippet: "z", fetchedAt: "t", authorityClass: "low-authority" },
  ];
  it("YMYL → only medical-authority remain", () => {
    expect(sourcesForYmylGrounding(sources, true).map((s) => s.domain)).toEqual(["nia.nih.gov"]);
  });
  it("non-YMYL → all sources remain", () => {
    expect(sourcesForYmylGrounding(sources, false)).toHaveLength(3);
  });
});
