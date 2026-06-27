import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Compile the workspace TypeScript packages from source.
  transpilePackages: ["@sagemark/core"],
  // Set the file-tracing root to the monorepo root so Next.js can include files
  // from outside apps/seo/ (e.g. skills/ at the repo root) when bundling routes.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

export default nextConfig;
