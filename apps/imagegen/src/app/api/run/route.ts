/**
 * `/api/run` — the ImageGen primary action (`@sagemark/imagegen` Stage 1).
 *
 * Parses a hero/photo generation request → calls `generateHeroImage` with LIVE
 * deps → returns the result or a typed refusal/error.
 *
 * LIVE deps (DR-013 — Gateway-only metering, no raw provider key):
 *   - generator = `makeGatewayImageGenerator` built from `ai`'s
 *     `experimental_generateImage` + `@ai-sdk/gateway`'s `gateway.imageModel`,
 *     both DYNAMICALLY imported so this route never pulls the AI SDK at module
 *     load and never needs a key just to import.
 *   - store = the fail-closed NOT_WIRED store (Stage 1) — it THROWS until the
 *     Stage-2 Supabase store lands, so the live path fails LOUD, never silently
 *     no-ops.
 *
 * DRY-RUN mode (`?dryRun=1` or `{ dryRun: true }`): generator = the fake
 * generator (zero spend), store = the in-memory store, signUrl = a fake URL.
 * Exercises the full pipeline (moderation gate, cost cap, spec constraints,
 * provenance, persist) with NO network + NO Supabase — the supported Stage-1
 * smoke path.
 *
 * Tenancy `(workspaceId, clientId)` + the per-request cost cap are enforced by
 * the orchestrator. Pre-spend moderation runs inside `generateHeroImage`.
 */

import { NextResponse } from "next/server";
import { SERVICES } from "@sagemark/core";
import {
  generateHeroImage,
  makeFakeImageGenerator,
  makeGatewayImageGenerator,
  makeInMemoryImageStore,
  makeNotWiredImageStore,
  makeDryRunSignUrl,
  CostCapExceededError,
  StoreNotWiredError,
  type HeroImageDeps,
  type ImageAspect,
  type RouteOptions,
  type GatewayImageResult,
} from "../../../engine";

const service = SERVICES.imagegen;

interface RunInput {
  subject?: unknown;
  style?: unknown;
  aspect?: unknown;
  job?: unknown;
  workspaceId?: unknown;
  clientId?: unknown;
  slug?: unknown;
  costCapUsd?: unknown;
  route?: unknown;
  seed?: unknown;
  dryRun?: unknown;
}

const ASPECTS: ReadonlyArray<ImageAspect> = ["16:9", "9:16", "1:1"];

/**
 * Build the LIVE Gateway generator (metered, DR-013). Dynamically imports the
 * AI SDK so importing this route never pulls it in or needs a key.
 */
async function makeLiveGenerator() {
  // ai@7.0.2 exports image generation as `generateImage` (the `experimental_`
  // prefix was dropped in v7 — earlier versions called it
  // `experimental_generateImage`). Same function, current name.
  const { generateImage } = await import("ai");
  const { gateway } = await import("@ai-sdk/gateway");
  return makeGatewayImageGenerator({
    // The AI SDK's typed signature is stricter than the adapter's loose
    // Record<string,unknown> args; bridge via unknown (no `any`). The adapter
    // narrows the result shape (`GatewayImageResult`) internally.
    generateImage: (args) =>
      (
        generateImage as unknown as (
          a: Record<string, unknown>,
        ) => Promise<GatewayImageResult>
      )(args),
    gatewayImageModel: (id: string) => gateway.imageModel(id),
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const input = (await request.json().catch(() => ({}))) as RunInput;

  const dryRun =
    url.searchParams.get("dryRun") === "1" || input.dryRun === true;

  // ── Validate required tenancy + subject ──
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const workspaceId =
    typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  const clientId =
    typeof input.clientId === "string" ? input.clientId.trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";

  const missing: string[] = [];
  if (!subject) missing.push("subject");
  if (!workspaceId) missing.push("workspaceId");
  if (!clientId) missing.push("clientId");
  if (!slug) missing.push("slug");
  if (missing.length > 0) {
    return NextResponse.json(
      {
        service: service.name,
        status: "error",
        error: "invalid-input",
        message: `Missing required field(s): ${missing.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const aspect: ImageAspect | undefined =
    typeof input.aspect === "string" &&
    ASPECTS.includes(input.aspect as ImageAspect)
      ? (input.aspect as ImageAspect)
      : undefined;
  const job =
    input.job === "photo" ? "photo" : input.job === "hero" ? "hero" : undefined;
  const costCapUsd =
    typeof input.costCapUsd === "number" ? input.costCapUsd : undefined;
  const seed = typeof input.seed === "number" ? input.seed : undefined;
  const route =
    input.route && typeof input.route === "object"
      ? (input.route as RouteOptions)
      : undefined;
  const style = typeof input.style === "string" ? input.style : undefined;

  // ── Assemble deps: dry-run (fakes) or live (Gateway + NOT_WIRED store) ──
  let deps: HeroImageDeps;
  if (dryRun) {
    deps = {
      generator: makeFakeImageGenerator({ costReported: 0 }),
      store: makeInMemoryImageStore(),
      signUrl: makeDryRunSignUrl(),
    };
  } else {
    deps = {
      generator: await makeLiveGenerator(),
      // Stage-1 fail-closed seam: throws StoreNotWiredError until Stage-2.
      store: makeNotWiredImageStore(),
      signUrl: async () => {
        throw new StoreNotWiredError("signUrl");
      },
    };
  }

  try {
    const result = await generateHeroImage({
      subject,
      style,
      aspect,
      job,
      workspaceId,
      clientId,
      slug,
      costCapUsd,
      route,
      seed,
      deps,
    });

    if (!result.ok) {
      // Typed moderation refusal — pre-spend, non-retriable.
      return NextResponse.json(
        {
          service: service.name,
          status: "refused",
          refusal: result.refusal,
          reason: result.reason,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      service: service.name,
      status: "ok",
      dryRun,
      result,
    });
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      return NextResponse.json(
        {
          service: service.name,
          status: "refused",
          refusal: "cost-cap",
          message: err.message,
          estimateUsd: err.estimateUsd,
          capUsd: err.capUsd,
        },
        { status: 402 },
      );
    }
    if (err instanceof StoreNotWiredError) {
      return NextResponse.json(
        {
          service: service.name,
          status: "not_wired",
          error: err.code,
          message: err.message,
        },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      {
        service: service.name,
        status: "error",
        error: "generation-failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
