/**
 * Vitest Configuration for All Tests
 *
 * This configuration runs both unit tests and integration tests.
 * Use this for full test coverage locally.
 *
 * Usage: pnpm test:all
 *
 * Note: Integration tests require engram to be available.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Run all tests including integration
    include: ["tests/**/*.test.ts"],
    // Longer timeout for integration tests
    testTimeout: 60000,
    hookTimeout: 90000,
    // Run tests sequentially for integration test compatibility
    sequence: {
      concurrent: false,
    },
    // Run tests in a single thread for integration tests
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "tests/", "**/*.config.ts"],
    },
  },
});
