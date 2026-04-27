import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "examples/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@skflow/runtime/session": resolve("packages/runtime/src/session.ts"),
      "@skflow/runtime/protocol": resolve("packages/runtime/src/protocol.ts"),
      "@skflow/runtime": resolve("packages/runtime/src/index.ts"),
      "@skflow/transform": resolve("packages/transform/src/index.ts"),
    },
  },
});
