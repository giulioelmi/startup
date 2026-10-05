import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/worker-based packages: load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "@electric-sql/pglite"],
  // Server-side PDF reading needs pdf.js's worker and fonts in the deployed bundle (Vercel).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/standard_fonts/**"],
  },
  experimental: {
    // Form uploads (default limit is 1 MB). Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
