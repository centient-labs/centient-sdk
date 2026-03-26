/**
 * Tests for Testing Utilities
 *
 * Comprehensive tests for CaptureTransport, createTestLogger, and createSilentLogger
 *
 * @module tests/testing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CaptureTransport,
  createTestLogger,
  createSilentLogger,
} from "../src/testing.js";
import type { LogEntry } from "../src/types.js";

// ============================================================================
// CaptureTransport Tests
// ============================================================================

describe("CaptureTransport", () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport();
  });

  afterEach(() => {
    transport.clear();
  });

  // --------------------------------------------------------------------------
  // write method
  // --------------------------------------------------------------------------

  describe("write", () => {
    it("should capture a single log entry", () => {
      const entry: LogEntry = {
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Test message",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      transport.write(entry);

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it("should capture multiple log entries in order", () => {
      const entry1: LogEntry = {
        timestamp: "2025-01-25T10:30:45.000Z",
        level: "info",
        component: "test",
        message: "First",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      const entry2: LogEntry = {
        timestamp: "2025-01-25T10:30:46.000Z",
        level: "warn",
        component: "test",
        message: "Second",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      transport.write(entry1);
      transport.write(entry2);

      const entries = transport.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("First");
      expect(entries[1].message).toBe("Second");
    });

    it("should store raw JSON output", () => {
      const entry: LogEntry = {
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "JSON test",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      transport.write(entry);

      const output = transport.getOutput();
      expect(output).toHaveLength(1);
      expect(() => JSON.parse(output[0])).not.toThrow();
      expect(JSON.parse(output[0]).message).toBe("JSON test");
    });
  });

  // --------------------------------------------------------------------------
  // flush and close methods
  // --------------------------------------------------------------------------

  describe("flush", () => {
    it("should resolve immediately (no-op)", async () => {
      const start = Date.now();
      await transport.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should be callable multiple times without error", async () => {
      await transport.flush();
      await transport.flush();
      await transport.flush();

      expect(true).toBe(true);
    });
  });

  describe("close", () => {
    it("should resolve immediately (no-op)", async () => {
      const start = Date.now();
      await transport.close();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should be callable multiple times without error", async () => {
      await transport.close();
      await transport.close();
      await transport.close();

      expect(true).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // getEntries method
  // --------------------------------------------------------------------------

  describe("getEntries", () => {
    it("should return empty array when no entries captured", () => {
      const entries = transport.getEntries();
      expect(entries).toEqual([]);
    });

    it("should return a copy of entries (not the original array)", () => {
      const entry: LogEntry = {
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Test",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      transport.write(entry);

      const entries1 = transport.getEntries();
      const entries2 = transport.getEntries();

      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);

      // Modifying the returned array should not affect internal state
      entries1.push(entry);
      expect(transport.getEntries()).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // getOutput method
  // --------------------------------------------------------------------------

  describe("getOutput", () => {
    it("should return empty array when no entries captured", () => {
      const output = transport.getOutput();
      expect(output).toEqual([]);
    });

    it("should return a copy of output (not the original array)", () => {
      const entry: LogEntry = {
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Test",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      };

      transport.write(entry);

      const output1 = transport.getOutput();
      const output2 = transport.getOutput();

      expect(output1).not.toBe(output2);
      expect(output1).toEqual(output2);

      // Modifying the returned array should not affect internal state
      output1.push("extra");
      expect(transport.getOutput()).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // getEntriesByLevel method
  // --------------------------------------------------------------------------

  describe("getEntriesByLevel", () => {
    beforeEach(() => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
      for (const level of levels) {
        transport.write({
          timestamp: "2025-01-25T10:30:45.123Z",
          level,
          component: "test",
          message: `${level} message`,
          service: "test-service",
          version: "1.0.0",
          pid: 12345,
          hostname: "test-host",
        });
      }
    });

    it("should filter entries by trace level", () => {
      const entries = transport.getEntriesByLevel("trace");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("trace message");
    });

    it("should filter entries by debug level", () => {
      const entries = transport.getEntriesByLevel("debug");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("debug message");
    });

    it("should filter entries by info level", () => {
      const entries = transport.getEntriesByLevel("info");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("info message");
    });

    it("should filter entries by warn level", () => {
      const entries = transport.getEntriesByLevel("warn");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("warn message");
    });

    it("should filter entries by error level", () => {
      const entries = transport.getEntriesByLevel("error");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("error message");
    });

    it("should filter entries by fatal level", () => {
      const entries = transport.getEntriesByLevel("fatal");
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("fatal message");
    });

    it("should return empty array for non-existent level", () => {
      const entries = transport.getEntriesByLevel("nonexistent");
      expect(entries).toEqual([]);
    });

    it("should return multiple entries of the same level", () => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "second info message",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });

      const entries = transport.getEntriesByLevel("info");
      expect(entries).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getEntriesByComponent method
  // --------------------------------------------------------------------------

  describe("getEntriesByComponent", () => {
    beforeEach(() => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "auth",
        message: "Auth message",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "database",
        message: "Database message",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "warn",
        component: "auth",
        message: "Auth warning",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });
    });

    it("should filter entries by component", () => {
      const entries = transport.getEntriesByComponent("auth");
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("Auth message");
      expect(entries[1].message).toBe("Auth warning");
    });

    it("should return empty array for non-existent component", () => {
      const entries = transport.getEntriesByComponent("nonexistent");
      expect(entries).toEqual([]);
    });

    it("should be case-sensitive", () => {
      const entries = transport.getEntriesByComponent("Auth");
      expect(entries).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // hasMessage method
  // --------------------------------------------------------------------------

  describe("hasMessage", () => {
    beforeEach(() => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Hello world",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "error",
        component: "test",
        message: "Operation failed",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });
    });

    it("should return true for exact message match", () => {
      expect(transport.hasMessage("Hello world")).toBe(true);
    });

    it("should return true for partial message match", () => {
      expect(transport.hasMessage("Hello")).toBe(true);
      expect(transport.hasMessage("world")).toBe(true);
    });

    it("should return false for non-matching message", () => {
      expect(transport.hasMessage("Goodbye")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(transport.hasMessage("hello")).toBe(false);
      expect(transport.hasMessage("Hello")).toBe(true);
    });

    it("should return false when no entries exist", () => {
      transport.clear();
      expect(transport.hasMessage("anything")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // clear method
  // --------------------------------------------------------------------------

  describe("clear", () => {
    it("should clear all captured entries", () => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Test",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });

      expect(transport.getEntries()).toHaveLength(1);

      transport.clear();

      expect(transport.getEntries()).toHaveLength(0);
    });

    it("should clear all raw output", () => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Test",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });

      expect(transport.getOutput()).toHaveLength(1);

      transport.clear();

      expect(transport.getOutput()).toHaveLength(0);
    });

    it("should be callable on empty transport without error", () => {
      expect(() => transport.clear()).not.toThrow();
    });

    it("should allow new entries after clear", () => {
      transport.write({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "test",
        message: "Before clear",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });

      transport.clear();

      transport.write({
        timestamp: "2025-01-25T10:30:46.123Z",
        level: "warn",
        component: "test",
        message: "After clear",
        service: "test-service",
        version: "1.0.0",
        pid: 12345,
        hostname: "test-host",
      });

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("After clear");
    });
  });
});

// ============================================================================
// createTestLogger Tests
// ============================================================================

describe("createTestLogger", () => {
  describe("default creation", () => {
    it("should create a test logger with default component", () => {
      const { logger, getEntries } = createTestLogger();

      logger.info("Test message");

      const entries = getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].component).toBe("test");
    });

    it("should return a TestLoggerResult with all required properties", () => {
      const result = createTestLogger();

      expect(result).toHaveProperty("logger");
      expect(result).toHaveProperty("transport");
      expect(result).toHaveProperty("getOutput");
      expect(result).toHaveProperty("getEntries");
      expect(result).toHaveProperty("clear");
    });

    it("should use test-service as the default service name", () => {
      const { logger, getEntries } = createTestLogger();

      logger.info("Test message");

      const entries = getEntries();
      expect(entries[0].service).toBe("test-service");
    });

    it("should use 0.0.0-test as the default version", () => {
      const { logger, getEntries } = createTestLogger();

      logger.info("Test message");

      const entries = getEntries();
      expect(entries[0].version).toBe("0.0.0-test");
    });
  });

  describe("custom component", () => {
    it("should create a logger with the specified component", () => {
      const { logger, getEntries } = createTestLogger("my-component");

      logger.info("Test message");

      const entries = getEntries();
      expect(entries[0].component).toBe("my-component");
    });
  });

  describe("custom context", () => {
    it("should include custom context in log entries", () => {
      const { logger, getEntries } = createTestLogger("test", {
        requestId: "req-123",
        userId: "user-456",
      });

      logger.info("Test message");

      const entries = getEntries();
      expect(entries[0].requestId).toBe("req-123");
      expect(entries[0].userId).toBe("user-456");
    });

    it("should preserve component in context", () => {
      const { logger, getEntries } = createTestLogger("auth", {
        sessionId: "sess-789",
      });

      logger.info("Test message");

      const entries = getEntries();
      expect(entries[0].component).toBe("auth");
      expect(entries[0].sessionId).toBe("sess-789");
    });
  });

  describe("log level capture", () => {
    it("should capture trace level logs (default level is trace)", () => {
      const { logger, getEntries } = createTestLogger();

      logger.trace("Trace message");

      const entries = getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("trace");
    });

    it("should capture all log levels", () => {
      const { logger, getEntries } = createTestLogger();

      logger.trace("Trace");
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");
      logger.error("Error");
      logger.fatal("Fatal");

      const entries = getEntries();
      expect(entries).toHaveLength(6);
      expect(entries.map((e) => e.level)).toEqual([
        "trace",
        "debug",
        "info",
        "warn",
        "error",
        "fatal",
      ]);
    });
  });

  describe("getOutput helper", () => {
    it("should return raw JSON output", () => {
      const { logger, getOutput } = createTestLogger();

      logger.info("Test message");

      const output = getOutput();
      expect(output).toHaveLength(1);
      expect(() => JSON.parse(output[0])).not.toThrow();
    });
  });

  describe("getEntries helper", () => {
    it("should return all captured entries", () => {
      const { logger, getEntries } = createTestLogger();

      logger.info("First");
      logger.warn("Second");

      const entries = getEntries();
      expect(entries).toHaveLength(2);
    });
  });

  describe("clear helper", () => {
    it("should clear all captured entries", () => {
      const { logger, getEntries, clear } = createTestLogger();

      logger.info("First");
      logger.info("Second");

      expect(getEntries()).toHaveLength(2);

      clear();

      expect(getEntries()).toHaveLength(0);
    });
  });

  describe("transport access", () => {
    it("should provide direct access to the transport", () => {
      const { logger, transport } = createTestLogger();

      logger.info("Test message");
      logger.warn({ userId: "123" }, "Warning");

      // Use transport methods directly
      expect(transport.getEntriesByLevel("warn")).toHaveLength(1);
      expect(transport.hasMessage("Warning")).toBe(true);
    });
  });

  describe("logging with context", () => {
    it("should capture context passed to log methods", () => {
      const { logger, getEntries } = createTestLogger();

      logger.info({ operation: "create", duration: 150 }, "Operation complete");

      const entries = getEntries();
      expect(entries[0].operation).toBe("create");
      expect(entries[0].duration).toBe(150);
    });
  });

  describe("child loggers", () => {
    it("should capture logs from child loggers", () => {
      const { logger, getEntries } = createTestLogger("parent");

      const child = logger.child({ childContext: "value" });
      child.info("Child message");

      const entries = getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].childContext).toBe("value");
    });
  });
});

// ============================================================================
// createSilentLogger Tests
// ============================================================================

describe("createSilentLogger", () => {
  describe("default creation", () => {
    it("should create a logger with default service name", () => {
      const logger = createSilentLogger();

      // The logger should work without errors
      expect(() => {
        logger.info("This should be silent");
      }).not.toThrow();
    });
  });

  describe("custom service name", () => {
    it("should create a logger with the specified service name", () => {
      const logger = createSilentLogger("my-service");

      // The logger should work without errors
      expect(() => {
        logger.info("This should be silent");
      }).not.toThrow();
    });
  });

  describe("silent operation", () => {
    it("should not produce any output", () => {
      const logger = createSilentLogger();

      // Log at all levels - none should throw
      expect(() => {
        logger.trace("Trace");
        logger.debug("Debug");
        logger.info("Info");
        logger.warn("Warn");
        logger.error("Error");
        logger.fatal("Fatal");
      }).not.toThrow();
    });

    it("should accept context without error", () => {
      const logger = createSilentLogger();

      expect(() => {
        logger.info({ userId: "123", action: "test" }, "Context message");
      }).not.toThrow();
    });
  });

  describe("child loggers", () => {
    it("should support creating child loggers", () => {
      const logger = createSilentLogger();

      expect(() => {
        const child = logger.child({ requestId: "req-123" });
        child.info("Child message");
      }).not.toThrow();
    });
  });

  describe("use cases", () => {
    it("should be usable as a dependency injection for code that requires a logger", () => {
      // Simulating a function that requires a logger
      function processData(
        data: string,
        log: ReturnType<typeof createSilentLogger>
      ): string {
        log.debug({ data }, "Processing data");
        const result = data.toUpperCase();
        log.info({ result }, "Processing complete");
        return result;
      }

      const logger = createSilentLogger();
      const result = processData("test", logger);

      expect(result).toBe("TEST");
    });

    it("should be usable in tests where log output is not needed", () => {
      const logger = createSilentLogger("unit-tests");

      // Perform operations that normally log
      for (let i = 0; i < 100; i++) {
        logger.info({ iteration: i }, "Processing iteration");
      }

      // No output verification needed - just ensure no errors
      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  describe("CaptureTransport with Logger", () => {
    it("should work correctly as a transport for the Logger class", () => {
      const { logger, transport, getEntries, getOutput, clear } =
        createTestLogger("integration");

      // Log some messages
      logger.info("First message");
      logger.warn({ code: "W001" }, "Warning message");
      logger.error({ error: new Error("Test error") }, "Error occurred");

      // Verify entries
      const entries = getEntries();
      expect(entries).toHaveLength(3);

      // Verify output
      const output = getOutput();
      expect(output).toHaveLength(3);

      // Verify transport methods
      expect(transport.getEntriesByLevel("warn")).toHaveLength(1);
      expect(transport.hasMessage("Warning")).toBe(true);

      // Verify clear
      clear();
      expect(getEntries()).toHaveLength(0);
      expect(getOutput()).toHaveLength(0);
    });
  });

  describe("multiple test loggers", () => {
    it("should maintain separate state for different test loggers", () => {
      const logger1Result = createTestLogger("logger1");
      const logger2Result = createTestLogger("logger2");

      logger1Result.logger.info("Logger 1 message");
      logger2Result.logger.info("Logger 2 message");

      expect(logger1Result.getEntries()).toHaveLength(1);
      expect(logger1Result.getEntries()[0].component).toBe("logger1");

      expect(logger2Result.getEntries()).toHaveLength(1);
      expect(logger2Result.getEntries()[0].component).toBe("logger2");

      // Clearing one should not affect the other
      logger1Result.clear();
      expect(logger1Result.getEntries()).toHaveLength(0);
      expect(logger2Result.getEntries()).toHaveLength(1);
    });
  });
});
