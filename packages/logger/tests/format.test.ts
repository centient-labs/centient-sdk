/**
 * Tests for Log Formatting Utilities
 *
 * Tests formatPretty(), formatJson(), isPrettyEnabled(), and getConfiguredLevel()
 *
 * @module format.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  formatPretty,
  formatJson,
  isPrettyEnabled,
  getConfiguredLevel,
} from "../src/format.js";
import type { LogEntry, LogLevel } from "../src/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test LogEntry with sensible defaults
 */
function createTestEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: "2025-01-25T10:30:45.123Z",
    level: "info",
    component: "test-component",
    message: "Test message",
    service: "test-service",
    pid: 12345,
    hostname: "test-host",
    ...overrides,
  };
}

// ============================================================================
// formatPretty Tests
// ============================================================================

describe("formatPretty", () => {
  describe("time extraction", () => {
    it("should extract time from ISO timestamp as HH:mm:ss.SSS", () => {
      const entry = createTestEntry({
        timestamp: "2025-01-25T14:35:22.456Z",
      });

      const result = formatPretty(entry);

      expect(result).toContain("14:35:22.456");
    });

    it("should handle midnight timestamp", () => {
      const entry = createTestEntry({
        timestamp: "2025-01-25T00:00:00.000Z",
      });

      const result = formatPretty(entry);

      expect(result).toContain("00:00:00.000");
    });

    it("should handle end of day timestamp", () => {
      const entry = createTestEntry({
        timestamp: "2025-01-25T23:59:59.999Z",
      });

      const result = formatPretty(entry);

      expect(result).toContain("23:59:59.999");
    });
  });

  describe("log levels", () => {
    const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

    levels.forEach((level) => {
      it(`should format ${level} level with correct uppercase label`, () => {
        const entry = createTestEntry({ level });

        const result = formatPretty(entry);

        expect(result).toContain(level.toUpperCase());
      });
    });

    it("should include ANSI color codes for trace (gray)", () => {
      const entry = createTestEntry({ level: "trace" });

      const result = formatPretty(entry);

      // Gray color code
      expect(result).toContain("\x1b[90m");
      expect(result).toContain("\x1b[0m"); // Reset
    });

    it("should include ANSI color codes for debug (cyan)", () => {
      const entry = createTestEntry({ level: "debug" });

      const result = formatPretty(entry);

      expect(result).toContain("\x1b[36m");
      expect(result).toContain("\x1b[0m");
    });

    it("should include ANSI color codes for info (green)", () => {
      const entry = createTestEntry({ level: "info" });

      const result = formatPretty(entry);

      expect(result).toContain("\x1b[32m");
      expect(result).toContain("\x1b[0m");
    });

    it("should include ANSI color codes for warn (yellow)", () => {
      const entry = createTestEntry({ level: "warn" });

      const result = formatPretty(entry);

      expect(result).toContain("\x1b[33m");
      expect(result).toContain("\x1b[0m");
    });

    it("should include ANSI color codes for error (red)", () => {
      const entry = createTestEntry({ level: "error" });

      const result = formatPretty(entry);

      expect(result).toContain("\x1b[31m");
      expect(result).toContain("\x1b[0m");
    });

    it("should include ANSI color codes for fatal (magenta)", () => {
      const entry = createTestEntry({ level: "fatal" });

      const result = formatPretty(entry);

      expect(result).toContain("\x1b[35m");
      expect(result).toContain("\x1b[0m");
    });

    it("should pad level to 5 characters", () => {
      const infoEntry = createTestEntry({ level: "info" });
      const warnEntry = createTestEntry({ level: "warn" });

      const infoResult = formatPretty(infoEntry);
      const warnResult = formatPretty(warnEntry);

      // INFO and WARN should both be padded to 5 chars
      expect(infoResult).toContain("INFO ");
      expect(warnResult).toContain("WARN ");
    });
  });

  describe("component formatting", () => {
    it("should display component in brackets when not 'main'", () => {
      const entry = createTestEntry({ component: "auth-module" });

      const result = formatPretty(entry);

      expect(result).toContain("[auth-module]");
    });

    it("should not display brackets when component is 'main'", () => {
      const entry = createTestEntry({ component: "main" });

      const result = formatPretty(entry);

      expect(result).not.toContain("[main]");
      expect(result).not.toContain("[]");
    });

    it("should display message after component", () => {
      const entry = createTestEntry({
        component: "database",
        message: "Connection established",
      });

      const result = formatPretty(entry);

      expect(result).toContain("[database] Connection established");
    });
  });

  describe("message formatting", () => {
    it("should include the message in output", () => {
      const entry = createTestEntry({ message: "User logged in successfully" });

      const result = formatPretty(entry);

      expect(result).toContain("User logged in successfully");
    });

    it("should handle empty message", () => {
      const entry = createTestEntry({ message: "" });

      const result = formatPretty(entry);

      // Should not throw, should still produce valid output
      expect(typeof result).toBe("string");
    });

    it("should handle message with special characters", () => {
      const entry = createTestEntry({
        message: "Error: File 'test.ts' not found (code: 404)",
      });

      const result = formatPretty(entry);

      expect(result).toContain("Error: File 'test.ts' not found (code: 404)");
    });
  });

  describe("context serialization", () => {
    it("should format simple context values as key=value pairs", () => {
      const entry = createTestEntry({
        userId: "user123",
        action: "login",
      });

      const result = formatPretty(entry);

      expect(result).toContain("userId=user123");
      expect(result).toContain("action=login");
    });

    it("should format object context values as JSON", () => {
      const entry = createTestEntry({
        config: { timeout: 5000, retries: 3 },
      });

      const result = formatPretty(entry);

      expect(result).toContain('config={"timeout":5000,"retries":3}');
    });

    it("should format array context values as JSON", () => {
      const entry = createTestEntry({
        items: [1, 2, 3],
      });

      const result = formatPretty(entry);

      expect(result).toContain("items=[1,2,3]");
    });

    it("should handle numeric context values", () => {
      const entry = createTestEntry({
        count: 42,
        duration: 123.45,
      });

      const result = formatPretty(entry);

      expect(result).toContain("count=42");
      expect(result).toContain("duration=123.45");
    });

    it("should handle boolean context values", () => {
      const entry = createTestEntry({
        success: true,
        cached: false,
      });

      const result = formatPretty(entry);

      expect(result).toContain("success=true");
      expect(result).toContain("cached=false");
    });

    it("should not duplicate standard fields in context display", () => {
      const entry = createTestEntry();

      const result = formatPretty(entry);

      // Standard fields should be excluded from key=value pairs
      expect(result).not.toContain("level=info");
      expect(result).not.toContain("timestamp=");
      expect(result).not.toContain("service=test-service");
      expect(result).not.toContain("pid=12345");
      expect(result).not.toContain("hostname=test-host");
      expect(result).not.toContain("component=test-component");
    });

    it("should render user-supplied `version` in the tail (unreserved in v1.0.0)", () => {
      // `version` is a user context field now, not a stripped top-level.
      const entry = createTestEntry({ version: "2.3.4" });
      const result = formatPretty(entry);
      expect(result).toContain("version=2.3.4");
    });

    it("should handle empty context (no extra fields)", () => {
      const entry = createTestEntry();

      const result = formatPretty(entry);

      // Should not have trailing space or undefined values
      expect(result).not.toContain("undefined");
      expect(result).not.toContain("null");
    });

    it("should separate context values with spaces", () => {
      const entry = createTestEntry({
        a: 1,
        b: 2,
        c: 3,
      });

      const result = formatPretty(entry);

      expect(result).toContain("a=1 b=2 c=3");
    });

    it("should handle null context value", () => {
      const entry = createTestEntry({
        nullValue: null,
      });

      const result = formatPretty(entry);

      expect(result).toContain("nullValue=null");
    });

    it("should handle nested objects", () => {
      const entry = createTestEntry({
        nested: { deep: { value: "test" } },
      });

      const result = formatPretty(entry);

      expect(result).toContain('nested={"deep":{"value":"test"}}');
    });
  });

  describe("complete output format", () => {
    it("should produce correctly ordered output", () => {
      const entry = createTestEntry({
        timestamp: "2025-01-25T10:30:45.123Z",
        level: "info",
        component: "auth",
        message: "Login successful",
        userId: "user123",
      });

      const result = formatPretty(entry);

      // Format: HH:mm:ss.SSS LEVEL [component] message key=value
      // Check the parts are in order
      const timeIndex = result.indexOf("10:30:45.123");
      const levelIndex = result.indexOf("INFO");
      const componentIndex = result.indexOf("[auth]");
      const messageIndex = result.indexOf("Login successful");
      const contextIndex = result.indexOf("userId=user123");

      expect(timeIndex).toBeLessThan(levelIndex);
      expect(levelIndex).toBeLessThan(componentIndex);
      expect(componentIndex).toBeLessThan(messageIndex);
      expect(messageIndex).toBeLessThan(contextIndex);
    });
  });
});

// ============================================================================
// formatJson Tests
// ============================================================================

describe("formatJson", () => {
  it("should return valid JSON", () => {
    const entry = createTestEntry();

    const result = formatJson(entry);

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("should include all entry fields", () => {
    const entry = createTestEntry({
      userId: "user123",
      action: "login",
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.timestamp).toBe("2025-01-25T10:30:45.123Z");
    expect(parsed.level).toBe("info");
    expect(parsed.component).toBe("test-component");
    expect(parsed.message).toBe("Test message");
    expect(parsed.service).toBe("test-service");
    expect(parsed.version).toBeUndefined();
    expect(parsed.pid).toBe(12345);
    expect(parsed.hostname).toBe("test-host");
    expect(parsed.userId).toBe("user123");
    expect(parsed.action).toBe("login");
  });

  it("should preserve nested objects", () => {
    const entry = createTestEntry({
      config: { timeout: 5000, nested: { value: "test" } },
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.config).toEqual({ timeout: 5000, nested: { value: "test" } });
  });

  it("should preserve arrays", () => {
    const entry = createTestEntry({
      items: [1, 2, 3],
      tags: ["a", "b", "c"],
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.items).toEqual([1, 2, 3]);
    expect(parsed.tags).toEqual(["a", "b", "c"]);
  });

  it("should handle null values", () => {
    const entry = createTestEntry({
      nullField: null,
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.nullField).toBeNull();
  });

  it("should handle all log levels", () => {
    const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

    levels.forEach((level) => {
      const entry = createTestEntry({ level });
      const result = formatJson(entry);
      const parsed = JSON.parse(result);

      expect(parsed.level).toBe(level);
    });
  });

  it("should handle special characters in message", () => {
    const entry = createTestEntry({
      message: 'Error: "File" not found\nNew line\ttab',
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.message).toBe('Error: "File" not found\nNew line\ttab');
  });

  it("should handle unicode characters", () => {
    const entry = createTestEntry({
      message: "Hello, world! 42",
      emoji: "rocket",
    });

    const result = formatJson(entry);
    const parsed = JSON.parse(result);

    expect(parsed.message).toBe("Hello, world! 42");
    expect(parsed.emoji).toBe("rocket");
  });
});

// ============================================================================
// isPrettyEnabled Tests
// ============================================================================

describe("isPrettyEnabled", () => {
  let originalLogPretty: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalLogPretty = process.env.LOG_PRETTY;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalLogPretty !== undefined) {
      process.env.LOG_PRETTY = originalLogPretty;
    } else {
      delete process.env.LOG_PRETTY;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe("LOG_PRETTY environment variable", () => {
    it('should return true when LOG_PRETTY is "true"', () => {
      process.env.LOG_PRETTY = "true";

      expect(isPrettyEnabled()).toBe(true);
    });

    it('should return false when LOG_PRETTY is "false"', () => {
      process.env.LOG_PRETTY = "false";

      expect(isPrettyEnabled()).toBe(false);
    });

    it('should override NODE_ENV when LOG_PRETTY is "true"', () => {
      process.env.LOG_PRETTY = "true";
      process.env.NODE_ENV = "production";

      expect(isPrettyEnabled()).toBe(true);
    });

    it('should override NODE_ENV when LOG_PRETTY is "false"', () => {
      process.env.LOG_PRETTY = "false";
      process.env.NODE_ENV = "development";

      expect(isPrettyEnabled()).toBe(false);
    });
  });

  describe("NODE_ENV fallback", () => {
    it('should return false when NODE_ENV is "production" and LOG_PRETTY not set', () => {
      delete process.env.LOG_PRETTY;
      process.env.NODE_ENV = "production";

      expect(isPrettyEnabled()).toBe(false);
    });

    it('should return true when NODE_ENV is "development" and LOG_PRETTY not set', () => {
      delete process.env.LOG_PRETTY;
      process.env.NODE_ENV = "development";

      expect(isPrettyEnabled()).toBe(true);
    });

    it('should return true when NODE_ENV is "test" and LOG_PRETTY not set', () => {
      delete process.env.LOG_PRETTY;
      process.env.NODE_ENV = "test";

      expect(isPrettyEnabled()).toBe(true);
    });

    it("should return true when NODE_ENV is not set and LOG_PRETTY not set", () => {
      delete process.env.LOG_PRETTY;
      delete process.env.NODE_ENV;

      expect(isPrettyEnabled()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it('should not enable pretty for LOG_PRETTY="TRUE" (case sensitive)', () => {
      process.env.LOG_PRETTY = "TRUE";
      delete process.env.NODE_ENV;

      // "TRUE" !== "true", so falls through to NODE_ENV check
      expect(isPrettyEnabled()).toBe(true);
    });

    it('should not disable pretty for LOG_PRETTY="FALSE" (case sensitive)', () => {
      process.env.LOG_PRETTY = "FALSE";
      delete process.env.NODE_ENV;

      // "FALSE" !== "false", so falls through to NODE_ENV check
      expect(isPrettyEnabled()).toBe(true);
    });

    it("should handle empty LOG_PRETTY string", () => {
      process.env.LOG_PRETTY = "";
      delete process.env.NODE_ENV;

      // Empty string is falsy, falls through to NODE_ENV check
      expect(isPrettyEnabled()).toBe(true);
    });

    it("should handle LOG_PRETTY with other values", () => {
      process.env.LOG_PRETTY = "yes";
      delete process.env.NODE_ENV;

      // "yes" is not "true" or "false", falls through to NODE_ENV check
      expect(isPrettyEnabled()).toBe(true);
    });
  });
});

// ============================================================================
// getConfiguredLevel Tests
// ============================================================================

describe("getConfiguredLevel", () => {
  let originalLogLevel: string | undefined;

  beforeEach(() => {
    originalLogLevel = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  describe("valid log levels", () => {
    const validLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

    validLevels.forEach((level) => {
      it(`should return "${level}" when LOG_LEVEL is "${level}"`, () => {
        process.env.LOG_LEVEL = level;

        expect(getConfiguredLevel()).toBe(level);
      });

      it(`should handle uppercase "${level.toUpperCase()}"`, () => {
        process.env.LOG_LEVEL = level.toUpperCase();

        expect(getConfiguredLevel()).toBe(level);
      });

      it(`should handle mixed case for "${level}"`, () => {
        // Create mixed case: "TrAcE", "DeBuG", etc.
        const mixedCase = level
          .split("")
          .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
          .join("");
        process.env.LOG_LEVEL = mixedCase;

        expect(getConfiguredLevel()).toBe(level);
      });
    });
  });

  describe("invalid log levels", () => {
    it('should return "info" for invalid level "verbose"', () => {
      process.env.LOG_LEVEL = "verbose";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for invalid level "warning"', () => {
      process.env.LOG_LEVEL = "warning";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for invalid level "critical"', () => {
      process.env.LOG_LEVEL = "critical";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for numeric level', () => {
      process.env.LOG_LEVEL = "30";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for empty string', () => {
      process.env.LOG_LEVEL = "";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for whitespace-only string', () => {
      process.env.LOG_LEVEL = "   ";

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" for level with extra whitespace', () => {
      process.env.LOG_LEVEL = " debug ";

      // " debug " (with spaces) won't match "debug"
      expect(getConfiguredLevel()).toBe("info");
    });
  });

  describe("default fallback", () => {
    it('should return "info" when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;

      expect(getConfiguredLevel()).toBe("info");
    });

    it('should return "info" when LOG_LEVEL is undefined', () => {
      process.env.LOG_LEVEL = undefined as unknown as string;

      expect(getConfiguredLevel()).toBe("info");
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in LOG_LEVEL", () => {
      process.env.LOG_LEVEL = "info!";

      expect(getConfiguredLevel()).toBe("info");
    });

    it("should handle LOG_LEVEL with newlines", () => {
      process.env.LOG_LEVEL = "debug\n";

      expect(getConfiguredLevel()).toBe("info");
    });
  });
});
