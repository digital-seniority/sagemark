/**
 * Operator-auth seam unit tests (DR-003, lane auth).
 *
 * TIER 1 (ALWAYS RUNS, no DB / no live Supabase). Drives the tenancy-critical
 * resolution + the gate flip with INJECTED FAKES:
 *
 *   - `resolveWorkspaceForOperator` (the injectable core): a fake service-role
 *     client returns a `workspace_members <-> workspaces` join row -> the mapped
 *     `Workspace`; the fail-closed branches (null client, no row, unmappable row)
 *     -> null; a read error -> rethrow (a broken read must never silently pass).
 *
 *   - `getCurrentWorkspace` (the public seam): with a mocked operator source +
 *     service-role client it resolves member -> workspace; it returns NULL when
 *     there is NO operator AND when there is NO membership — fail-closed BOTH ways
 *     (the §3.4 layer-2 tenancy boundary: tenancy is server-derived from the
 *     authenticated operator only, never request input).
 *
 *   - `requireOperator` (the gate flip): when the operator is null it REDIRECTS to
 *     `/sign-in` (Next `redirect` throws — we assert the throw, the same control-flow
 *     the framework relies on); when an operator IS present it returns them without
 *     redirecting.
 *
 * The cookie-bound server client (`createSupabaseServerClient`), the service-role
 * `@supabase/supabase-js` client, and `next/navigation`'s `redirect` are all mocked,
 * so there is NO DB, NO network, and NO Next runtime needed.
 *
 * TIER 3 (NEEDS-INPUT, NOT run here). The LIVE magic-link round-trip
 * (signInWithOtp -> email -> /auth/callback exchangeCodeForSession -> cookie session)
 * needs a DEPLOYED host + a real inbox, so it cannot run as a unit test. It is left
 * as a NEEDS-INPUT manual check — NOT faked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// -- Mocks (declared before the SUT import; vi hoists vi.mock) ------------------

// The operator source: the cookie-bound server client used by getCurrentOperator.
const getUser = vi.fn();
const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser },
}));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

// The service-role client getCurrentWorkspace builds via dynamic import.
const serviceRoleClient = { from: vi.fn() };
const createClient = vi.fn(() => serviceRoleClient);
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

// Next's redirect throws a sentinel so we can assert the gate fired.
class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new RedirectError(to);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

import {
  resolveWorkspaceForOperator,
  getCurrentWorkspace,
  requireOperator,
  type MemberReaderSupabase,
} from "@/lib/auth";

// -- A scriptable fake service-role read (the workspace_members.select chain) ---

/**
 * Build a fake `MemberReaderSupabase` whose `.from(..).select(..).eq(..).limit(..)
 * .maybeSingle()` resolves to the given `{ data, error }`. Records the table + the
 * operator id filter so the test can assert the EXPLICIT operator-scoped query.
 */
function fakeMemberReader(result: {
  data: Record<string, unknown> | null;
  error?: unknown;
}): { reader: MemberReaderSupabase; calls: { table?: string; operatorId?: string } } {
  const calls: { table?: string; operatorId?: string } = {};
  const query = {
    eq(col: string, val: string) {
      if (col === "operator_id") calls.operatorId = val;
      return query;
    },
    limit() {
      return query;
    },
    async maybeSingle() {
      return { data: result.data, error: result.error ?? null };
    },
  };
  const reader: MemberReaderSupabase = {
    from(table: string) {
      calls.table = table;
      return { select: () => query };
    },
  };
  return { reader, calls };
}

/** A well-formed join row (workspace embedded under the `workspaces` alias). */
const MEMBER_ROW = {
  operator_id: "op-1",
  workspaces: {
    id: "ws-1",
    owner_type: "user",
    owner_id: "op-1",
    name: "Whispering Willows",
  },
};

beforeEach(() => {
  getUser.mockReset();
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockResolvedValue({ auth: { getUser } });
  serviceRoleClient.from.mockReset();
  createClient.mockClear();
  redirect.mockClear();
  // Provide service-role creds so makeServiceRoleClient builds the (mocked) client.
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
});

// -- resolveWorkspaceForOperator (the injectable core) -------------------------

describe("resolveWorkspaceForOperator", () => {
  it("resolves a member -> workspace join row to the mapped Workspace", async () => {
    const { reader, calls } = fakeMemberReader({ data: MEMBER_ROW });
    const ws = await resolveWorkspaceForOperator("op-1", reader);
    expect(ws).toEqual({
      id: "ws-1",
      ownerType: "user",
      ownerId: "op-1",
      name: "Whispering Willows",
    });
    // EXPLICIT operator-scoped read of the membership table.
    expect(calls.table).toBe("workspace_members");
    expect(calls.operatorId).toBe("op-1");
  });

  it("returns null when the host has no service-role client (fail-closed)", async () => {
    expect(await resolveWorkspaceForOperator("op-1", null)).toBeNull();
  });

  it("returns null when there is no membership row (fail-closed)", async () => {
    const { reader } = fakeMemberReader({ data: null });
    expect(await resolveWorkspaceForOperator("op-1", reader)).toBeNull();
  });

  it("returns null for an unmappable row — missing workspace name (fail-closed)", async () => {
    const { reader } = fakeMemberReader({
      data: {
        operator_id: "op-1",
        workspaces: { id: "ws-1", owner_type: "user", owner_id: "op-1" },
      },
    });
    expect(await resolveWorkspaceForOperator("op-1", reader)).toBeNull();
  });

  it("returns null for an unmappable row — invalid owner_type (fail-closed)", async () => {
    const { reader } = fakeMemberReader({
      data: {
        operator_id: "op-1",
        workspaces: { id: "ws-1", owner_type: "org", owner_id: "op-1", name: "X" },
      },
    });
    expect(await resolveWorkspaceForOperator("op-1", reader)).toBeNull();
  });

  it("rethrows on a read error (fail-loud — a broken read must not silently pass)", async () => {
    const { reader } = fakeMemberReader({ data: null, error: new Error("boom") });
    await expect(resolveWorkspaceForOperator("op-1", reader)).rejects.toThrow(/boom/);
  });
});

// -- getCurrentWorkspace (the public seam, fail-closed both ways) ---------------

describe("getCurrentWorkspace", () => {
  it("resolves operator -> service-role membership -> workspace", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "op-1", email: "a@b.c" } }, error: null });
    const { reader } = fakeMemberReader({ data: MEMBER_ROW });
    serviceRoleClient.from.mockImplementation(reader.from.bind(reader));

    const ws = await getCurrentWorkspace();
    expect(ws).toEqual({
      id: "ws-1",
      ownerType: "user",
      ownerId: "op-1",
      name: "Whispering Willows",
    });
  });

  it("returns null when there is NO operator (fail-closed)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const ws = await getCurrentWorkspace();
    expect(ws).toBeNull();
    // Tenancy never widens past a missing operator: no service-role read happened.
    expect(serviceRoleClient.from).not.toHaveBeenCalled();
  });

  it("returns null when the operator has NO membership (fail-closed)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "op-1", email: "a@b.c" } }, error: null });
    const { reader } = fakeMemberReader({ data: null });
    serviceRoleClient.from.mockImplementation(reader.from.bind(reader));

    expect(await getCurrentWorkspace()).toBeNull();
  });
});

// -- requireOperator (the gate flip) -------------------------------------------

describe("requireOperator", () => {
  it("redirects to /sign-in when there is no operator (the gate flip)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireOperator()).rejects.toBeInstanceOf(RedirectError);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("returns the operator without redirecting when authenticated", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "op-1", email: "a@b.c" } }, error: null });
    const op = await requireOperator();
    expect(op).toEqual({ id: "op-1", email: "a@b.c" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
