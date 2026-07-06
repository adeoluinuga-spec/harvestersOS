import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Database integration tests over a remote pooler need generous timeouts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: the suites share a pooled connection budget.
    fileParallelism: false,
  },
});
