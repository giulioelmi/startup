import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/worker-based packages: load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
