import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // The imagegen engine + orchestrator are pure units: the generator + store
    // are injected/faked (no live AI Gateway, no Supabase, no spend), so the
    // node environment is sufficient. Mirrors apps/seo's vitest setup.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `@/` → apps/imagegen/src (mirrors tsconfig paths).
      "@": path.resolve(dirname, "src"),
    },
  },
});
