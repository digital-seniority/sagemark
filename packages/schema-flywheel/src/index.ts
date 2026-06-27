// @sagemark/schema-flywheel — schema package entry point.
//
// drizzle.config.ts points `schema` at this file so drizzle-kit picks up every
// table re-exported here. Today the package carries only the SEO Creator
// content store (PR 004); add future domains as sibling modules + re-exports.
export * from "./content";
