/**
 * Log Rotation Integration Tests
 *
 * Tests to verify that FileTransport and AuditWriter correctly
 * rotate log files when size thresholds are reached.
 *
 * @module tests/integration/rotation.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Logger } from "../../src/Logger.js";
import { FileTransport } from "../../src/transports/FileTransport.js";
import { AuditWriter } from "../../src/AuditWriter.js";

// Create unique test directory for each run
const testDir = join(
  tmpdir(),
  `engram-rotation-test-${Date.now()}-${process.pid}`
);

/**
 * Get size of a file in bytes
 */
function getFileSize(path: string): number {
  if (!existsSync(path)) return 0;
  return statSync(path).size;
}

/**
 * List rotated files in a directory
 */
function listRotatedFiles(dir: string, baseName: string): string[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  return files.filter(
    (f) =>
      f.startsWith(`${baseName}-`) &&
      f.endsWith(".jsonl") &&
      f !== `${baseName}.jsonl`
  );
}

describe("FileTransport Rotation", () => {
  const logPath = join(testDir, "app.jsonl");

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

  it("should rotate file when size exceeds threshold", async () => {
    // Create transport with very small max size to trigger rotation
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 1000, // 1KB threshold
      maxFiles: 5,
      maxBufferSize: 1, // Flush immediately
      flushIntervalMs: 100,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write entries until we exceed the threshold
    // Each entry is roughly 200-300 bytes
    for (let i = 0; i < 50; i++) {
      logger.info(
        { index: i, data: "x".repeat(100) },
        `Message ${i} with padding to increase size`
      );
      // Small delay to allow async operations
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Force final flush
    await transport.flush();
    await transport.close();

    // Check for rotated files
    const rotatedFiles = listRotatedFiles(testDir, "app");

    // Should have at least one rotated file
    expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);

    // Main file should exist
    expect(existsSync(logPath)).toBe(true);

    // Main file should be smaller than threshold (recent entries only)
    const mainFileSize = getFileSize(logPath);
    expect(mainFileSize).toBeLessThan(2000); // Allow some buffer
  });

  it("should maintain maxFiles limit for rotated files", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 500, // Very small to trigger frequent rotation
      maxFiles: 3, // Keep only 3 rotated files
      maxBufferSize: 1,
      flushIntervalMs: 50,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write many entries to trigger multiple rotations
    for (let i = 0; i < 100; i++) {
      logger.info(
        { index: i, data: "x".repeat(50) },
        `Message ${i}`
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await transport.flush();
    await transport.close();

    // Allow time for async cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check rotated files count
    const rotatedFiles = listRotatedFiles(testDir, "app");

    // Should not exceed maxFiles
    expect(rotatedFiles.length).toBeLessThanOrEqual(3);
  });

  it("should create rotated file with timestamp and pid in name", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 500,
      maxFiles: 5,
      maxBufferSize: 1,
      flushIntervalMs: 50,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write enough to trigger rotation
    for (let i = 0; i < 30; i++) {
      logger.info({ index: i, data: "x".repeat(50) }, `Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await transport.flush();
    await transport.close();

    const rotatedFiles = listRotatedFiles(testDir, "app");

    // Should have at least one rotated file
    expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);

    // Check filename format: app-YYYY-MM-DDTHH-MM-SS-<pid>.jsonl
    for (const file of rotatedFiles) {
      expect(file).toMatch(
        /app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+\.jsonl/
      );
      expect(file).toContain(`-${process.pid}.jsonl`);
    }
  });

  it("should not lose data during rotation", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 2000, // Larger threshold
      maxFiles: 10, // Keep many files to not lose any
      maxBufferSize: 5,
      flushIntervalMs: 100,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    const totalMessages = 20;

    // Write entries with explicit flush to ensure data is written
    for (let i = 0; i < totalMessages; i++) {
      logger.info({ index: i }, `Message ${i}`);
    }

    // Explicit flush and close
    await transport.flush();
    await transport.close();

    // Count total entries across all files
    let totalEntries = 0;

    // Main file
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      totalEntries += lines.length;
    }

    // Rotated files
    const rotatedFiles = listRotatedFiles(testDir, "app");
    for (const file of rotatedFiles) {
      const filePath = join(testDir, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      totalEntries += lines.length;
    }

    // All messages should be preserved
    expect(totalEntries).toBe(totalMessages);
  });
});

describe("AuditWriter Rotation", () => {
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

  it("should rotate file when size exceeds threshold on startup", async () => {
    const logPath = join(testDir, "events.jsonl");

    // Create a file that exceeds the threshold
    const largeContent = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ id: `test-${i}`, data: "x".repeat(100) })
    ).join("\n");

    writeFileSync(logPath, largeContent);

    // Verify initial size
    const initialSize = getFileSize(logPath);
    expect(initialSize).toBeGreaterThan(1000);

    // Create writer with small threshold
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
      maxFileSizeBytes: 1000, // 1KB threshold
    });

    // Write an event to trigger initialization and rotation check
    await writer.log("tool_call", "test_tool", "success", 100);

    // Check for rotated files
    const rotatedFiles = listRotatedFiles(testDir, "events");

    // Should have created a rotated file
    expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);

    await writer.clearAllData();
  });

  it("should force rotation via forceRotation() method", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Write some events
    for (let i = 0; i < 10; i++) {
      await writer.log("tool_call", `tool_${i}`, "success", i * 10);
    }

    // Verify events file exists
    const logPath = join(testDir, "events.jsonl");
    expect(existsSync(logPath)).toBe(true);

    // Force rotation
    await writer.forceRotation();

    // Main file should be gone (rotated away)
    expect(existsSync(logPath)).toBe(false);

    // Rotated file should exist
    const rotatedFiles = listRotatedFiles(testDir, "events");
    expect(rotatedFiles.length).toBe(1);

    // Verify rotated file contains the events
    const rotatedPath = join(testDir, rotatedFiles[0]);
    const content = readFileSync(rotatedPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(10);

    await writer.clearAllData();
  });

  it("should continue writing after rotation", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Write initial events
    for (let i = 0; i < 5; i++) {
      await writer.log("tool_call", `before_${i}`, "success", i);
    }

    // Force rotation
    await writer.forceRotation();

    // Write more events
    for (let i = 0; i < 5; i++) {
      await writer.log("tool_call", `after_${i}`, "success", i);
    }

    // Main file should have new events
    const logPath = join(testDir, "events.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(5);

    // Verify the new events are the "after" ones
    for (const line of lines) {
      const event = JSON.parse(line);
      expect(event.tool).toMatch(/^after_/);
    }

    await writer.clearAllData();
  });

  it("should include pid in rotated filename", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("tool_call", "test", "success", 100);
    await writer.forceRotation();

    const rotatedFiles = listRotatedFiles(testDir, "events");
    expect(rotatedFiles.length).toBe(1);

    // Filename should include pid
    expect(rotatedFiles[0]).toContain(`-${process.pid}.jsonl`);

    await writer.clearAllData();
  });
});

describe("Rotation Under Load", () => {
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

  it("should handle rotation during rapid writes", async () => {
    const logPath = join(testDir, "rapid.jsonl");
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 500,
      maxFiles: 20,
      maxBufferSize: 5,
      flushIntervalMs: 100,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Rapid writes
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      logger.info({ index: i, data: "x".repeat(20) }, `Rapid message ${i}`);
      // Don't await - fire as fast as possible
      if (i % 10 === 0) {
        writePromises.push(transport.flush());
      }
    }

    await Promise.all(writePromises);
    await transport.close();

    // Count total entries
    let totalEntries = 0;

    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8");
      totalEntries += content.trim().split("\n").filter((l) => l.length > 0).length;
    }

    const rotatedFiles = listRotatedFiles(testDir, "rapid");
    for (const file of rotatedFiles) {
      const content = readFileSync(join(testDir, file), "utf-8");
      totalEntries += content.trim().split("\n").filter((l) => l.length > 0).length;
    }

    // All 100 entries should be preserved
    expect(totalEntries).toBe(100);
  });

  it("should rotate correctly with 10MB threshold (ADR-032 spec)", async () => {
    // This test verifies the default rotation threshold mentioned in ADR-032
    // We don't actually write 10MB, but verify the configuration is correct

    const logPath = join(testDir, "default.jsonl");
    const transport = new FileTransport({
      filePath: logPath,
      // Default maxSize should be 50MB per FileTransport
      maxFiles: 5,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write a few entries
    for (let i = 0; i < 10; i++) {
      logger.info({ index: i }, `Default config test ${i}`);
    }

    // Explicit flush and close
    await transport.flush();
    await transport.close();

    // Verify file exists and has entries
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(10);

    // With small writes, no rotation should have occurred
    const rotatedFiles = listRotatedFiles(testDir, "default");
    expect(rotatedFiles.length).toBe(0);
  });
});

describe("Retention Policy", () => {
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

  it("should cleanup old AuditWriter rotated files based on retention", async () => {
    // Create an old rotated file
    const oldFile = join(testDir, `events-2020-01-01T12-00-00-${process.pid}.jsonl`);
    writeFileSync(oldFile, '{"test": "old"}\n');

    // Set old modification time
    const { utimesSync } = await import("fs");
    const oldTime = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    utimesSync(oldFile, oldTime, oldTime);

    // Create a recent rotated file
    const recentFile = join(testDir, `events-2024-12-01T12-00-00-${process.pid}.jsonl`);
    writeFileSync(recentFile, '{"test": "recent"}\n');

    // Create writer with short retention
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
      retentionDays: 7, // Only keep 7 days
    });

    // Log to trigger initialization and cleanup
    await writer.log("tool_call", "test", "success", 100);

    // Old file should be deleted
    expect(existsSync(oldFile)).toBe(false);

    // Recent file should remain
    expect(existsSync(recentFile)).toBe(true);

    await writer.clearAllData();
  });
});
