import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace TypeScript packages from source.
  transpilePackages: ["@sagemark/core"],
};

export default nextConfig;
