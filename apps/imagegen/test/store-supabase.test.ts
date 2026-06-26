/**
 * store-supabase.test.ts — the Stage-2 Supabase-backed `GeneratedImageStore`
 * (`@sagemark/imagegen`).
 *
 * Exercises `makeSupabaseImageStore` + `makeSupabaseSignUrl` against an
 * IN-MEMORY FAKE Supabase client (no network, no spend, no live Supabase). The
 * fake mimics just the query-builder surface the store uses:
 *   - storage.from(bucket).upload(key, bytes, opts)
 *   - storage.from(bucket).createSignedUrl(key, ttl)
 *   - from("generated_images").select("*").eq().eq().maybeSingle()
 *   - from("generated_images").insert(row).select("*").single()
 *   - from("image_generations").insert(row)
 *
 * Asserts: the upload→insert→audit happy path, the dedup path (findAssetByHash
 * hit → NO second upload, but an audit row IS still written), tenancy scoping,
 * and signUrl. The live round-trip against a real Supabase branch is Tier-2/3
 * NEEDS-INPUT (migration applied + bucket created on Sagemark).
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  makeSupabaseImageStore,
  makeSupabaseSignUrl,
} from "../src/engine/store-supabase";
import { makeGeneratedLicense } from "../src/engine/assets";
import { GENERATED_IMAGE_BUCKET, type GenerationRecord } from "../src/engine/persist";
import type { CanonicalImageSpec } from "../src/engine/spec";

// ── In-memory fake Supabase client ──────────────────────────────────

interface FakeRow {
  id: string;
  workspace_id: string;
  content_hash: string;
  bucket: string;
  storage_key: string;
  bytes: number;
  content_type: string;
  model: string;
  license: unknown;
  created_at: string;
  [k: string]: unknown;
}

function makeFakeSupabase() {
  const tables: Record<string, FakeRow[]> = {
    generated_images: [],
    image_generations: [],
  };
  const uploads: Array<{ bucket: string; key: string; size: number }> = [];
  const signed: Array<{ bucket: string; key: string; ttl: number }> = [];
  let seq = 0;

  // ── storage ──
  const storage = {
    from(bucket: string) {
      return {
        async upload(key: string, bytes: Uint8Array) {
          uploads.push({ bucket, key, size: bytes.length });
          return { data: { path: key }, error: null };
        },
        async createSignedUrl(key: string, ttl: number) {
          signed.push({ bucket, key, ttl });
          return {
            data: { signedUrl: `https://signed.example/${bucket}/${key}?ttl=${ttl}` },
            error: null,
          };
        },
      };
    },
  };

  // ── postgrest query builder (only the chains the store uses) ──
  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: Array<[string, unknown]> = [];
    let pendingInsert: Record<string, unknown> | null = null;

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      async maybeSingle() {
        const match = rows.find((r) =>
          filters.every(([c, v]) => r[c] === v),
        );
        return { data: match ?? null, error: null };
      },
      insert(row: Record<string, unknown>) {
        pendingInsert = row;
        // The audit-log path does NOT chain .select().single() — it awaits the
        // insert builder directly. Make the builder thenable for that case.
        return builder;
      },
      async single() {
        const inserted: FakeRow = {
          id: `gi-${++seq}`,
          created_at: new Date(0).toISOString(),
          ...(pendingInsert as Record<string, unknown>),
        } as FakeRow;
        rows.push(inserted);
        return { data: inserted, error: null };
      },
      // Thenable so `await supabase.from("image_generations").insert(row)` works.
      then(
        resolve: (v: { data: null; error: null }) => unknown,
      ) {
        if (pendingInsert) {
          rows.push({
            id: `row-${++seq}`,
            created_at: new Date(0).toISOString(),
            ...(pendingInsert as Record<string, unknown>),
          } as FakeRow);
          pendingInsert = null;
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  const client = { storage, from } as unknown as SupabaseClient;
  return { client, tables, uploads, signed };
}

// ── fixtures ────────────────────────────────────────────────────────

const WS = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const license = makeGeneratedLicense({ model: "bfl/flux-2-flex@flux-2-flex" });

function auditRecord(over: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    workspaceId: WS,
    clientId: CLIENT,
    slug: "hero",
    spec: {} as CanonicalImageSpec,
    provider: "bfl",
    modelId: "bfl/flux-2-flex",
    modelVersion: "flux-2-flex",
    promptHash: "ph",
    costCredits: 1,
    costReported: 0.04,
    license,
    status: "succeeded",
    assetId: "gi-1",
    contentHash: "abc",
    provenance: { synthidPresent: false, c2paPresent: false },
    generatedAt: new Date(0).toISOString(),
    ...over,
  };
}

// ── tests ───────────────────────────────────────────────────────────

describe("imagegen/2 — Supabase store: upload + insert + audit", () => {
  it("uploads bytes, inserts a generated_images row, writes an audit row", async () => {
    const fake = makeFakeSupabase();
    const store = makeSupabaseImageStore(fake.client);

    await store.upload({
      bucket: GENERATED_IMAGE_BUCKET,
      key: `${WS}/generated/abc.png`,
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      contentType: "image/png",
    });
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0].bucket).toBe(GENERATED_IMAGE_BUCKET);

    const asset = await store.insertAsset({
      workspaceId: WS,
      source: "generated",
      storageKey: `${WS}/generated/abc.png`,
      contentHash: "abc",
      bytes: 5,
      license,
      tags: ["generated", "model:bfl/flux-2-flex"],
    });
    expect(fake.tables.generated_images).toHaveLength(1);
    const row = fake.tables.generated_images[0];
    // Tenancy + dedup key + bucket persisted; content_type/model derived.
    expect(row.workspace_id).toBe(WS);
    expect(row.content_hash).toBe("abc");
    expect(row.bucket).toBe(GENERATED_IMAGE_BUCKET);
    expect(row.content_type).toBe("image/png");
    expect(row.model).toBe("bfl/flux-2-flex");
    expect(asset.id).toBe(row.id);
    expect(asset.source).toBe("generated");

    await store.insertGenerationRecord(auditRecord({ assetId: asset.id }));
    expect(fake.tables.image_generations).toHaveLength(1);
    const audit = fake.tables.image_generations[0];
    expect(audit.workspace_id).toBe(WS);
    expect(audit.client_id).toBe(CLIENT);
    expect(audit.asset_id).toBe(asset.id);
    expect(audit.status).toBe("succeeded");
    expect(audit.cost_reported).toBe(0.04);
  });
});

describe("imagegen/2 — Supabase store: dedup", () => {
  it("findAssetByHash hit → caller skips upload, but the audit row is STILL written", async () => {
    const fake = makeFakeSupabase();
    const store = makeSupabaseImageStore(fake.client);

    // Seed an existing asset (simulating a prior generation).
    await store.insertAsset({
      workspaceId: WS,
      source: "generated",
      storageKey: `${WS}/generated/dup.png`,
      contentHash: "dup",
      bytes: 9,
      license,
      tags: ["generated", "model:bfl/flux-2-flex"],
    });
    expect(fake.tables.generated_images).toHaveLength(1);

    // Dedup lookup returns the existing asset within the workspace…
    const found = await store.findAssetByHash({
      workspaceId: WS,
      contentHash: "dup",
    });
    expect(found).not.toBeNull();
    expect(found!.contentHash).toBe("dup");
    // …and a different workspace does NOT see it (tenancy isolation).
    const other = await store.findAssetByHash({
      workspaceId: "99999999-9999-9999-9999-999999999999",
      contentHash: "dup",
    });
    expect(other).toBeNull();

    // The persist flow would NOT upload again on a dedup hit — assert no new
    // upload happened (zero uploads, since the seed used insertAsset directly).
    expect(fake.uploads).toHaveLength(0);
    // No second generated_images row inserted.
    expect(fake.tables.generated_images).toHaveLength(1);

    // But the audit row is STILL written (cost/provenance accounted on dedup).
    await store.insertGenerationRecord(
      auditRecord({ assetId: found!.id, contentHash: "dup" }),
    );
    expect(fake.tables.image_generations).toHaveLength(1);
    expect(fake.tables.image_generations[0].asset_id).toBe(found!.id);
  });
});

describe("imagegen/2 — Supabase store: signUrl", () => {
  it("mints a signed URL for a private-bucket key", async () => {
    const fake = makeFakeSupabase();
    const signUrl = makeSupabaseSignUrl(fake.client);
    const url = await signUrl({ key: `${WS}/generated/abc.png`, workspaceId: WS });
    expect(url).toContain(GENERATED_IMAGE_BUCKET);
    expect(url).toContain("abc.png");
    expect(fake.signed).toHaveLength(1);
    expect(fake.signed[0].bucket).toBe(GENERATED_IMAGE_BUCKET);
    // 24h TTL.
    expect(fake.signed[0].ttl).toBe(86_400);
  });
});
