import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Plain Node — these are pure scorer/gate units (no DOM).
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // The ported gates carry `import "server-only"` (a Next.js RSC marker).
      // Vitest runs in plain Node, so alias it to an empty stub — mirrors
      // flywheel-main's vitest config.
      "server-only": path.resolve(dirname, "src/test/server-only-stub.ts"),
    },
  },
});
