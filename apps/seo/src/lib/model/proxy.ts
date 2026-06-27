/**
 * The host MODEL-PROXY — verify the per-run bridge JWT, then forward the worker's
 * Anthropic-Messages call to the metered Vercel AI Gateway with the HOST's key
 * (lane worker-runtime; unblocks the keyless worker's model calls).
 *
 * WHY THIS EXISTS. The worker runs the Claude Agent SDK (`claude` CLI via
 * `query()`), which speaks the Anthropic Messages API and is pointed at
 * `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. Per DR-013/DR-016 the worker is
 * KEYLESS: its `ANTHROPIC_AUTH_TOKEN` is the per-run BRIDGE JWT, NOT a Gateway/
 * provider key (`AI_GATEWAY_API_KEY` is in the worker's FORBIDDEN_ENV_KEYS). So the
 * worker cannot reach the Gateway directly — it must call through THIS host proxy,
 * which:
 *
 *   1. VERIFIES the bridge JWT (constant-time signature, then expiry, then scope)
 *      via the existing `authenticateBridgeRequest` verifier. The authoritative
 *      run/tenancy comes FROM the verified token, never from the request body/URL —
 *      so a token for run A / client A is structurally unable to act as B. A
 *      missing / malformed / expired / wrong-scope token is rejected fail-closed
 *      (401/403) and NOTHING is forwarded.
 *
 *   2. FORWARDS the request (body + the Anthropic headers) to the metered Gateway's
 *      Anthropic-native endpoint, SWAPPING the worker's bearer (the bridge JWT) for
 *      the host's `AI_GATEWAY_API_KEY`. The raw provider/Gateway key NEVER reaches
 *      the worker (DR-013 Gateway-only invariant). A missing host key is a
 *      fail-closed 503 (we never silently drop to an unauthenticated upstream).
 *
 *   3. STREAMS the upstream response straight through (SSE for `stream:true`): the
 *      upstream `ReadableStream` body is returned as-is — never buffered — so token
 *      deltas reach the worker incrementally.
 *
 * UPSTREAM (research). The Vercel AI Gateway exposes an Anthropic-Messages-API-
 * compatible surface — `POST /v1/messages` (streaming SSE) + `POST
 * /v1/messages/count_tokens` — at base URL `https://ai-gateway.vercel.sh`,
 * authenticated with the Gateway API key via either `x-api-key` or
 * `Authorization: Bearer`. (Doc: vercel.com/docs/ai-gateway/sdks-and-apis/
 * anthropic-messages-api, last_updated 2026-05-26.) This is the METERED path, so no
 * fallback to api.anthropic.com is needed. The base URL is overridable via
 * `AI_GATEWAY_BASE_URL` for tests / a future region pin.
 *
 * The proxy logic is exported as a pure-ish `proxyModelRequest(request, path, deps)`
 * so the route is a thin wrapper and the auth / fail-closed / forwarding / streaming
 * behavior is unit-tested with an injected upstream `fetch` and an injected JWT
 * secret — no live Gateway, no real key. Clean ASCII / UTF-8. No `server-only`
 * marker so plain-Node / vitest tests can import it (the host key is read lazily).
 */

import {
  authenticateBridgeRequest,
  type ContentDataAccess,
} from "@/lib/content/context";

/** The canonical metered upstream — the Vercel AI Gateway Anthropic surface. */
export const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

/**
 * Request headers we must NOT forward verbatim to the upstream. `authorization`
 * and `x-api-key` are stripped because we re-issue the host credential; `host`
 * and the hop-by-hop / length headers would be wrong for the new origin and are
 * recomputed by `fetch`.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "accept-encoding",
]);

/**
 * Response headers we must NOT copy back from the upstream — `fetch` manages the
 * transfer/encoding/length of the (possibly streamed) body itself, so echoing the
 * upstream's would corrupt the stream.
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

/** The injectable seam — tests supply an upstream fetch, a secret, and a clock. */
export interface ModelProxyDeps {
  /** The upstream HTTP transport (default: global `fetch`). Injected in tests. */
  fetchImpl?: typeof fetch;
  /** The host Gateway key (default: `process.env.AI_GATEWAY_API_KEY`). */
  gatewayApiKey?: string | undefined;
  /** The upstream base URL (default: env override or the Gateway). */
  gatewayBaseUrl?: string;
  /** Bridge-JWT signing secret override (default: host env, read in the verifier). */
  jwtSecret?: string;
  /** Clock override (epoch ms) for deterministic expiry tests. */
  nowMs?: number;
}

/**
 * A data-access stub for the verifier. The bridge path NEVER consults the DB (the
 * token is the credential), so this throws if ever called — proving the proxy can
 * only ever take the bridge path, never the operator-session/DB path. Fail-closed.
 */
const BRIDGE_ONLY_DATA: Pick<ContentDataAccess, "clientBelongsToWorkspace"> = {
  clientBelongsToWorkspace: () => {
    throw new Error(
      "model-proxy: the operator-session path is unreachable — a worker model call " +
        "MUST carry a bridge JWT (the proxy never resolves a session). Fail-closed.",
    );
  },
};

/** Small JSON error helper matching the Anthropic error envelope shape. */
function anthropicError(message: string, status: number, type = "authentication_error"): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Verify the worker's bridge JWT, then forward the Anthropic-Messages request to
 * the metered Gateway with the host key, streaming the response straight through.
 *
 *   - 401 — no / malformed / expired / bad-signature bridge JWT.
 *   - 403 — a valid token scoped to a different run/tenant (defense-in-depth; the
 *           proxy derives scope from the token, so this is for tampered tokens).
 *   - 503 — the host `AI_GATEWAY_API_KEY` is not configured (never forward keyless).
 *   - else — the upstream status + a transparently-piped (streaming) body.
 *
 * `path` is the catch-all segment AFTER `/api/model` (e.g. `["v1","messages"]`);
 * the SDK targets `ANTHROPIC_BASE_URL = {host}/api/model`, so it appends
 * `/v1/messages` and we re-build that exact path on the Gateway.
 */
export async function proxyModelRequest(
  request: Request,
  path: string[],
  deps: ModelProxyDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (
    deps.gatewayBaseUrl ??
    process.env.AI_GATEWAY_BASE_URL ??
    DEFAULT_GATEWAY_BASE_URL
  ).replace(/\/+$/, "");

  // 1. AUTH (fail-closed). The token IS the credential — `requestedClientId=""`
  //    skips the body-vs-token clientId cross-check (the Anthropic Messages body
  //    carries no clientId), so tenancy/run is taken purely from the verified
  //    token. A missing/invalid/expired/wrong-scope token never forwards.
  const auth = await authenticateBridgeRequest(
    request,
    "", // no body clientId — the proxy binds scope from the token only
    BRIDGE_ONLY_DATA,
    async () => null, // no operator session: a session-path attempt is unauthorized
    { secret: deps.jwtSecret, nowMs: deps.nowMs },
  );
  if (!auth.ok) {
    const type = auth.status === 403 ? "permission_error" : "authentication_error";
    return anthropicError(`bridge token rejected: ${auth.code}`, auth.status, type);
  }

  // 2. HOST KEY (fail-closed). Never forward without the host's metered Gateway
  //    key — a keyless upstream call would either 401 at the Gateway or, worse,
  //    leak the worker's bridge JWT onward. 503 means "host misconfigured".
  const gatewayApiKey =
    deps.gatewayApiKey !== undefined ? deps.gatewayApiKey : process.env.AI_GATEWAY_API_KEY;
  if (!gatewayApiKey) {
    return anthropicError(
      "model proxy is not configured: AI_GATEWAY_API_KEY is not set on the host (fail-closed).",
      503,
      "api_error",
    );
  }

  // 3. FORWARD. Rebuild the upstream URL from the catch-all path + the original
  //    query string, copy the safe request headers, and swap in the host key.
  const incomingUrl = new URL(request.url);
  const upstreamPath = path.length > 0 ? `/${path.map(encodeURIComponent).join("/")}` : "";
  const upstreamUrl = `${baseUrl}${upstreamPath}${incomingUrl.search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });
  // The host credential — the worker never sees this. Send BOTH header forms the
  // Gateway accepts; the key takes precedence over any OIDC token upstream.
  forwardHeaders.set("authorization", `Bearer ${gatewayApiKey}`);
  forwardHeaders.set("x-api-key", gatewayApiKey);

  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers: forwardHeaders,
      // Stream the request body straight through (do not buffer). `duplex:"half"`
      // is required by the Fetch spec when sending a streaming body.
      body: request.body,
      // @ts-expect-error — `duplex` is valid at runtime (Node/undici) but missing
      // from the lib.dom RequestInit type in this TS version.
      duplex: "half",
      redirect: "manual",
    });
  } catch (err) {
    return anthropicError(
      `upstream model gateway request failed: ${(err as Error).message}`,
      502,
      "api_error",
    );
  }

  // 4. STREAM THROUGH. Return the upstream body as-is (a ReadableStream for SSE) —
  //    never `.json()`/`.text()` it, so token deltas pass incrementally.
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
