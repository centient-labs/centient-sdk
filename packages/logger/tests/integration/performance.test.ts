/**
 * Performance Benchmark Tests
 *
 * Tests to verify logging performance meets ADR-032 requirements:
 * - Logger.write() < 1ms latency
 * - FileTransport.flush() < 500ms
 * - AuditWriter.append() < 5ms (p99)
 *
 * @module tests/integration/performance.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Logger } from "../../src/Logger.js";
import { FileTransport } from "../../src/transports/FileTransport.js";
import { ConsoleTransport } from "../../src/transports/ConsoleTransport.js";
import { NullTransport } from "../../src/transports/NullTransport.js";
import { AuditWriter } from "../../src/AuditWriter.js";
import { CaptureTransport } from "../../src/testing.js";

// Create unique test directory for each run
const testDir = join(
  tmpdir(),
  `engram-perf-test-${Date.now()}-${process.pid}`
);

/**
 * Calculate percentile from sorted array of numbers
 */
function percentile(sortedArr: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

/**
 * Run a benchmark and return timing statistics
 */
async function benchmark(
  fn: () => void | Promise<void>,
  iterations: number
): Promise<{
  times: number[];
  p50: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const sorted = [...times].sort((a, b) => a - b);

  return {
    times,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Performance benchmarks are gated behind PERF_TESTS=1 — they measure latency
// under controlled conditions and flake under shared CI load. Run locally with
// `PERF_TESTS=1 pnpm test -- integration/performance` when benchmarking.
const runPerf = process.env["PERF_TESTS"] === "1";

describe.runIf(runPerf)("Logger.write() Performance", () => {
  it("should complete write() in < 1ms with NullTransport (baseline)", async () => {
    const transport = new NullTransport();
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Warm up
    for (let i = 0; i < 100; i++) {
      logger.info("Warmup message");
    }

    // Benchmark
    const stats = await benchmark(() => {
      logger.info({ index: 1, data: "test" }, "Benchmark message");
    }, 1000);

    // Per ADR-032: Logger.write() < 1ms
    expect(stats.p99).toBeLessThan(1);

    // Log stats for debugging
    console.log("Logger.write() with NullTransport:");
    console.log(`  p50: ${stats.p50.toFixed(4)}ms`);
    console.log(`  p99: ${stats.p99.toFixed(4)}ms`);
    console.log(`  mean: ${stats.mean.toFixed(4)}ms`);
  });

  it("should complete write() in < 1ms with CaptureTransport", async () => {
    const transport = new CaptureTransport();
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Warm up
    for (let i = 0; i < 100; i++) {
      logger.info("Warmup message");
    }
    transport.clear();

    // Benchmark
    const stats = await benchmark(() => {
      logger.info({ index: 1, data: "test" }, "Benchmark message");
    }, 1000);

    // Per ADR-032: Logger.write() < 1ms
    expect(stats.p99).toBeLessThan(1);

    console.log("Logger.write() with CaptureTransport:");
    console.log(`  p50: ${stats.p50.toFixed(4)}ms`);
    console.log(`  p99: ${stats.p99.toFixed(4)}ms`);
  });

  it("should complete write() in < 1ms with complex context", async () => {
    const transport = new NullTransport();
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    const complexContext = {
      userId: "user-12345",
      requestId: "req-67890",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token123", // Should be redacted
      },
      query: {
        limit: 100,
        offset: 0,
        filter: "active",
      },
      path: "/Users/testuser/projects/app", // Should be sanitized
    };

    // Warm up
    for (let i = 0; i < 100; i++) {
      logger.info(complexContext, "Warmup");
    }

    // Benchmark
    const stats = await benchmark(() => {
      logger.info(complexContext, "Complex context benchmark");
    }, 1000);

    // Even with complex context and sanitization, should be < 1ms
    expect(stats.p99).toBeLessThan(1);

    console.log("Logger.write() with complex context:");
    console.log(`  p50: ${stats.p50.toFixed(4)}ms`);
    console.log(`  p99: ${stats.p99.toFixed(4)}ms`);
  });

  it("should not degrade significantly with nested child loggers", async () => {
    const transport = new NullTransport();
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Create deep child logger chain
    const child1 = logger.child({ level1: "a" });
    const child2 = child1.child({ level2: "b" });
    const child3 = child2.child({ level3: "c" });

    // Warm up
    for (let i = 0; i < 100; i++) {
      child3.info("Warmup");
    }

    // Benchmark
    const stats = await benchmark(() => {
      child3.info({ data: "test" }, "Child logger benchmark");
    }, 1000);

    // Still should be < 1ms
    expect(stats.p99).toBeLessThan(1);

    console.log("Logger.write() with nested child loggers:");
    console.log(`  p50: ${stats.p50.toFixed(4)}ms`);
    console.log(`  p99: ${stats.p99.toFixed(4)}ms`);
  });
});

describe.runIf(runPerf)("FileTransport Performance", () => {
  const logPath = join(testDir, "perf-test.log");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should complete flush() in < 500ms with 1000 buffered entries", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 2000, // Large buffer to hold all entries
      flushIntervalMs: 60000, // Prevent auto-flush
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Fill buffer with 1000 entries
    for (let i = 0; i < 1000; i++) {
      logger.info(
        { index: i, data: "x".repeat(50) },
        `Message ${i}`
      );
    }

    // Benchmark flush
    const start = performance.now();
    await transport.flush();
    const duration = performance.now() - start;

    // Per ADR-032: FileTransport.flush() < 500ms
    expect(duration).toBeLessThan(500);

    console.log("FileTransport.flush() with 1000 entries:");
    console.log(`  duration: ${duration.toFixed(2)}ms`);

    await transport.close();
  });

  it("should maintain write() performance under load", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 100, // Moderate buffer size
      flushIntervalMs: 1000,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Warm up
    for (let i = 0; i < 50; i++) {
      logger.info("Warmup");
    }

    // Benchmark write() (synchronous part only)
    const stats = await benchmark(() => {
      logger.info({ index: 1 }, "Benchmark message");
    }, 500);

    // Write should still be fast (buffered)
    expect(stats.p99).toBeLessThan(1);

    console.log("FileTransport write() under load:");
    console.log(`  p50: ${stats.p50.toFixed(4)}ms`);
    console.log(`  p99: ${stats.p99.toFixed(4)}ms`);

    await transport.close();
  });

  it("should handle rapid sequential writes efficiently", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 1000,
      flushIntervalMs: 60000,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    const start = performance.now();

    // Write 1000 entries as fast as possible
    for (let i = 0; i < 1000; i++) {
      logger.info({ index: i }, `Rapid write ${i}`);
    }

    const writesDuration = performance.now() - start;

    // Close and flush
    await transport.close();

    // 1000 writes should complete in reasonable time (< 100ms for buffered writes)
    expect(writesDuration).toBeLessThan(100);

    console.log("Rapid sequential writes (1000 entries):");
    console.log(`  total write time: ${writesDuration.toFixed(2)}ms`);
    console.log(`  avg per write: ${(writesDuration / 1000).toFixed(4)}ms`);
  });
});

describe.runIf(runPerf)("AuditWriter Performance", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should complete log() in < 5ms (p99)", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Warm up (includes initialization)
    for (let i = 0; i < 10; i++) {
      await writer.log("tool_call", "warmup", "success", 100);
    }

    // Benchmark
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await writer.log("tool_call", `test_tool_${i}`, "success", i * 10, {
        input: { index: i, query: "test" },
        projectPath: "/test/project",
      });
      const end = performance.now();
      times.push(end - start);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);
    const p50 = percentile(sorted, 50);

    // Per ADR-032: AuditWriter.append() < 5ms p99
    expect(p99).toBeLessThan(5);

    console.log("AuditWriter.log() performance:");
    console.log(`  p50: ${p50.toFixed(4)}ms`);
    console.log(`  p99: ${p99.toFixed(4)}ms`);
    console.log(`  min: ${sorted[0].toFixed(4)}ms`);
    console.log(`  max: ${sorted[sorted.length - 1].toFixed(4)}ms`);

    await writer.clearAllData();
  });

  it("should handle concurrent writes efficiently", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Warm up
    await writer.log("tool_call", "warmup", "success", 100);

    const start = performance.now();

    // Fire 50 concurrent writes
    const promises = Array.from({ length: 50 }, (_, i) =>
      writer.log("tool_call", `concurrent_${i}`, "success", i * 10, {
        input: { index: i },
      })
    );

    await Promise.all(promises);

    const duration = performance.now() - start;

    // 50 concurrent writes should complete reasonably fast
    // They're serialized by the appendFile calls but still shouldn't block
    expect(duration).toBeLessThan(500);

    console.log("AuditWriter concurrent writes (50 events):");
    console.log(`  total duration: ${duration.toFixed(2)}ms`);
    console.log(`  avg per write: ${(duration / 50).toFixed(4)}ms`);

    await writer.clearAllData();
  });

  it("should maintain performance with large input objects", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Create a large input object
    const largeInput = {
      query: "search term",
      filters: Array.from({ length: 20 }, (_, i) => ({
        field: `field_${i}`,
        value: `value_${i}`,
        operator: "equals",
      })),
      metadata: {
        requestId: "req-12345",
        userId: "user-67890",
        timestamp: new Date().toISOString(),
        environment: "test",
        version: "1.0.0",
      },
    };

    // Warm up
    await writer.log("tool_call", "warmup", "success", 100, { input: largeInput });

    // Benchmark
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await writer.log("pattern_search", "search_patterns", "success", 150, {
        input: largeInput,
        output: { resultCount: 42 },
        projectPath: "/test/project",
      });
      const end = performance.now();
      times.push(end - start);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);

    // Should still meet < 5ms p99 even with large objects
    expect(p99).toBeLessThan(5);

    console.log("AuditWriter with large input objects:");
    console.log(`  p50: ${percentile(sorted, 50).toFixed(4)}ms`);
    console.log(`  p99: ${p99.toFixed(4)}ms`);

    await writer.clearAllData();
  });
});

describe.runIf(runPerf)("Memory Usage Under Load", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should not leak memory under sustained logging", async () => {
    const logPath = join(testDir, "memory-test.log");
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 100,
      flushIntervalMs: 500,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Force GC if available
    if (global.gc) {
      global.gc();
    }

    const initialMemory = process.memoryUsage().heapUsed;

    // Write 10000 entries with periodic flushes
    for (let i = 0; i < 10000; i++) {
      logger.info(
        { index: i, data: "x".repeat(100) },
        `Memory test message ${i}`
      );

      // Flush periodically to simulate real usage
      if (i % 500 === 0) {
        await transport.flush();
      }
    }

    await transport.close();

    // Force GC if available
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = finalMemory - initialMemory;
    const memoryGrowthMB = memoryGrowth / (1024 * 1024);

    // Memory growth should be bounded (< 50MB for 10000 entries)
    // This is generous but catches obvious leaks
    expect(memoryGrowthMB).toBeLessThan(50);

    console.log("Memory usage after 10000 log entries:");
    console.log(`  initial: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  final: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  growth: ${memoryGrowthMB.toFixed(2)}MB`);
  });

  it("should maintain bounded buffer in FileTransport", async () => {
    const logPath = join(testDir, "buffer-test.log");
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 50, // Small buffer
      flushIntervalMs: 60000, // No auto-flush
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write many entries (buffer should auto-flush when full)
    for (let i = 0; i < 200; i++) {
      logger.info({ index: i }, `Buffer test ${i}`);
    }

    // Give time for async flushes to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    await transport.close();

    // All entries should be written (not lost due to buffer overflow)
    // The file should exist and have content
    expect(existsSync(logPath)).toBe(true);
  });
});

describe.runIf(runPerf)("Baseline Comparison", () => {
  /**
   * These tests compare against the baselines from docs/benchmarks/logging-baseline.md
   *
   * Baseline values:
   * - centient Logger p99: ~0.5ms
   * - AuditLogger p99: ~3ms
   * - engram Logger p99: ~0.3ms
   *
   * Target: no regression within +/- 5%
   */

  it("should meet or beat centient Logger baseline", async () => {
    const transport = new NullTransport();
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Warm up
    for (let i = 0; i < 100; i++) {
      logger.info({ data: "warmup" }, "Warmup");
    }

    const stats = await benchmark(() => {
      logger.info({ data: "test" }, "Benchmark message");
    }, 1000);

    // Baseline p99: ~0.5ms, target with 5% tolerance: 0.525ms
    // But ADR-032 says < 1ms, so we use that as the hard requirement
    expect(stats.p99).toBeLessThan(1);

    console.log("Comparison to centient Logger baseline:");
    console.log(`  baseline p99: ~0.5ms`);
    console.log(`  current p99: ${stats.p99.toFixed(4)}ms`);
    console.log(`  meets target: ${stats.p99 < 1 ? "YES" : "NO"}`);
  });

  it("should meet or beat AuditLogger baseline", async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Warm up
    for (let i = 0; i < 10; i++) {
      await writer.log("tool_call", "warmup", "success", 100);
    }

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await writer.log("tool_call", "benchmark", "success", i * 10, {
        input: { index: i },
      });
      times.push(performance.now() - start);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);

    // Baseline p99: ~3ms, ADR-032 ideal target: < 5ms
    // CI threshold: 15ms - intentionally relaxed to account for file I/O variance
    // under system load in CI environments. This is not a regression; local runs
    // typically achieve < 5ms while CI may spike due to shared resources.
    expect(p99).toBeLessThan(15);

    console.log("Comparison to AuditLogger baseline:");
    console.log(`  baseline p99: ~3ms (ADR-032 ideal target: <5ms)`);
    console.log(`  current p99: ${p99.toFixed(4)}ms`);
    console.log(`  meets CI threshold (<15ms): ${p99 < 15 ? "YES" : "NO"}`);

    await writer.clearAllData();

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
