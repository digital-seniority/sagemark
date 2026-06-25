/**
 * Vitest stub for Next.js's `server-only` marker module.
 *
 * The kernel routes + serp-fetch carry `import "server-only"` (an RSC boundary
 * marker Next provides at runtime). Vitest runs in plain Node where it does not
 * resolve, so it is aliased to this empty module in `vitest.config.ts` — mirrors
 * `@sagemark/core`'s `src/test/server-only-stub.ts`.
 */
export {};
