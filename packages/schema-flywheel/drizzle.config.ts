import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// Load env from the repo root .env.local so all packages share the same
// DATABASE_URL even though the schema package is nested.
loadEnv({ path: "../../.env.local" });

export default defineConfig({
  schema: "./src/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
