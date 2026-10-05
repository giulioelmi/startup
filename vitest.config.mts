import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  // Each test file gets a fresh in-memory Postgres (PGlite).
  test: { env: { DATA_DIR: "memory" } },
});
