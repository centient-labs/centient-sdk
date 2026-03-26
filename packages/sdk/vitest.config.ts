import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Exclude integration tests from default test run (they require engram)
    exclude: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "tests/", "**/*.config.ts"],
    },
  },
});

/**
 * To run integration tests:
 *   pnpm test:integration
 *
 * Integration tests start a real engram server and require:
 * - engram package to be built
 * - Sufficient system resources for embedded PostgreSQL
 *
 * The tests are excluded from the default test run to avoid CI issues
 * where engram may not be available.
 */
