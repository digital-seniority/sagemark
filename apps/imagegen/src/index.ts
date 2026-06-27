/**
 * `@sagemark/imagegen` — package entry point.
 *
 * Re-exports the imagegen engine so consumers (e.g. `apps/seo`'s
 * `src/lib/tools/hero-image.ts`, RFC PR 017) can import the orchestrator +
 * generators IN-PROCESS:
 *
 *   import {
 *     generateHeroImage,
 *     makeGatewayImageGenerator,
 *     makeFakeImageGenerator,
 *   } from "@sagemark/imagegen";
 *
 * Source-consumed (the package `exports` point at this `.ts` file), mirroring
 * `@sagemark/core` — so the consuming build (apps/seo) must stay green.
 */

export * from "./engine";
