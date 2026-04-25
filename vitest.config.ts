import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "examples/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@ocmdx/runtime/session": resolve("packages/runtime/src/session.ts"),
      "@ocmdx/runtime/protocol": resolve("packages/runtime/src/protocol.ts"),
      "@ocmdx/runtime": resolve("packages/runtime/src/index.ts"),
      "@ocmdx/transform": resolve("packages/transform/src/index.ts"),
    },
  },
});
