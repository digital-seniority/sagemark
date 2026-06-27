/**
 * image-resolver.test.ts — the LIVE image-resolver adapter (C.021.2 / DR-035).
 *
 * Exercises `LiveImageResolver` + `toHeroAssetLicense` against an IN-MEMORY FAKE
 * Supabase service-role client (no network, no live DB). The fake mimics just the
 * query-builder + storage surface the adapter uses:
 *   - from("content_clients").select(...).eq("id", clientId).maybeSingle()
 *   - from("generated_images").select(...).eq("workspace_id", ws).in("slug", [...])
 *   - storage.from(bucket).createSignedUrl(key, ttl)
 *
 * The load-bearing proofs (DR-033 fail-closed + tenancy):
 *   1. a LICENSED in-workspace slug resolves WITH its license + a signed url;
 *   2. an ORPHAN slug (no row) is ABSENT from the result (→ blocked);
 *   3. an UNLICENSED row (license null) resolves with `license: null` (→ blocked);
 *   4. a CROSS-WORKSPACE slug (row in a different workspace) returns NOTHING —
 *      the explicit workspace_id filter is the boundary (service-role bypasses
 *      RLS), proven by querying the SAME slug under two different client ids;
 *   5. an UNKNOWN client (no content_clients row) resolves to NO assets.
 *
 * The mapping logic toReferencedImages / parseReferencedPhotoSlugs is already
 * tested elsewhere (placeholder-strip / homepage suites) — this focuses on the
 * adapter's tenancy + license gating, per the C.021.2 scope.
 */
import { describe, it, expect } from "vitest";
import {
  LiveImageResolver,
  toHeroAssetLicense,
} from "@/lib/content/image-resolver";

// ── In-memory fake service-role Supabase client ─────────────────────

interface ClientRow {
  id: string;
  workspace_id: string;
}
interface ImageRow {
  workspace_id: string;
  slug: string | null;
  storage_key: string | null;
  license: unknown;
}

function makeFakeSupabase(opts: {
  clients: ClientRow[];
  images: ImageRow[];
  /** Storage keys that CANNOT be signed (→ url null) — exercises the sign-fail path. */
  unsignableKeys?: string[];
}) {
  const unsignable = new Set(opts.unsignableKeys ?? []);
  const signed: Array<{ key: string; ttl: number }> = [];

  function from(table: string) {
    return {
      select() {
        let eqCol = "";
        let eqVal = "";
        const api = {
          eq(col: string, val: string) {
            eqCol = col;
            eqVal = val;
            return {
              async maybeSingle() {
                if (table === "content_clients") {
                  const row =
                    opts.clients.find((c) => c.id === eqVal) ?? null;
                  return { data: row, error: null };
                }
                return { data: null, error: null };
              },
              async in(inCol: string, vals: string[]) {
                // generated_images: workspace_id eq + slug IN — the tenancy +
                // slug-match read. The eq() workspace filter is the boundary.
                const rows = opts.images.filter(
                  (r) =>
                    r[eqCol as keyof ImageRow] === eqVal &&
                    typeof r.slug === "string" &&
                    vals.includes(r.slug),
                );
                // Project to the selected columns only (slug, storage_key, license).
                void inCol;
                return {
                  data: rows.map((r) => ({
                    slug: r.slug,
                    storage_key: r.storage_key,
                    license: r.license,
                  })),
                  error: null,
                };
              },
            };
          },
        };
        return api;
      },
    };
  }

  const storage = {
    from() {
      return {
        async createSignedUrl(key: string, ttl: number) {
          if (unsignable.has(key)) {
            return { data: null, error: { message: "object not found" } };
          }
          signed.push({ key, ttl });
          return { data: { signedUrl: `https://signed.example/${key}?ttl=${ttl}` }, error: null };
        },
      };
    },
  };

  return { client: { from, storage } as never, signed };
}

// ── fixtures ────────────────────────────────────────────────────────

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_LICENSE = { provider: "generated", model: "bfl/flux-2-flex@flux-2-flex" };

// ── toHeroAssetLicense (pure mapping) ───────────────────────────────

describe("image-resolver: toHeroAssetLicense", () => {
  it("maps a generated license blob, surfacing the model as terms", () => {
    const license = toHeroAssetLicense(GEN_LICENSE);
    expect(license).not.toBeNull();
    expect(license!.provider).toBe("generated");
    expect(license!.terms).toBe("bfl/flux-2-flex@flux-2-flex");
  });

  it("returns null for an absent / provider-less blob (fail-closed, never fabricates)", () => {
    expect(toHeroAssetLicense(null)).toBeNull();
    expect(toHeroAssetLicense(undefined)).toBeNull();
    expect(toHeroAssetLicense({})).toBeNull();
    expect(toHeroAssetLicense({ model: "x" })).toBeNull();
    expect(toHeroAssetLicense("not-an-object")).toBeNull();
  });

  it("prefers an explicit terms + carries stock attribution/sourceUrl when present", () => {
    const license = toHeroAssetLicense({
      provider: "pexels",
      terms: "Pexels License",
      attribution: "Jane Doe",
      sourceUrl: "https://pexels.com/photo/1",
    });
    expect(license).toEqual({
      provider: "pexels",
      terms: "Pexels License",
      attribution: "Jane Doe",
      sourceUrl: "https://pexels.com/photo/1",
    });
  });
});

// ── LiveImageResolver: tenancy + license gating ─────────────────────

describe("image-resolver: LiveImageResolver tenancy + fail-closed gating", () => {
  it("resolves a LICENSED in-workspace slug WITH license + a signed url", async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: CLIENT_A, workspace_id: WS_A }],
      images: [
        {
          workspace_id: WS_A,
          slug: "front-porch",
          storage_key: `${WS_A}/generated/abc.png`,
          license: GEN_LICENSE,
        },
      ],
    });
    const resolver = new LiveImageResolver(fake.client);

    const assets = await resolver.resolve(CLIENT_A, ["front-porch"]);
    expect(assets).toHaveLength(1);
    expect(assets[0].slug).toBe("front-porch");
    expect(assets[0].source).toBe("generated");
    expect(assets[0].license?.provider).toBe("generated");
    expect(assets[0].url).toContain("signed.example");
    // 24h signed-url TTL.
    expect(fake.signed[0].ttl).toBe(86_400);
  });

  it("ORPHAN slug (no row) is ABSENT from the result → blocked", async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: CLIENT_A, workspace_id: WS_A }],
      images: [], // no rows at all
    });
    const resolver = new LiveImageResolver(fake.client);

    const assets = await resolver.resolve(CLIENT_A, ["ghost-slug"]);
    // Absent entirely — toReferencedImages will mark this slug resolved:false.
    expect(assets).toHaveLength(0);
  });

  it("UNLICENSED row (license null) resolves with license:null → blocked", async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: CLIENT_A, workspace_id: WS_A }],
      images: [
        {
          workspace_id: WS_A,
          slug: "no-license",
          storage_key: `${WS_A}/generated/x.png`,
          license: null,
        },
      ],
    });
    const resolver = new LiveImageResolver(fake.client);

    const assets = await resolver.resolve(CLIENT_A, ["no-license"]);
    expect(assets).toHaveLength(1);
    expect(assets[0].slug).toBe("no-license");
    // license:null → toReferencedImages marks licensed:false → publish blocks.
    expect(assets[0].license).toBeNull();
  });

  it("CROSS-WORKSPACE slug returns NOTHING — the explicit workspace_id filter is the boundary", async () => {
    // The SAME slug exists only in workspace B. Client A (→ workspace A) must not
    // reach it; client B (→ workspace B) must. Proves the filter discriminates,
    // not an empty store (service-role bypasses RLS — app filter is the gate).
    const fake = makeFakeSupabase({
      clients: [
        { id: CLIENT_A, workspace_id: WS_A },
        { id: CLIENT_B, workspace_id: WS_B },
      ],
      images: [
        {
          workspace_id: WS_B,
          slug: "shared-slug",
          storage_key: `${WS_B}/generated/b.png`,
          license: GEN_LICENSE,
        },
      ],
    });
    const resolver = new LiveImageResolver(fake.client);

    const leaked = await resolver.resolve(CLIENT_A, ["shared-slug"]);
    expect(leaked).toHaveLength(0);

    const own = await resolver.resolve(CLIENT_B, ["shared-slug"]);
    expect(own).toHaveLength(1);
    expect(own[0].slug).toBe("shared-slug");
  });

  it("UNKNOWN client (no content_clients row) resolves to NO assets → all orphaned", async () => {
    const fake = makeFakeSupabase({
      clients: [], // client id resolves to no workspace
      images: [
        {
          workspace_id: WS_A,
          slug: "front-porch",
          storage_key: `${WS_A}/generated/abc.png`,
          license: GEN_LICENSE,
        },
      ],
    });
    const resolver = new LiveImageResolver(fake.client);

    const assets = await resolver.resolve(CLIENT_A, ["front-porch"]);
    expect(assets).toHaveLength(0);
  });

  it("a row whose key cannot be signed resolves with url:null (render strips it)", async () => {
    const key = `${WS_A}/generated/gone.png`;
    const fake = makeFakeSupabase({
      clients: [{ id: CLIENT_A, workspace_id: WS_A }],
      images: [
        { workspace_id: WS_A, slug: "gone", storage_key: key, license: GEN_LICENSE },
      ],
      unsignableKeys: [key],
    });
    const resolver = new LiveImageResolver(fake.client);

    const assets = await resolver.resolve(CLIENT_A, ["gone"]);
    expect(assets).toHaveLength(1);
    expect(assets[0].url).toBeNull();
    // license is present, but the homepage render gate also requires url → strips.
    expect(assets[0].license).not.toBeNull();
  });

  it("empty / blank slug list short-circuits to no assets (no DB call needed)", async () => {
    const fake = makeFakeSupabase({ clients: [], images: [] });
    const resolver = new LiveImageResolver(fake.client);
    expect(await resolver.resolve(CLIENT_A, [])).toHaveLength(0);
    expect(await resolver.resolve(CLIENT_A, ["", "  ".trim()])).toHaveLength(0);
  });
});
