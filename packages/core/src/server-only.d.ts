/**
 * Ambient declaration for Next.js's `server-only` marker module.
 *
 * `@sagemark/core` is source-consumed (DR-004) and typechecked with
 * `tsc --noEmit` in isolation, where the real `server-only` package (provided
 * by the consuming Next.js app) is not installed. The ported gates import it
 * verbatim as a side-effect-only module; this declaration lets the standalone
 * typecheck resolve it without pulling Next into the package.
 */
declare module "server-only";
