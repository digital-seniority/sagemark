/**
 * /api/model/[...path] — the host model-proxy Route Handler (lane worker-runtime).
 *
 * THE KEYLESS WORKER'S MODEL DOOR. The Agent-SDK worker is pointed at
 * `ANTHROPIC_BASE_URL = {host}/api/model` with `ANTHROPIC_AUTH_TOKEN = <per-run
 * bridge JWT>`. The `claude` CLI / Anthropic SDK therefore POSTs to
 * `{host}/api/model/v1/messages` (and `/v1/messages/count_tokens`). This catch-all
 * captures `path = ["v1","messages"]`, hands the request to `proxyModelRequest`,
 * which verifies the bridge JWT and forwards to the metered Vercel AI Gateway
 * (`https://ai-gateway.vercel.sh/v1/messages`) with the host's `AI_GATEWAY_API_KEY`,
 * streaming the SSE response straight back. The raw Gateway key never reaches the
 * worker (DR-013).
 *
 * Fail-closed: a missing/invalid/expired/wrong-scope bridge JWT -> 401/403 and
 * NOTHING is forwarded; a missing host key -> 503. The proxy LOGIC + every
 * fail-closed branch is unit-tested against `proxyModelRequest` directly (see
 * `test/model/proxy.test.ts`) with an injected upstream fetch + injected secret,
 * so this file stays a thin, untested-by-itself wrapper.
 *
 * RUNTIME. `runtime="nodejs"` (the verifier uses node:crypto; streaming a fetch
 * body through is a Node-runtime concern). `dynamic="force-dynamic"` so the handler
 * always runs at request time (never prerendered/cached — it is a live proxy).
 * `maxDuration=300` gives a generous ceiling for long streamed generations.
 *
 * ROLLBACK: delete this route (+ `src/lib/model/proxy.ts` + the test) and the
 * worker simply has no model door again — no other surface imports them.
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";

import { proxyModelRequest } from "@/lib/model/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Generous ceiling for a long streamed generation (seconds). */
export const maxDuration = 300;

type RouteParams = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, ctx: RouteParams): Promise<Response> {
  const { path } = await ctx.params;
  return proxyModelRequest(request, path ?? []);
}

export async function POST(request: Request, ctx: RouteParams): Promise<Response> {
  return handle(request, ctx);
}

// The Anthropic SDK only POSTs to the Messages API, but GET is exposed so a
// health/probe or a GET-shaped Gateway endpoint also routes through the same
// JWT-authed, key-swapping proxy (still fail-closed on auth).
export async function GET(request: Request, ctx: RouteParams): Promise<Response> {
  return handle(request, ctx);
}
