/**
 * Kernel route contract (`@sagemark/seo` content engine) — the SINGLE source of
 * truth for the request/response JSON schemas the four `/content/api/*` routes
 * expose AND the version the worker (the `seo-copywriter` suite skills) must
 * agree on (PR 005, lane engine-port).
 *
 * These routes ARE the host-side tools the worker calls. Two host/worker
 * agreement guards live here:
 *
 *   1. CONTRACT VERSION (criterion 8). Every route stamps `contractVersion` into
 *      its response and rejects any request whose `contractVersion` is present
 *      and mismatched. The contract-version test asserts the worker's pinned
 *      version equals `CONTENT_CONTRACT_VERSION` and FAILS THE BUILD on a
 *      mismatch — a renamed field or bumped version is caught in CI, never at
 *      runtime as a silently-skipped call.
 *
 *   2. KERNEL-HOST-UNREACHABLE (criterion 3). `KernelHostUnreachableError` +
 *      `assertKernelReachable` give the worker a single, non-silent failure when
 *      a `/content/api/*` route cannot be reached: a clear error naming the route
 *      + base URL, never a fabricated brief/draft, never a skipped gate.
 *
 * PURE + ISOMORPHIC: no Next APIs, no DB, no LLM, no `server-only` marker — this
 * module is imported by BOTH the host routes and the worker bridge, so it must
 * be importable from plain Node (the contract-version test runs in plain Node).
 * Clean ASCII / UTF-8.
 */

import { z } from "zod";

// ── Contract version (the host/worker handshake) ──────────────────────────────

/**
 * The kernel route contract version. Bump on ANY breaking request/response
 * schema change (renamed/removed field, changed semantics). The worker pins the
 * SAME constant; the contract-version test fails the build on a mismatch.
 *
 * SemVer-ish `engine/major.minor`. The matched portion for the host/worker
 * handshake is the WHOLE string — a worker on `content-engine/1.0` and a host on
 * `content-engine/1.1` is a mismatch the build must catch.
 */
export const CONTENT_CONTRACT_VERSION = "content-engine/1.0" as const;

/** The header a caller MAY send to assert its expected contract version. */
export const CONTRACT_VERSION_HEADER = "x-content-contract-version";

/**
 * The four kernel routes, as a stable enum. Used by `assertKernelReachable` so
 * an unreachable-host error always names which route the worker tried to reach.
 */
export const KERNEL_ROUTES = {
  brief: "/content/api/brief",
  draft: "/content/api/draft",
  audit: "/content/api/audit",
  publish: "/content/api/publish",
} as const;

export type KernelRouteName = keyof typeof KERNEL_ROUTES;

// ── Authority classes (the source-quality / YMYL trust layer) ─────────────────

/**
 * The authority class of a brief source (criterion 5/6). Exactly three:
 *
 *   (a) `medical-authority`  — medical/statistical authority: NIH/NIA/CDC,
 *       Alzheimer's Association + recognized medical nonprofits, `.gov`/`.edu`
 *       medical/statistical domains. The ONLY class that satisfies a YMYL
 *       numeric/medical claim's sourcing.
 *   (b) `client-fact`        — the client's `voice_specs.attributionSources[]`.
 *       Grounds CLIENT-SPECIFIC facts (a license number, a service name) only —
 *       NEVER a medical/statistical claim, even if the string appears in it.
 *   (c) `low-authority`      — scraped SERP snippet / unknown domain. Grounds
 *       nothing on its own for YMYL.
 *
 * The discriminant is load-bearing: criterion 6 is "a class-(b) or class-(c)
 * source can NEVER, by itself, satisfy a YMYL medical claim".
 */
export const AUTHORITY_CLASSES = [
  "medical-authority", // (a)
  "client-fact", // (b)
  "low-authority", // (c)
] as const;

export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

// ── Shared zod schemas (request/response shapes) ──────────────────────────────

/** A graded brief source — canonical URL + domain + fetched-at + authority class. */
export const BriefSourceSchema = z.object({
  /** Canonical (post-redirect, normalized) URL. */
  url: z.string(),
  /** Canonical hostname (lowercased, no port). */
  domain: z.string(),
  title: z.string(),
  /** First N chars of fetched page text — UNTRUSTED (never re-injected verbatim into a privileged path). */
  snippet: z.string(),
  /** ISO timestamp the page was fetched. */
  fetchedAt: z.string(),
  /** (a) medical-authority · (b) client-fact · (c) low-authority. */
  authorityClass: z.enum(AUTHORITY_CLASSES),
});

export type BriefSource = z.infer<typeof BriefSourceSchema>;

/** The tenancy key every kernel call is bound to (criterion 7). */
export const TenancyKeySchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export type TenancyKey = z.infer<typeof TenancyKeySchema>;

// ── brief route contract ──────────────────────────────────────────────────────

export const BriefRequestSchema = z
  .object({
    /** Caller's expected contract version (rejected if mismatched). */
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    clientId: z.string().uuid(),
    keyword: z.string().min(1).max(300),
    audience: z.string().min(1).max(300),
    contentType: z.enum(["blog-post", "landing-page", "faq"]),
    tone: z.enum(["authoritative", "conversational", "educational"]),
    clientYmylLeaning: z.boolean().optional(),
    operatorYmylOverride: z.boolean().optional(),
  })
  .strict();

export type BriefRequest = z.infer<typeof BriefRequestSchema>;

// ── draft route contract ──────────────────────────────────────────────────────

export const DraftRequestSchema = z
  .object({
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    /**
     * Request-supplied tenancy. NEVER trusted for the binding — it is validated
     * against the bound request context and a mismatch is a 403 (criterion 2).
     */
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    title: z.string().min(1).max(300),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase alphanumeric with hyphens"),
    body: z.string().min(1),
    excerpt: z.string().max(600).optional(),
    metaDescription: z.string().max(320).optional(),
    isYmyl: z.boolean().optional(),
    briefSnapshot: z.unknown().optional(),
    faqData: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  })
  .strict();

export type DraftRequest = z.infer<typeof DraftRequestSchema>;

// ── audit route contract (READ-ONLY) ──────────────────────────────────────────

export const AuditRequestSchema = z
  .object({
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
  })
  .strict();

export type AuditRequest = z.infer<typeof AuditRequestSchema>;

// ── publish route contract ────────────────────────────────────────────────────

export const PublishRequestSchema = z
  .object({
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
    action: z.enum(["publish", "unpublish"]),
    to: z.enum(["review", "archived"]).optional(),
  })
  .strict();

export type PublishRequest = z.infer<typeof PublishRequestSchema>;

// ── Kernel-host-unreachable (criterion 3) ─────────────────────────────────────

/**
 * The hard, non-silent failure a suite step raises when it cannot reach a
 * `/content/api/*` route. The message names the route + base URL so the worker
 * surfaces a clear `kernel host unreachable` error state and STOPS — it never
 * fabricates a brief/draft, never skips the gate, never silently no-ops.
 */
export class KernelHostUnreachableError extends Error {
  readonly code = "KERNEL_HOST_UNREACHABLE" as const;
  constructor(
    readonly route: KernelRouteName,
    readonly baseUrl: string,
    readonly cause?: unknown,
  ) {
    super(
      `kernel host unreachable: route ${KERNEL_ROUTES[route]} at base URL ${baseUrl} could not be reached`,
    );
    this.name = "KernelHostUnreachableError";
  }
}

/**
 * Assert a kernel-host fetch succeeded; throw `KernelHostUnreachableError`
 * otherwise. The worker wraps every `/content/api/*` call in this so a transport
 * failure becomes an explicit terminal error, NOT a degraded/fabricated result.
 *
 * @param route   - which kernel route was being called
 * @param baseUrl - the kernel-host base URL (named in the error)
 * @param fetcher - the actual fetch thunk (any throw/reject → unreachable)
 */
export async function assertKernelReachable(
  route: KernelRouteName,
  baseUrl: string,
  fetcher: () => Promise<Response>,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher();
  } catch (err) {
    // Transport failure (DNS, connection refused, timeout, abort) → unreachable.
    throw new KernelHostUnreachableError(route, baseUrl, err);
  }
  // A 5xx from a route that does not exist / is down is ALSO unreachable for the
  // worker's purposes — the kernel host did not serve the contract. A 502/503/504
  // (gateway/unavailable) is the unreachable signal; 4xx is a real contract reply.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new KernelHostUnreachableError(route, baseUrl, `status ${res.status}`);
  }
  return res;
}

/**
 * Assert the caller's contract version matches the host's. Returns null when the
 * caller did not pin a version (back-compat); returns a stable mismatch payload
 * when it pinned a different version. The routes 409 on a non-null result.
 */
export function checkContractVersion(
  callerVersion: string | null | undefined,
): { code: "contract-version-mismatch"; expected: string; received: string } | null {
  if (callerVersion == null) return null;
  if (callerVersion === CONTENT_CONTRACT_VERSION) return null;
  return {
    code: "contract-version-mismatch",
    expected: CONTENT_CONTRACT_VERSION,
    received: callerVersion,
  };
}
