/**
 * Host-side live image-resolver adapter (C.021.2 / DR-035, lane schema-tenancy +
 * render-geo).
 *
 * THE GAP THIS CLOSES. A piece body references images with `[photo:slug]`
 * tokens. The publish gate (DR-033) resolves those tokens to persisted, licensed
 * `generated_images` rows and BLOCKS the publish if any is orphan/unlicensed; the
 * resource-library homepage resolves the first hero token to a license-gated,
 * signed-URL asset. Both call OPTIONAL seam methods —
 * `ContentDataAccess.resolveReferencedAssets` and
 * `PublicContentDataAccess.resolveHeroAssets` — whose LIVE impls did not exist
 * (only `NOT_WIRED_*` throw-stubs + in-memory test fixtures). This module is the
 * single live impl of BOTH (they are the same query), plus the host DB client
 * they run on.
 *
 * NON-GOAL (DR-035): this does NOT wire the full ContentDataAccess pipeline
 * (loadPiece / insertPieceVersion / …) to the DB — that is the broader DR-026
 * effort. ONLY the two image-resolver methods + their client live here.
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS. The client is the Supabase SERVICE ROLE
 * (host-side, `server-only`), so RLS is NOT the tenancy boundary here. EVERY
 * query MUST carry an explicit `workspace_id` filter; the workspace is resolved
 * from the caller's `clientId` through the `content_clients` tenancy bridge
 * (scoped to that one client id) and never taken from request input. A slug from
 * a different workspace simply produces no row (cross-workspace isolation).
 *
 * FAIL-CLOSED (DR-033, never fail-open):
 *   - a `clientId` with no `content_clients` row → resolve to NO assets (every
 *     token becomes an orphan → blocked);
 *   - a slug with no matching `generated_images` row → absent from the result
 *     (→ `toReferencedImages` marks it orphan → blocked);
 *   - a row with a null/absent `license` → `license: null` (→ blocked);
 *   - a license is NEVER fabricated.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import type {
  ContentDataAccess,
  PublicContentDataAccess,
  ReferencedHeroAsset,
  HeroAssetLicense,
} from "./context";

/** Signed-read-URL TTL: 24h (matches the imagegen/videogen bucket ceiling). */
const SIGNED_URL_TTL_SECONDS = 86_400;
/** The private generated-image bucket (mirrors imagegen GENERATED_IMAGE_BUCKET). */
const GENERATED_IMAGE_BUCKET = "seo-generated-images" as const;

/** The minimal service-role Supabase surface this adapter uses (read-only). */
interface ResolverSupabase {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        in(col: string, vals: string[]): Promise<{
          data: Record<string, unknown>[] | null;
          error: unknown;
        }>;
      };
    };
  };
  storage: {
    from(bucket: string): {
      createSignedUrl(
        key: string,
        ttl: number,
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

/** The host service-role creds the live read adapter needs. */
export function readResolverCreds(): { url: string; serviceRoleKey: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

/**
 * Map a persisted `generated_images.license` jsonb blob (the imagegen
 * `GeneratedAssetLicense` shape `{provider:"generated", model, terms?}`) to the
 * seam's `HeroAssetLicense`. Returns null when the blob is absent or has no
 * provider — fail-closed (a null license is the publish/render BLOCK condition).
 * NEVER fabricates a provider.
 */
export function toHeroAssetLicense(blob: unknown): HeroAssetLicense | null {
  if (!blob || typeof blob !== "object") return null;
  const b = blob as Record<string, unknown>;
  const provider = typeof b.provider === "string" ? b.provider : null;
  if (!provider) return null;
  // For a generated asset, the load-bearing provenance is the model id+version;
  // surface it as `terms` (the seam's compliance note), preferring an explicit
  // `terms` if the blob carried one.
  const terms =
    typeof b.terms === "string"
      ? b.terms
      : typeof b.model === "string"
        ? b.model
        : undefined;
  const license: HeroAssetLicense = { provider };
  if (terms) license.terms = terms;
  if (typeof b.attribution === "string") license.attribution = b.attribution;
  if (typeof b.sourceUrl === "string") license.sourceUrl = b.sourceUrl;
  return license;
}

/**
 * The live image-resolver, backed by a service-role Supabase client. Implements
 * both `resolveReferencedAssets` (publish) and `resolveHeroAssets` (homepage) —
 * they are the same workspace-scoped, slug-keyed, license-bearing read.
 */
export class LiveImageResolver {
  constructor(private readonly supabase: ResolverSupabase) {}

  /**
   * Resolve `clientId` → `workspaceId` via the `content_clients` tenancy bridge,
   * scoped to that single client id. Returns null when no such client row exists
   * (→ the caller resolves to NO assets → every token blocked, fail-closed).
   */
  private async resolveWorkspaceId(clientId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("content_clients")
      .select("workspace_id")
      .eq("id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `image-resolver: content_clients lookup failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    const ws = data?.workspace_id;
    return typeof ws === "string" ? ws : null;
  }

  /**
   * The single resolver both seam methods share. Returns ONLY rows that exist in
   * the resolved workspace AND match a requested slug. A missing client, a
   * missing slug, or a cross-workspace slug all yield NO entry for that slug
   * (fail-closed). A resolved row with a null license → `license: null`; a key
   * that won't sign → `url: null`.
   */
  async resolve(
    clientId: string,
    slugs: string[],
  ): Promise<ReferencedHeroAsset[]> {
    const unique = [...new Set(slugs.filter((s) => typeof s === "string" && s.length > 0))];
    if (unique.length === 0) return [];

    const workspaceId = await this.resolveWorkspaceId(clientId);
    // Fail-closed: an unknown client resolves to NO assets — every token orphans.
    if (!workspaceId) return [];

    // EXPLICIT workspace_id filter (service-role bypasses RLS — this is the
    // tenancy boundary) + slug IN the requested set. Widened select includes the
    // license blob + storage_key needed to gate + sign.
    const { data, error } = await this.supabase
      .from("generated_images")
      .select("slug, storage_key, license")
      .eq("workspace_id", workspaceId)
      .in("slug", unique);
    if (error) {
      throw new Error(
        `image-resolver: generated_images query failed for workspace=${workspaceId}: ${stringifyErr(error)}`,
      );
    }
    const rows = data ?? [];

    // One asset per slug. If multiple rows share a slug (e.g. a regenerated
    // image), keep the FIRST resolvable; the row set is workspace-scoped already.
    const seen = new Set<string>();
    const out: ReferencedHeroAsset[] = [];
    for (const row of rows) {
      const slug = typeof row.slug === "string" ? row.slug : null;
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const license = toHeroAssetLicense(row.license);
      const storageKey =
        typeof row.storage_key === "string" ? row.storage_key : null;
      const url = storageKey ? await this.signOrNull(storageKey) : null;

      out.push({ slug, source: "generated", url, license });
    }
    return out;
  }

  /** Mint a short-lived signed read URL, or null if it cannot be signed (no throw). */
  private async signOrNull(storageKey: string): Promise<string | null> {
    const { data, error } = await this.supabase.storage
      .from(GENERATED_IMAGE_BUCKET)
      .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }
}

function stringifyErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Build a `LiveImageResolver` from a service-role Supabase client — but ONLY if
 * the host creds are present. Returns null otherwise, so the caller leaves the
 * seam method ABSENT (the fixture / fail-closed default path is unchanged).
 *
 * `@supabase/supabase-js` is imported dynamically so importing this module is
 * network-free and needs no creds just to import.
 */
export async function makeLiveImageResolver(): Promise<LiveImageResolver | null> {
  const creds = readResolverCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ResolverSupabase;
  return new LiveImageResolver(supabase);
}

/**
 * Bind the live resolver onto a `ContentDataAccess.resolveReferencedAssets` /
 * `PublicContentDataAccess.resolveHeroAssets` shape. Returns the bound method
 * when the host is configured, else null (→ leave the seam method absent).
 */
export async function makeLiveResolveReferencedAssets(): Promise<
  NonNullable<ContentDataAccess["resolveReferencedAssets"]> | null
> {
  const resolver = await makeLiveImageResolver();
  if (!resolver) return null;
  return (clientId: string, slugs: string[]) => resolver.resolve(clientId, slugs);
}

export async function makeLiveResolveHeroAssets(): Promise<
  NonNullable<PublicContentDataAccess["resolveHeroAssets"]> | null
> {
  const resolver = await makeLiveImageResolver();
  if (!resolver) return null;
  return (clientId: string, slugs: string[]) => resolver.resolve(clientId, slugs);
}
