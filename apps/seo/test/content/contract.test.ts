/**
 * contract — criterion 8 (contract-version host/worker agreement, fails the
 * build on a mismatch) + criterion 3 (kernel-host-unreachable hard failure).
 */

import { describe, it, expect, vi } from "vitest";
import {
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
  assertKernelReachable,
  KernelHostUnreachableError,
  KERNEL_ROUTES,
} from "@/lib/content/contract";

/**
 * THE WORKER'S PINNED CONTRACT VERSION. This is the constant the `seo-copywriter`
 * suite skills compile against (the worker side of the handshake). It is pinned
 * HERE in the test so a host-side version bump that is not mirrored on the worker
 * FAILS THE BUILD — a renamed field or bumped version is caught in CI, never at
 * runtime as a silently-skipped call (criterion 8). When the worker lands
 * (PR 006), this literal moves into the worker's source and the test imports it.
 */
const WORKER_PINNED_CONTRACT_VERSION = "content-engine/1.0";

describe("criterion 8 — contract-version handshake", () => {
  it("host and worker agree on the contract version (mismatch FAILS THE BUILD)", () => {
    expect(CONTENT_CONTRACT_VERSION).toBe(WORKER_PINNED_CONTRACT_VERSION);
  });

  it("a matching caller version is accepted (null = no mismatch)", () => {
    expect(checkContractVersion(CONTENT_CONTRACT_VERSION)).toBeNull();
    expect(checkContractVersion(undefined)).toBeNull(); // back-compat: unpinned OK
    expect(checkContractVersion(null)).toBeNull();
  });

  it("a mismatched caller version is rejected with a stable payload", () => {
    const mismatch = checkContractVersion("content-engine/0.9");
    expect(mismatch).not.toBeNull();
    expect(mismatch!.code).toBe("contract-version-mismatch");
    expect(mismatch!.expected).toBe(CONTENT_CONTRACT_VERSION);
    expect(mismatch!.received).toBe("content-engine/0.9");
  });
});

describe("criterion 3 — kernel-host-unreachable is a hard, non-silent failure", () => {
  const BASE = "https://kernel-host.internal";

  it("a transport failure throws KernelHostUnreachableError naming route + base URL", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      assertKernelReachable("audit", BASE, fetcher),
    ).rejects.toMatchObject({
      name: "KernelHostUnreachableError",
      code: "KERNEL_HOST_UNREACHABLE",
      route: "audit",
      baseUrl: BASE,
    });
    // The message names the route + base URL so the worker surfaces a clear error.
    try {
      await assertKernelReachable("audit", BASE, fetcher);
    } catch (e) {
      const err = e as KernelHostUnreachableError;
      expect(err.message).toContain(KERNEL_ROUTES.audit);
      expect(err.message).toContain(BASE);
      expect(err.message).toContain("kernel host unreachable");
    }
  });

  it("a 502/503/504 from the host is treated as unreachable (gate never skipped)", async () => {
    for (const status of [502, 503, 504]) {
      const fetcher = vi.fn(async () => new Response("", { status }));
      await expect(assertKernelReachable("publish", BASE, fetcher)).rejects.toBeInstanceOf(
        KernelHostUnreachableError,
      );
    }
  });

  it("a real 4xx contract reply is NOT unreachable (it is a genuine response)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: "tenancy-mismatch" }), { status: 403 }));
    const res = await assertKernelReachable("draft", BASE, fetcher);
    expect(res.status).toBe(403); // returned, not thrown — a real host answer
  });

  it("a successful 200 passes through untouched", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await assertKernelReachable("brief", BASE, fetcher);
    expect(res.status).toBe(200);
  });
});
