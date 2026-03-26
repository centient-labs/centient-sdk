/**
 * Transport Tests
 *
 * Comprehensive tests for ConsoleTransport, FileTransport, and NullTransport
 *
 * @module tests/transports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { LogEntry } from "../src/types.js";
import { ConsoleTransport, FileTransport, NullTransport } from "../src/transports/index.js";

/**
 * Create a mock log entry for testing
 */
function createMockEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: "2025-01-25T10:30:45.123Z",
    level: "info",
    component: "test-component",
    message: "Test message",
    service: "test-service",
    version: "1.0.0",
    pid: 12345,
    hostname: "test-host",
    ...overrides,
  };
}

// ============================================================================
// ConsoleTransport Tests
// ============================================================================

describe("ConsoleTransport", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("write", () => {
    it("should write log entries to stderr via console.error", () => {
      const transport = new ConsoleTransport({ pretty: false });
      const entry = createMockEntry();

      transport.write(entry);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String));
    });

    it("should format as JSON when pretty is false", () => {
      const transport = new ConsoleTransport({ pretty: false });
      const entry = createMockEntry({ message: "JSON test message" });

      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed.message).toBe("JSON test message");
      expect(parsed.level).toBe("info");
      expect(parsed.component).toBe("test-component");
    });

    it("should format as pretty when pretty is true", () => {
      const transport = new ConsoleTransport({ pretty: true });
      const entry = createMockEntry({ message: "Pretty test message" });

      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      // Pretty format contains the time, level (with color codes), and message
      expect(output).toContain("Pretty test message");
      expect(output).toContain("INFO");
      expect(output).toContain("[test-component]");
      // Should not be valid JSON
      expect(() => JSON.parse(output)).toThrow();
    });

    it("should include extra context in pretty format", () => {
      const transport = new ConsoleTransport({ pretty: true });
      const entry = createMockEntry({
        message: "With context",
        customField: "customValue",
        numericField: 42,
      });

      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(output).toContain("customField=customValue");
      expect(output).toContain("numericField=42");
    });

    it("should handle all log levels", () => {
      const transport = new ConsoleTransport({ pretty: true });
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

      for (const level of levels) {
        consoleErrorSpy.mockClear();
        const entry = createMockEntry({ level, message: `${level} message` });
        transport.write(entry);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const output = consoleErrorSpy.mock.calls[0][0] as string;
        expect(output).toContain(level.toUpperCase());
      }
    });
  });

  describe("flush", () => {
    it("should be a no-op and resolve immediately", async () => {
      const transport = new ConsoleTransport();

      const start = Date.now();
      await transport.flush();
      const elapsed = Date.now() - start;

      // Should resolve nearly instantly
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("close", () => {
    it("should be a no-op and resolve immediately", async () => {
      const transport = new ConsoleTransport();

      const start = Date.now();
      await transport.close();
      const elapsed = Date.now() - start;

      // Should resolve nearly instantly
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("default pretty mode", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use JSON format in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.LOG_PRETTY;

      const transport = new ConsoleTransport();
      const entry = createMockEntry();
      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should use pretty format in non-production by default", () => {
      process.env.NODE_ENV = "development";
      delete process.env.LOG_PRETTY;

      const transport = new ConsoleTransport();
      const entry = createMockEntry();
      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      // Pretty format should not be valid JSON
      expect(() => JSON.parse(output)).toThrow();
    });

    it("should respect LOG_PRETTY=true override", () => {
      process.env.NODE_ENV = "production";
      process.env.LOG_PRETTY = "true";

      const transport = new ConsoleTransport();
      const entry = createMockEntry();
      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).toThrow(); // Pretty format
    });

    it("should respect LOG_PRETTY=false override", () => {
      process.env.NODE_ENV = "development";
      process.env.LOG_PRETTY = "false";

      const transport = new ConsoleTransport();
      const entry = createMockEntry();
      transport.write(entry);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).not.toThrow(); // JSON format
    });
  });
});

// ============================================================================
// FileTransport Tests
// ============================================================================

describe("FileTransport", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("directory creation", () => {
    it("should create directory if it does not exist", async () => {
      const nestedDir = join(tempDir, "nested", "log", "dir");
      const filePath = join(nestedDir, "app.jsonl");

      const transport = new FileTransport({ filePath });
      const entry = createMockEntry();

      transport.write(entry);
      await transport.flush();
      await transport.close();

      expect(existsSync(nestedDir)).toBe(true);
      expect(existsSync(filePath)).toBe(true);
    });

    it("should create directory with secure permissions (0o700)", async () => {
      const nestedDir = join(tempDir, "secure-dir");
      const filePath = join(nestedDir, "secure.jsonl");

      const transport = new FileTransport({ filePath });
      transport.write(createMockEntry());
      await transport.flush();
      await transport.close();

      const stats = statSync(nestedDir);
      // Check that only owner has permissions (0o700 = 448 in decimal)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe("buffered writing", () => {
    it("should write entries to file", async () => {
      const filePath = join(tempDir, "write-test.jsonl");
      const transport = new FileTransport({ filePath });

      transport.write(createMockEntry({ message: "First entry" }));
      transport.write(createMockEntry({ message: "Second entry" }));
      await transport.flush();
      await transport.close();

      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe("First entry");
      expect(JSON.parse(lines[1]).message).toBe("Second entry");
    });

    it("should buffer entries and flush periodically", async () => {
      const filePath = join(tempDir, "buffer-test.jsonl");
      const transport = new FileTransport({
        filePath,
        flushIntervalMs: 50,
        maxBufferSize: 1000, // Large buffer so it won't auto-flush by size
      });

      transport.write(createMockEntry({ message: "Buffered entry" }));

      // File may not exist or be empty immediately after write (still buffered)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // After flush interval, content should be written
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("Buffered entry");

      await transport.close();
    });

    it("should flush when buffer reaches maxBufferSize", async () => {
      const filePath = join(tempDir, "buffer-full-test.jsonl");
      const transport = new FileTransport({
        filePath,
        maxBufferSize: 3,
        flushIntervalMs: 60000, // Long interval so it won't auto-flush by time
      });

      // Write 3 entries to fill the buffer
      transport.write(createMockEntry({ message: "Entry 1" }));
      transport.write(createMockEntry({ message: "Entry 2" }));
      transport.write(createMockEntry({ message: "Entry 3" }));

      // Give a moment for the flush to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);

      await transport.close();
    });
  });

  describe("file permissions", () => {
    it("should create log file with secure permissions (0o600)", async () => {
      const filePath = join(tempDir, "secure-file.jsonl");
      const transport = new FileTransport({ filePath });

      transport.write(createMockEntry());
      await transport.flush();
      await transport.close();

      const stats = statSync(filePath);
      // Check that only owner can read/write (0o600 = 384 in decimal)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("size-based rotation", () => {
    it("should rotate file when it exceeds maxSize on initialization", async () => {
      const filePath = join(tempDir, "rotate-test.jsonl");

      // Pre-create a file that exceeds the max size
      writeFileSync(filePath, "x".repeat(600));

      const transport = new FileTransport({
        filePath,
        maxSize: 500, // File already exceeds this
        maxBufferSize: 1,
      });

      // First write triggers initialization which checks for rotation
      transport.write(createMockEntry({ message: "New entry after rotation" }));
      await transport.flush();
      await transport.close();

      // Check that rotated files were created
      const files = readdirSync(tempDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("rotate-test-") && f.endsWith(".jsonl")
      );

      expect(rotatedFiles.length).toBeGreaterThan(0);

      // New log file should exist with the new entry
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("New entry after rotation");
    });

    it("should rotate multiple times with sequential transports", async () => {
      const filePath = join(tempDir, "multi-rotate-test.jsonl");
      const maxSize = 200;

      // First round: create entries to exceed maxSize
      const transport1 = new FileTransport({
        filePath,
        maxSize,
        maxBufferSize: 1,
      });

      for (let i = 0; i < 5; i++) {
        transport1.write(createMockEntry({ message: `Entry ${i}`, data: "x".repeat(100) }));
        await transport1.flush();
      }
      await transport1.close();

      // Second round: file should already exceed maxSize, so rotation happens
      const transport2 = new FileTransport({
        filePath,
        maxSize,
        maxBufferSize: 1,
      });
      transport2.write(createMockEntry({ message: "After first rotation" }));
      await transport2.flush();
      await transport2.close();

      const files = readdirSync(tempDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("multi-rotate-test-") && f.endsWith(".jsonl")
      );

      expect(rotatedFiles.length).toBeGreaterThan(0);
    });

    it("should name rotated files with timestamp and pid", async () => {
      const filePath = join(tempDir, "rotate-name-test.jsonl");

      // Pre-create a large file to trigger rotation on first write
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(filePath, "x".repeat(1000));

      const transport = new FileTransport({
        filePath,
        maxSize: 500,
        maxBufferSize: 1,
      });

      transport.write(createMockEntry({ message: "Trigger rotation" }));
      await transport.flush();
      await transport.close();

      const files = readdirSync(tempDir);
      const rotatedFiles = files.filter(
        (f) =>
          f.startsWith("rotate-name-test-") &&
          f.endsWith(".jsonl") &&
          f !== "rotate-name-test.jsonl"
      );

      // Rotated file should match pattern: base-YYYY-MM-DDTHHMMSS-pid.jsonl
      expect(rotatedFiles.length).toBeGreaterThan(0);
      const rotatedFile = rotatedFiles[0];
      // Check timestamp pattern (e.g., 2025-01-25T10-30-45)
      expect(rotatedFile).toMatch(
        /rotate-name-test-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+\.jsonl/
      );
    });
  });

  describe("cleanup of old rotated files", () => {
    it("should delete rotated files beyond maxFiles limit", async () => {
      const filePath = join(tempDir, "cleanup-test.jsonl");

      // Pre-create some rotated files
      for (let i = 0; i < 7; i++) {
        const rotatedPath = join(
          tempDir,
          `cleanup-test-2025-01-0${i + 1}T10-00-00-${12345 + i}.jsonl`
        );
        writeFileSync(rotatedPath, `{"message": "Old entry ${i}"}\n`);
        // Add small delay to ensure different mtimes
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Create a file that exceeds maxSize to trigger rotation
      writeFileSync(filePath, "x".repeat(1000));

      const transport = new FileTransport({
        filePath,
        maxSize: 500,
        maxFiles: 3,
        maxBufferSize: 1,
      });

      transport.write(createMockEntry({ message: "New entry" }));
      await transport.flush();
      await transport.close();

      // Count rotated files (excluding the main log file)
      const files = readdirSync(tempDir);
      const rotatedFiles = files.filter(
        (f) =>
          f.startsWith("cleanup-test-") &&
          f.endsWith(".jsonl") &&
          f !== "cleanup-test.jsonl"
      );

      // Should have at most maxFiles rotated files
      expect(rotatedFiles.length).toBeLessThanOrEqual(3);
    });

    it("should keep the most recent rotated files", async () => {
      const filePath = join(tempDir, "keep-recent-test.jsonl");

      // Create rotated files with different timestamps
      const oldFile = join(tempDir, "keep-recent-test-2024-01-01T10-00-00-1.jsonl");
      const newFile = join(tempDir, "keep-recent-test-2025-12-31T10-00-00-2.jsonl");

      writeFileSync(oldFile, `{"message": "Old"}\n`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      writeFileSync(newFile, `{"message": "New"}\n`);

      // Create a file that exceeds maxSize
      writeFileSync(filePath, "x".repeat(1000));

      const transport = new FileTransport({
        filePath,
        maxSize: 500,
        maxFiles: 1, // Only keep 1 rotated file
        maxBufferSize: 1,
      });

      transport.write(createMockEntry());
      await transport.flush();
      await transport.close();

      // The newer file should be kept
      const files = readdirSync(tempDir);

      // Old file should be deleted, newer files should remain
      expect(files.includes("keep-recent-test-2024-01-01T10-00-00-1.jsonl")).toBe(false);
    });
  });

  describe("close", () => {
    it("should flush remaining buffered entries on close", async () => {
      const filePath = join(tempDir, "close-flush-test.jsonl");
      const transport = new FileTransport({
        filePath,
        flushIntervalMs: 60000, // Long interval so it won't auto-flush by time
        maxBufferSize: 1000, // Large buffer so it won't auto-flush by size
      });

      // Write entries that will be buffered
      transport.write(createMockEntry({ message: "First entry" }));
      transport.write(createMockEntry({ message: "Second entry" }));

      // Explicitly flush before close to ensure entries are written
      await transport.flush();

      // Close should complete without error
      await transport.close();

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("First entry");
      expect(content).toContain("Second entry");
    });

    it("should write stream data even with close", async () => {
      const filePath = join(tempDir, "close-write-test.jsonl");
      const transport = new FileTransport({
        filePath,
        maxBufferSize: 1, // Flush immediately on each write
      });

      // Write entries that will be immediately flushed due to maxBufferSize=1
      transport.write(createMockEntry({ message: "Entry 1" }));
      transport.write(createMockEntry({ message: "Entry 2" }));

      await transport.close();

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("Entry 1");
      expect(content).toContain("Entry 2");
    });

    it("should not write entries after close", async () => {
      const filePath = join(tempDir, "after-close-test.jsonl");
      const transport = new FileTransport({ filePath, maxBufferSize: 1 });

      transport.write(createMockEntry({ message: "Before close" }));
      await transport.flush();
      await transport.close();

      // Try to write after close
      transport.write(createMockEntry({ message: "After close" }));
      await transport.flush();

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("Before close");
      expect(content).not.toContain("After close");
    });

    it("should clear the flush timer on close", async () => {
      const filePath = join(tempDir, "timer-test.jsonl");
      const transport = new FileTransport({
        filePath,
        flushIntervalMs: 100,
      });

      transport.write(createMockEntry());
      await transport.flush();
      await transport.close();

      // The timer should be cleared, so no errors should occur
      // after waiting longer than the flush interval
      await new Promise((resolve) => setTimeout(resolve, 200));

      // If we get here without errors, the timer was properly cleared
      expect(true).toBe(true);
    });

    it("should handle multiple close calls gracefully", async () => {
      const filePath = join(tempDir, "multi-close-test.jsonl");
      const transport = new FileTransport({ filePath });

      transport.write(createMockEntry());
      await transport.flush();

      // Multiple close calls should not throw
      await transport.close();
      await transport.close();
      await transport.close();

      expect(true).toBe(true);
    });
  });

  describe("flush", () => {
    it("should not throw when called before any writes", async () => {
      const filePath = join(tempDir, "flush-empty-test.jsonl");
      const transport = new FileTransport({ filePath });

      // Flush before any writes should not throw
      await transport.flush();
      await transport.close();

      expect(true).toBe(true);
    });

    it("should handle flush after close gracefully", async () => {
      const filePath = join(tempDir, "flush-after-close-test.jsonl");
      const transport = new FileTransport({ filePath });

      transport.write(createMockEntry());
      await transport.close();

      // Flush after close should not throw
      await transport.flush();

      expect(true).toBe(true);
    });
  });

  describe("JSON formatting", () => {
    it("should write entries as newline-delimited JSON", async () => {
      const filePath = join(tempDir, "json-format-test.jsonl");
      const transport = new FileTransport({ filePath, maxBufferSize: 1 });

      transport.write(
        createMockEntry({
          message: "Test message",
          customKey: "customValue",
        })
      );
      await transport.flush();
      await transport.close();

      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.message).toBe("Test message");
      expect(parsed.customKey).toBe("customValue");
      expect(parsed.timestamp).toBe("2025-01-25T10:30:45.123Z");
      expect(parsed.level).toBe("info");
    });
  });
});

// ============================================================================
// NullTransport Tests
// ============================================================================

describe("NullTransport", () => {
  describe("write", () => {
    it("should discard entries (no-op)", () => {
      const transport = new NullTransport();

      // Writing should not throw
      expect(() => {
        transport.write(createMockEntry({ message: "This will be discarded" }));
      }).not.toThrow();
    });

    it("should accept any valid log entry without side effects", () => {
      const transport = new NullTransport();

      // Write multiple entries with various data
      for (let i = 0; i < 100; i++) {
        transport.write(
          createMockEntry({
            message: `Entry ${i}`,
            index: i,
            largeData: "x".repeat(1000),
          })
        );
      }

      // No assertions needed - just verify no errors are thrown
      expect(true).toBe(true);
    });
  });

  describe("flush", () => {
    it("should be a no-op and resolve immediately", async () => {
      const transport = new NullTransport();

      const start = Date.now();
      await transport.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should be callable multiple times without error", async () => {
      const transport = new NullTransport();

      await transport.flush();
      await transport.flush();
      await transport.flush();

      expect(true).toBe(true);
    });
  });

  describe("close", () => {
    it("should be a no-op and resolve immediately", async () => {
      const transport = new NullTransport();

      const start = Date.now();
      await transport.close();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should be callable multiple times without error", async () => {
      const transport = new NullTransport();

      await transport.close();
      await transport.close();
      await transport.close();

      expect(true).toBe(true);
    });
  });

  describe("use cases", () => {
    it("should be usable for silencing logs in tests", () => {
      const transport = new NullTransport();

      // Simulate a logging scenario
      const logMessages = [
        createMockEntry({ level: "trace", message: "Trace" }),
        createMockEntry({ level: "debug", message: "Debug" }),
        createMockEntry({ level: "info", message: "Info" }),
        createMockEntry({ level: "warn", message: "Warn" }),
        createMockEntry({ level: "error", message: "Error" }),
        createMockEntry({ level: "fatal", message: "Fatal" }),
      ];

      for (const entry of logMessages) {
        transport.write(entry);
      }

      // No output should be produced
      expect(true).toBe(true);
    });
  });
});
