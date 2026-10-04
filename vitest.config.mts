import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: { env: { DATA_DIR: path.join(os.tmpdir(), `transfer-ai-test-${process.pid}`) } },
});
