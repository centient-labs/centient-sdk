/**
 * Vitest Configuration for Integration Tests
 *
 * This configuration is specifically for integration tests that require
 * a real engram server. These tests are heavier and slower than
 * unit tests, so they're run separately.
 *
 * Usage: pnpm test:integration
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only run integration tests
    include: ["tests/integration/**/*.test.ts"],
    // Longer timeout for server startup and teardown
    testTimeout: 60000,
    // Hook timeout for beforeAll/afterAll (server start/stop)
    hookTimeout: 90000,
    // Don't run in parallel - integration tests share state
    sequence: {
      concurrent: false,
    },
    // Run tests in a single thread to avoid parallel server issues
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "tests/", "**/*.config.ts"],
    },
  },
});
