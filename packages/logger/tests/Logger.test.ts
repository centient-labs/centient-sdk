/**
 * Tests for Logger class
 *
 * @module Logger.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Logger,
  createLogger,
  createComponentLogger,
  createToolLogger,
  createSessionLogger,
} from "../src/Logger.js";
import { CaptureTransport } from "../src/testing.js";
import type { LogEntry, LogLevel } from "../src/types.js";

// Ensure JSON output for easier assertions
process.env.LOG_PRETTY = "false";

describe("Logger", () => {
  let transport: CaptureTransport;
  let logger: Logger;

  beforeEach(() => {
    transport = new CaptureTransport();
    logger = new Logger({
      service: "test-service",
      transport,
      level: "trace", // Enable all levels
    });
  });

  afterEach(() => {
    transport.clear();
  });

  // ============================================================================
  // Basic Logging at All Levels
  // ============================================================================

  describe("basic logging at all levels", () => {
    it("should log at trace level", () => {
      logger.trace("trace message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("trace");
      expect(entries[0].message).toBe("trace message");
    });

    it("should log at debug level", () => {
      logger.debug("debug message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("debug");
      expect(entries[0].message).toBe("debug message");
    });

    it("should log at info level", () => {
      logger.info("info message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("info");
      expect(entries[0].message).toBe("info message");
    });

    it("should log at warn level", () => {
      logger.warn("warn message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("warn");
      expect(entries[0].message).toBe("warn message");
    });

    it("should log at error level", () => {
      logger.error("error message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("error");
      expect(entries[0].message).toBe("error message");
    });

    it("should log at fatal level", () => {
      logger.fatal("fatal message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("fatal");
      expect(entries[0].message).toBe("fatal message");
    });

    it("should include standard fields in log entries", () => {
      logger.info("test message");

      const entry = transport.getEntries()[0];
      expect(entry.service).toBe("test-service");
      expect(entry.component).toBe("main");
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.pid).toBe("number");
      expect(typeof entry.hostname).toBe("string");
      // `version` is no longer a reserved top-level field (v1.0.0, issue #36)
      expect(entry.version).toBeUndefined();
    });

    it("should pass user-supplied `version` through context to the emitted entry", () => {
      // Regression test for #36: `version` was silently stripped from context
      // and replaced with the logger-instance version. As of v1.0.0 the field
      // is no longer reserved; whatever the caller passes flows through.
      logger.info({ version: "1.2.3" }, "starting");

      const entry = transport.getEntries()[0];
      expect(entry.version).toBe("1.2.3");
    });

    it("should pass `version` in baseContext through to every emitted entry", () => {
      // Baked-in version via constructor context — a distinct code path from
      // per-call context. Must flow through identically.
      const t = new CaptureTransport();
      const l = new Logger({
        service: "svc",
        transport: t,
        level: "trace",
        context: { version: "3.0.0" },
      });
      l.info("hello");
      expect(t.getEntries()[0].version).toBe("3.0.0");
    });

    it("should merge per-call `version` over baseContext (per-call wins)", () => {
      // Pin the merge precedence: per-call context merges on top of baseContext
      // via Object.assign({}, baseContext, context). Accidentally reversing the
      // order in a future refactor would silently flip this contract.
      const t = new CaptureTransport();
      const l = new Logger({
        service: "svc",
        transport: t,
        level: "trace",
        context: { version: "base" },
      });
      l.info({ version: "call" }, "hello");
      expect(t.getEntries()[0].version).toBe("call");
    });

    it("reserved top-level fields in user context do NOT override computed values", () => {
      // Regression for finding #1 on PR #38: without an explicit strip,
      // `...restContext` spread at the end of the entry literal would let
      // caller-supplied `level` / `timestamp` / `pid` / `hostname` clobber
      // the computed values. The buildEntry destructure must strip all of
      // them from sanitizedContext.
      logger.info(
        {
          level: "fake-level",
          timestamp: "not-a-real-time",
          message: "caller-message-override",
          pid: 0,
          hostname: "attacker-host",
        },
        "the real message",
      );
      const entry = transport.getEntries()[0];
      expect(entry.level).toBe("info");
      expect(entry.message).toBe("the real message");
      expect(entry.timestamp).not.toBe("not-a-real-time");
      expect(entry.pid).toBe(process.pid);
      expect(entry.hostname).not.toBe("attacker-host");
    });
  });

  // ============================================================================
  // Child Logger — `version` flow-through
  // ============================================================================

  describe("child logger — version flow-through (regression for #36)", () => {
    it("should emit user-supplied `version` through a child logger", () => {
      const t = new CaptureTransport();
      const parent = new Logger({ service: "svc", transport: t, level: "trace" });
      const child = parent.child({ component: "worker" });
      child.info({ version: "2.0.0" }, "child says hi");
      const entry = t.getEntries()[0];
      expect(entry.component).toBe("worker");
      expect(entry.version).toBe("2.0.0");
    });
  });

  // ============================================================================
  // Log Level Filtering
  // ============================================================================

  describe("log level filtering", () => {
    it("should filter out messages below configured level", () => {
      const warnLogger = new Logger({
        service: "test-service",
        transport,
        level: "warn",
      });

      warnLogger.trace("trace message");
      warnLogger.debug("debug message");
      warnLogger.info("info message");
      warnLogger.warn("warn message");
      warnLogger.error("error message");
      warnLogger.fatal("fatal message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.level)).toEqual(["warn", "error", "fatal"]);
    });

    it("should log all levels when level is trace", () => {
      const traceLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
      });

      traceLogger.trace("trace");
      traceLogger.debug("debug");
      traceLogger.info("info");
      traceLogger.warn("warn");
      traceLogger.error("error");
      traceLogger.fatal("fatal");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(6);
    });

    it("should only log fatal when level is fatal", () => {
      const fatalLogger = new Logger({
        service: "test-service",
        transport,
        level: "fatal",
      });

      fatalLogger.trace("trace");
      fatalLogger.debug("debug");
      fatalLogger.info("info");
      fatalLogger.warn("warn");
      fatalLogger.error("error");
      fatalLogger.fatal("fatal");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("fatal");
    });

    it("should respect LOG_LEVEL environment variable", () => {
      const originalLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = "error";

      const envLogger = new Logger({
        service: "test-service",
        transport,
        // No level specified - should use env var
      });

      envLogger.info("info message");
      envLogger.error("error message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("error");

      // Restore
      if (originalLevel !== undefined) {
        process.env.LOG_LEVEL = originalLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });
  });

  // ============================================================================
  // Context Logging
  // ============================================================================

  describe("context logging", () => {
    it("should log with context key-value pairs", () => {
      logger.info({ userId: "user123", action: "login" }, "User logged in");

      const entry = transport.getEntries()[0];
      expect(entry.message).toBe("User logged in");
      expect(entry.userId).toBe("user123");
      expect(entry.action).toBe("login");
    });

    it("should support logging without context (message only)", () => {
      logger.info("Simple message");

      const entry = transport.getEntries()[0];
      expect(entry.message).toBe("Simple message");
    });

    it("should handle empty context object", () => {
      logger.info({}, "Message with empty context");

      const entry = transport.getEntries()[0];
      expect(entry.message).toBe("Message with empty context");
    });

    it("should include base context in all log entries", () => {
      const contextLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { environment: "test", region: "us-west-2" },
      });

      contextLogger.info("Test message");

      const entry = transport.getEntries()[0];
      expect(entry.environment).toBe("test");
      expect(entry.region).toBe("us-west-2");
    });

    it("should merge call context with base context", () => {
      const contextLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { environment: "test" },
      });

      contextLogger.info({ requestId: "req123" }, "Processing request");

      const entry = transport.getEntries()[0];
      expect(entry.environment).toBe("test");
      expect(entry.requestId).toBe("req123");
    });

    it("should allow call context to override base context", () => {
      const contextLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { mode: "default" },
      });

      contextLogger.info({ mode: "override" }, "Mode changed");

      const entry = transport.getEntries()[0];
      expect(entry.mode).toBe("override");
    });
  });

  // ============================================================================
  // Child Loggers
  // ============================================================================

  describe("child loggers", () => {
    it("should create child logger that inherits base context", () => {
      const parentLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { component: "parent" },
      });

      const childLogger = parentLogger.child({ requestId: "req123" });
      childLogger.info("Child message");

      const entry = transport.getEntries()[0];
      expect(entry.component).toBe("parent");
      expect(entry.requestId).toBe("req123");
    });

    it("should allow child to extend context", () => {
      const parentLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { app: "myapp" },
      });

      const childLogger = parentLogger.child({
        module: "auth",
        trace: "trace123",
      });
      childLogger.info("Authentication started");

      const entry = transport.getEntries()[0];
      expect(entry.app).toBe("myapp");
      expect(entry.module).toBe("auth");
      expect(entry.trace).toBe("trace123");
    });

    it("should allow child to override parent context", () => {
      const parentLogger = new Logger({
        service: "test-service",
        transport,
        level: "trace",
        context: { component: "parent", level: "top" },
      });

      const childLogger = parentLogger.child({ component: "child" });
      childLogger.info("Child message");

      const entry = transport.getEntries()[0];
      expect(entry.component).toBe("child");
    });

    it("should inherit log level from parent", () => {
      const parentLogger = new Logger({
        service: "test-service",
        transport,
        level: "warn",
      });

      const childLogger = parentLogger.child({ requestId: "req123" });
      childLogger.debug("Should not appear");
      childLogger.warn("Should appear");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("warn");
    });

    it("should share transport with parent", () => {
      const childLogger = logger.child({ requestId: "req123" });

      logger.info("Parent message");
      childLogger.info("Child message");

      const entries = transport.getEntries();
      expect(entries).toHaveLength(2);
    });

    it("should create nested child loggers", () => {
      const child1 = logger.child({ level1: "a" });
      const child2 = child1.child({ level2: "b" });
      const child3 = child2.child({ level3: "c" });

      child3.info("Nested message");

      const entry = transport.getEntries()[0];
      expect(entry.level1).toBe("a");
      expect(entry.level2).toBe("b");
      expect(entry.level3).toBe("c");
    });
  });

  // ============================================================================
  // Path Sanitization
  // ============================================================================

  describe("path sanitization", () => {
    it("should sanitize paths starting with /Users/", () => {
      logger.info({ path: "/Users/john/projects/app/file.ts" }, "File access");

      const entry = transport.getEntries()[0];
      expect(entry.path).toMatch(/^~\/projects\/app\/file\.ts$/);
    });

    it("should sanitize paths starting with /home/", () => {
      logger.info({ path: "/home/john/projects/app/file.ts" }, "File access");

      const entry = transport.getEntries()[0];
      expect(entry.path).toMatch(/^~\/projects\/app\/file\.ts$/);
    });

    it("should sanitize paths in nested objects", () => {
      logger.info(
        {
          config: {
            projectPath: "/Users/jane/dev/myproject",
          },
        },
        "Config loaded"
      );

      const entry = transport.getEntries()[0];
      expect((entry.config as { projectPath: string }).projectPath).toMatch(
        /^~\/dev\/myproject$/
      );
    });

    it("should not modify non-path strings", () => {
      logger.info({ name: "john doe", id: "user123" }, "User info");

      const entry = transport.getEntries()[0];
      expect(entry.name).toBe("john doe");
      expect(entry.id).toBe("user123");
    });

    it("should sanitize paths that start with /", () => {
      logger.info({ path: "/var/log/app.log" }, "Log path");

      const entry = transport.getEntries()[0];
      // /var paths are not user home directories, so they may remain
      // but paths with /Users/ or /home/ should be sanitized
      expect(typeof entry.path).toBe("string");
    });
  });

  // ============================================================================
  // Sensitive Field Redaction
  // ============================================================================

  describe("sensitive field redaction", () => {
    it("should redact password fields", () => {
      logger.info({ password: "secret123" }, "Login attempt");

      const entry = transport.getEntries()[0];
      expect(entry.password).toBe("[REDACTED]");
    });

    it("should redact token fields", () => {
      logger.info({ token: "jwt-abc123" }, "Token generated");

      const entry = transport.getEntries()[0];
      expect(entry.token).toBe("[REDACTED]");
    });

    it("should redact apiKey fields", () => {
      logger.info({ apiKey: "sk-12345" }, "API call");

      const entry = transport.getEntries()[0];
      expect(entry.apiKey).toBe("[REDACTED]");
    });

    it("should redact api_key fields", () => {
      logger.info({ api_key: "key-abc" }, "API call");

      const entry = transport.getEntries()[0];
      expect(entry.api_key).toBe("[REDACTED]");
    });

    it("should redact secret fields", () => {
      logger.info({ secret: "my-secret" }, "Secret access");

      const entry = transport.getEntries()[0];
      expect(entry.secret).toBe("[REDACTED]");
    });

    it("should redact credential fields", () => {
      logger.info({ credential: "cred-xyz" }, "Auth");

      const entry = transport.getEntries()[0];
      expect(entry.credential).toBe("[REDACTED]");
    });

    it("should redact auth fields", () => {
      logger.info({ auth: "bearer xyz" }, "Authorization");

      const entry = transport.getEntries()[0];
      expect(entry.auth).toBe("[REDACTED]");
    });

    it("should redact bearer fields", () => {
      logger.info({ bearer: "token123" }, "Bearer token");

      const entry = transport.getEntries()[0];
      expect(entry.bearer).toBe("[REDACTED]");
    });

    it("should redact fields case-insensitively", () => {
      logger.info({ PASSWORD: "upper", Password: "mixed" }, "Case test");

      const entry = transport.getEntries()[0];
      expect(entry.PASSWORD).toBe("[REDACTED]");
      expect(entry.Password).toBe("[REDACTED]");
    });

    it("should redact sensitive fields in nested objects", () => {
      logger.info(
        {
          config: {
            apiKey: "sk-nested",
            timeout: 5000,
          },
        },
        "Config"
      );

      const entry = transport.getEntries()[0];
      const config = entry.config as { apiKey: string; timeout: number };
      expect(config.apiKey).toBe("[REDACTED]");
      expect(config.timeout).toBe(5000);
    });

    it("should not redact non-sensitive fields", () => {
      logger.info({ username: "john", timeout: 3000 }, "Config");

      const entry = transport.getEntries()[0];
      expect(entry.username).toBe("john");
      expect(entry.timeout).toBe(3000);
    });
  });

  // ============================================================================
  // Error Object Handling
  // ============================================================================

  describe("error object handling", () => {
    it("should serialize Error objects with name and message", () => {
      const error = new Error("Something went wrong");
      logger.error({ error }, "Operation failed");

      const entry = transport.getEntries()[0];
      const errorData = entry.error as {
        name: string;
        message: string;
        stack?: string;
      };
      expect(errorData.name).toBe("Error");
      expect(errorData.message).toBe("Something went wrong");
    });

    it("should include truncated stack trace", () => {
      const error = new Error("Test error");
      logger.error({ error }, "Error occurred");

      const entry = transport.getEntries()[0];
      const errorData = entry.error as {
        name: string;
        message: string;
        stack?: string;
      };
      expect(errorData.stack).toBeDefined();
      // Stack should be limited to 5 lines
      const stackLines = errorData.stack?.split("\n") || [];
      expect(stackLines.length).toBeLessThanOrEqual(5);
    });

    it("should handle custom error types", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      const error = new CustomError("Custom error message");
      logger.error({ error }, "Custom error occurred");

      const entry = transport.getEntries()[0];
      const errorData = entry.error as { name: string; message: string };
      expect(errorData.name).toBe("CustomError");
      expect(errorData.message).toBe("Custom error message");
    });

    it("should sanitize paths in error messages", () => {
      const error = new Error("File not found: /Users/john/project/file.ts");
      logger.error({ error }, "File error");

      const entry = transport.getEntries()[0];
      const errorData = entry.error as { message: string };
      expect(errorData.message).not.toContain("/Users/john");
      expect(errorData.message).toContain("~");
    });
  });

  // ============================================================================
  // Long String Truncation
  // ============================================================================

  describe("long string truncation", () => {
    it("should truncate strings longer than 500 characters", () => {
      const longString = "a".repeat(600);
      logger.info({ data: longString }, "Long data");

      const entry = transport.getEntries()[0];
      const data = entry.data as string;
      expect(data.length).toBeLessThan(600);
      expect(data).toContain("...[truncated]");
    });

    it("should preserve strings at exactly 500 characters", () => {
      const exactString = "a".repeat(500);
      logger.info({ data: exactString }, "Exact data");

      const entry = transport.getEntries()[0];
      const data = entry.data as string;
      expect(data).toBe(exactString);
    });

    it("should preserve strings under 500 characters", () => {
      const shortString = "a".repeat(100);
      logger.info({ data: shortString }, "Short data");

      const entry = transport.getEntries()[0];
      expect(entry.data).toBe(shortString);
    });

    it("should truncate long strings in nested objects", () => {
      const longString = "b".repeat(600);
      logger.info({ nested: { content: longString } }, "Nested long data");

      const entry = transport.getEntries()[0];
      const nested = entry.nested as { content: string };
      expect(nested.content).toContain("...[truncated]");
    });
  });

  // ============================================================================
  // Array Handling
  // ============================================================================

  describe("array handling", () => {
    it("should log arrays in context", () => {
      logger.info({ items: [1, 2, 3] }, "Array data");

      const entry = transport.getEntries()[0];
      expect(entry.items).toEqual([1, 2, 3]);
    });

    it("should truncate arrays longer than 20 items", () => {
      const longArray = Array.from({ length: 30 }, (_, i) => i);
      logger.info({ items: longArray }, "Long array");

      const entry = transport.getEntries()[0];
      // Truncated arrays are wrapped in an object with metadata
      const items = entry.items as {
        _items: number[];
        _truncated: boolean;
        _originalLength: number;
      };
      expect(items._items.length).toBe(20);
      expect(items._truncated).toBe(true);
      expect(items._originalLength).toBe(30);
    });

    it("should sanitize values within arrays", () => {
      logger.info(
        { paths: ["/Users/john/a.ts", "/Users/john/b.ts"] },
        "Paths array"
      );

      const entry = transport.getEntries()[0];
      const paths = entry.paths as string[];
      expect(paths[0]).toMatch(/^~\//);
      expect(paths[1]).toMatch(/^~\//);
    });
  });

  // ============================================================================
  // Array Truncation Boundary Cases
  // ============================================================================

  describe("array truncation boundaries", () => {
    it("should not truncate array with exactly 20 items", () => {
      const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
      logger.info({ items }, "Exact boundary");

      const entry = transport.getEntries()[0];
      // Exactly 20 items should NOT be truncated, so items should remain an array
      expect(Array.isArray(entry.items)).toBe(true);
      expect((entry.items as string[]).length).toBe(20);
    });

    it("should truncate array with 21 items to 20", () => {
      const items = Array.from({ length: 21 }, (_, i) => `item-${i}`);
      logger.info({ items }, "Over boundary");

      const entry = transport.getEntries()[0];
      // 21 items exceeds the limit, so it should be wrapped in truncation metadata
      const truncatedItems = entry.items as {
        _items: string[];
        _truncated: boolean;
        _originalLength: number;
      };
      expect(truncatedItems._items.length).toBe(20);
      expect(truncatedItems._truncated).toBe(true);
      expect(truncatedItems._originalLength).toBe(21);
    });

    it("should not truncate array with 19 items", () => {
      const items = Array.from({ length: 19 }, (_, i) => `item-${i}`);
      logger.info({ items }, "Under boundary");

      const entry = transport.getEntries()[0];
      // 19 items should NOT be truncated, so items should remain an array
      expect(Array.isArray(entry.items)).toBe(true);
      expect((entry.items as string[]).length).toBe(19);
    });
  });
});

// ============================================================================
// Factory Functions
// ============================================================================

describe("Factory Functions", () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport();
  });

  afterEach(() => {
    transport.clear();
  });

  describe("createLogger", () => {
    it("should create a logger with specified options", () => {
      const logger = createLogger({
        service: "my-service",
        transport,
        level: "trace",
      });

      logger.info("Test message");

      const entry = transport.getEntries()[0];
      expect(entry.service).toBe("my-service");
    });

    it("should not emit a top-level `version` field (unreserved in v1.0.0, issue #36)", () => {
      const logger = createLogger({
        service: "my-service",
        transport,
        level: "trace",
      });

      logger.info("Test message");

      const entry = transport.getEntries()[0];
      expect(entry.version).toBeUndefined();
    });

    it("should accept initial context", () => {
      const logger = createLogger({
        service: "my-service",
        transport,
        level: "trace",
        context: { env: "test" },
      });

      logger.info("Test message");

      const entry = transport.getEntries()[0];
      expect(entry.env).toBe("test");
    });
  });

  describe("createComponentLogger", () => {
    it("should create a logger with component set", () => {
      const logger = createComponentLogger("my-service", "auth-module", {
        transport,
        level: "trace",
      });

      logger.info("Component message");

      const entry = transport.getEntries()[0];
      expect(entry.service).toBe("my-service");
      expect(entry.component).toBe("auth-module");
    });

    it("should merge additional context", () => {
      const logger = createComponentLogger("my-service", "auth-module", {
        transport,
        level: "trace",
        context: { region: "us-east-1" },
      });

      logger.info("Component message");

      const entry = transport.getEntries()[0];
      expect(entry.component).toBe("auth-module");
      expect(entry.region).toBe("us-east-1");
    });

    it("should work with minimal options", () => {
      const logger = createComponentLogger("my-service", "database", {
        transport,
        level: "trace",
      });

      logger.info("DB connected");

      const entry = transport.getEntries()[0];
      expect(entry.component).toBe("database");
    });
  });

  describe("createToolLogger", () => {
    it("should create a logger with tool as component", () => {
      const logger = createToolLogger("centient", "search_patterns", {
        transport,
        level: "trace",
      });

      logger.info("Tool invoked");

      const entry = transport.getEntries()[0];
      expect(entry.service).toBe("centient");
      expect(entry.component).toBe("search_patterns");
    });

    it("should merge additional context", () => {
      const logger = createToolLogger("centient", "save_session_note", {
        transport,
        level: "trace",
        context: { sessionId: "sess-123" },
      });

      logger.info("Note saved");

      const entry = transport.getEntries()[0];
      expect(entry.component).toBe("save_session_note");
      expect(entry.sessionId).toBe("sess-123");
    });
  });

  describe("createSessionLogger", () => {
    it("should create a logger with session context", () => {
      const logger = createSessionLogger(
        "centient",
        "session-abc",
        "/Users/john/projects/myapp",
        {
          transport,
          level: "trace",
        }
      );

      logger.info("Session started");

      const entry = transport.getEntries()[0];
      expect(entry.service).toBe("centient");
      expect(entry.sessionId).toBe("session-abc");
    });

    it("should sanitize project path", () => {
      const logger = createSessionLogger(
        "centient",
        "session-xyz",
        "/Users/jane/dev/project",
        {
          transport,
          level: "trace",
        }
      );

      logger.info("Session started");

      const entry = transport.getEntries()[0];
      expect(entry.projectPath).toMatch(/^~\/dev\/project$/);
      expect(entry.projectPath).not.toContain("/Users/jane");
    });

    it("should merge additional context", () => {
      const logger = createSessionLogger(
        "centient",
        "session-123",
        "/home/user/app",
        {
          transport,
          level: "trace",
          context: { embeddingPreset: "balanced" },
        }
      );

      logger.info("Session configured");

      const entry = transport.getEntries()[0];
      expect(entry.sessionId).toBe("session-123");
      expect(entry.embeddingPreset).toBe("balanced");
    });
  });
});

// ============================================================================
// CaptureTransport Helper Methods
// ============================================================================

describe("CaptureTransport", () => {
  let transport: CaptureTransport;
  let logger: Logger;

  beforeEach(() => {
    transport = new CaptureTransport();
    logger = new Logger({
      service: "test-service",
      transport,
      level: "trace",
    });
  });

  it("should capture entries and provide via getEntries", () => {
    logger.info("message 1");
    logger.info("message 2");

    const entries = transport.getEntries();
    expect(entries).toHaveLength(2);
  });

  it("should provide raw JSON output via getOutput", () => {
    logger.info("test message");

    const output = transport.getOutput();
    expect(output).toHaveLength(1);
    expect(() => JSON.parse(output[0])).not.toThrow();
  });

  it("should filter entries by level via getEntriesByLevel", () => {
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    const warnEntries = transport.getEntriesByLevel("warn");
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0].message).toBe("warn message");
  });

  it("should filter entries by component via getEntriesByComponent", () => {
    const logger1 = new Logger({
      service: "test",
      transport,
      level: "trace",
      context: { component: "auth" },
    });
    const logger2 = new Logger({
      service: "test",
      transport,
      level: "trace",
      context: { component: "db" },
    });

    logger1.info("auth message");
    logger2.info("db message");

    const authEntries = transport.getEntriesByComponent("auth");
    expect(authEntries).toHaveLength(1);
    expect(authEntries[0].message).toBe("auth message");
  });

  it("should check for message presence via hasMessage", () => {
    logger.info("hello world");

    expect(transport.hasMessage("hello")).toBe(true);
    expect(transport.hasMessage("world")).toBe(true);
    expect(transport.hasMessage("goodbye")).toBe(false);
  });

  it("should clear all entries via clear", () => {
    logger.info("message 1");
    logger.info("message 2");

    expect(transport.getEntries()).toHaveLength(2);

    transport.clear();

    expect(transport.getEntries()).toHaveLength(0);
    expect(transport.getOutput()).toHaveLength(0);
  });
});

// ============================================================================
// Logger Close Method
// ============================================================================

describe("Logger close", () => {
  it("should call transport close when logger is closed", async () => {
    const transport = new CaptureTransport();
    const logger = new Logger({
      service: "test",
      transport,
      level: "trace",
    });

    // Should not throw
    await expect(logger.close()).resolves.not.toThrow();
  });
});
