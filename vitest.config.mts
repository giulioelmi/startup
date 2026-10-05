import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  // Each test file gets a fresh in-memory Postgres (PGlite). Starting it and rendering
  // PDF pages can take several seconds on a busy machine, hence the longer timeout.
  test: { env: { DATA_DIR: "memory" }, testTimeout: 20_000 },
});
