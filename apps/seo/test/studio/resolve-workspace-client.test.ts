/**
 * studio-ui (Slice 5 / P-I): the workspace -> client resolution core.
 *
 * `resolveWorkspaceClientWith` is the service-role read that resolves a workspace's
 * single `content_clients` row (the studio tenancy bridge, read side). These prove,
 * with an injected fake service-role client (no live Supabase):
 *
 *   - no client supplied (host not configured) -> null (fail-closed).
 *   - the read is EXPLICITLY scoped to the workspace id, oldest-first, limit 1.
 *   - a workspace with no client row -> null (fail-closed).
 *   - a row missing a required field (id/name/blog_slug) -> null (never partial).
 *   - a read error rethrows (fail-loud — a broken read must not silently pass).
 *   - more than one row -> the FIRST (v1: one client per workspace).
 */

import { describe, it, expect } from "vitest";

import {
  resolveWorkspaceClientWith,
  type ClientReaderSupabase,
} from "@/lib/content/resolve-workspace-client";

/** A fake terminal read builder recording the chained scope, resolving to a fixed result. */
function fakeSupabase(result: {
  data?: Record<string, unknown>[] | null;
  error?: unknown;
}): { supabase: ClientReaderSupabase; calls: { table?: string; cols?: string; eq: Array<[string, string]>; order?: [string, boolean]; limit?: number } } {
  const calls: { table?: string; cols?: string; eq: Array<[string, string]>; order?: [string, boolean]; limit?: number } = { eq: [] };
  const builder = {
    eq(col: string, val: string) {
      calls.eq.push([col, val]);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      calls.order = [col, opts?.ascending ?? true];
      return builder;
    },
    limit(n: number) {
      calls.limit = n;
      return builder;
    },
    then<R>(onfulfilled: (r: { data: Record<string, unknown>[] | null; error: unknown }) => R): Promise<R> {
      return Promise.resolve(onfulfilled({ data: result.data ?? null, error: result.error ?? null }));
    },
  };
  const supabase: ClientReaderSupabase = {
    from(table: string) {
      calls.table = table;
      return {
        select(cols: string) {
          calls.cols = cols;
          return builder as never;
        },
      };
    },
  };
  return { supabase, calls };
}

describe("resolveWorkspaceClientWith", () => {
  it("returns null when no service-role client is available (host not configured)", async () => {
    expect(await resolveWorkspaceClientWith("ws-1", null)).toBeNull();
  });

  it("scopes the read to the workspace id, oldest-first, limit 1", async () => {
    const { supabase, calls } = fakeSupabase({
      data: [{ id: "cl-1", name: "WW", blog_slug: "ww", created_at: "2026-01-01" }],
    });
    const client = await resolveWorkspaceClientWith("ws-1", supabase);
    expect(client).toEqual({ id: "cl-1", name: "WW", blogSlug: "ww" });
    expect(calls.table).toBe("content_clients");
    expect(calls.eq).toEqual([["workspace_id", "ws-1"]]);
    expect(calls.order).toEqual(["created_at", true]);
    expect(calls.limit).toBe(1);
  });

  it("returns null when the workspace owns no client", async () => {
    const { supabase } = fakeSupabase({ data: [] });
    expect(await resolveWorkspaceClientWith("ws-1", supabase)).toBeNull();
  });

  it("returns null (fail-closed) when a required field is missing", async () => {
    const { supabase } = fakeSupabase({ data: [{ id: "cl-1", name: "WW" /* no blog_slug */ }] });
    expect(await resolveWorkspaceClientWith("ws-1", supabase)).toBeNull();
  });

  it("rethrows when the read errors (fail-loud)", async () => {
    const { supabase } = fakeSupabase({ error: new Error("boom") });
    await expect(resolveWorkspaceClientWith("ws-1", supabase)).rejects.toThrow(/content_clients read failed/);
  });

  it("takes the FIRST row when more than one exists (v1: one client per workspace)", async () => {
    const { supabase } = fakeSupabase({
      data: [
        { id: "cl-1", name: "First", blog_slug: "first", created_at: "2026-01-01" },
        { id: "cl-2", name: "Second", blog_slug: "second", created_at: "2026-02-01" },
      ],
    });
    expect(await resolveWorkspaceClientWith("ws-1", supabase)).toEqual({
      id: "cl-1",
      name: "First",
      blogSlug: "first",
    });
  });
});
