/**
 * Log Format Validation Tests
 *
 * Tests to verify that all packages emit identical LogEntry schema
 * and sanitization is consistent.
 *
 * @module tests/integration/log-format-validation.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir, hostname } from "os";
import { Logger } from "../../src/Logger.js";
import { FileTransport } from "../../src/transports/FileTransport.js";
import { ConsoleTransport } from "../../src/transports/ConsoleTransport.js";
import { AuditWriter } from "../../src/AuditWriter.js";
import { CaptureTransport, createTestLogger } from "../../src/testing.js";
import type { LogEntry, AuditEvent } from "../../src/types.js";

// Create unique test directory for each run
const testDir = join(
  tmpdir(),
  `engram-format-test-${Date.now()}-${process.pid}`
);

/**
 * LogEntry schema validator
 */
function validateLogEntry(entry: LogEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (typeof entry.timestamp !== "string") {
    errors.push("timestamp must be a string");
  } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(entry.timestamp)) {
    errors.push("timestamp must be ISO 8601 format");
  }

  if (!["trace", "debug", "info", "warn", "error", "fatal"].includes(entry.level)) {
    errors.push(`level must be valid log level, got: ${entry.level}`);
  }

  if (typeof entry.component !== "string") {
    errors.push("component must be a string");
  }

  if (typeof entry.message !== "string") {
    errors.push("message must be a string");
  }

  if (typeof entry.service !== "string") {
    errors.push("service must be a string");
  }

  if (typeof entry.pid !== "number") {
    errors.push("pid must be a number");
  }

  if (typeof entry.hostname !== "string") {
    errors.push("hostname must be a string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * AuditEvent schema validator
 */
function validateAuditEvent(event: AuditEvent): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (typeof event.id !== "string" || !/^\d+@.+:\d+$/.test(event.id)) {
    errors.push(`id must match format <pid>@<hostname>:<sequence>, got: ${event.id}`);
  }

  if (typeof event.timestamp !== "string") {
    errors.push("timestamp must be a string");
  } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(event.timestamp)) {
    errors.push("timestamp must be ISO 8601 format");
  }

  if (typeof event.pid !== "number") {
    errors.push("pid must be a number");
  }

  if (typeof event.version !== "string") {
    errors.push("version must be a string");
  }

  const validEventTypes = [
    "pattern_search", "pattern_load", "pattern_find", "pattern_sign",
    "skill_execute", "pattern_index", "pattern_version_create",
    "pattern_version_deprecate", "artifact_search", "artifact_load",
    "artifact_code_extract", "session_start", "session_note",
    "session_search", "session_finalize", "research_plan",
    "consultation", "branch_create", "branch_close", "tool_call",
  ];
  if (!validEventTypes.includes(event.eventType)) {
    errors.push(`eventType must be valid, got: ${event.eventType}`);
  }

  if (typeof event.tool !== "string") {
    errors.push("tool must be a string");
  }

  if (!["success", "failure", "partial"].includes(event.outcome)) {
    errors.push(`outcome must be success/failure/partial, got: ${event.outcome}`);
  }

  if (typeof event.duration !== "number") {
    errors.push("duration must be a number");
  }

  if (typeof event.input !== "object" || event.input === null) {
    errors.push("input must be an object");
  }

  if (typeof event.output !== "object" || event.output === null) {
    errors.push("output must be an object");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

describe("LogEntry Schema Validation", () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport();
  });

  afterEach(() => {
    transport.clear();
  });

  it("should emit valid LogEntry for simple message", () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info("Simple message");

    const entries = transport.getEntries();
    expect(entries).toHaveLength(1);

    const validation = validateLogEntry(entries[0]);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("should emit valid LogEntry for message with context", () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info({ userId: "user123", action: "login" }, "User logged in");

    const entries = transport.getEntries();
    const validation = validateLogEntry(entries[0]);
    expect(validation.valid).toBe(true);

    // Context fields should be present
    expect(entries[0].userId).toBe("user123");
    expect(entries[0].action).toBe("login");
  });

  it("should emit valid LogEntry at all log levels", () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.trace("Trace message");
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    logger.fatal("Fatal message");

    const entries = transport.getEntries();
    expect(entries).toHaveLength(6);

    const expectedLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
    for (let i = 0; i < entries.length; i++) {
      const validation = validateLogEntry(entries[i]);
      expect(validation.valid).toBe(true);
      expect(entries[i].level).toBe(expectedLevels[i]);
    }
  });

  it("should emit valid LogEntry from child loggers", () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    const childLogger = logger.child({ component: "auth", requestId: "req123" });
    childLogger.info("Child logger message");

    const entries = transport.getEntries();
    const validation = validateLogEntry(entries[0]);
    expect(validation.valid).toBe(true);

    // Child context should be merged
    expect(entries[0].component).toBe("auth");
    expect(entries[0].requestId).toBe("req123");
  });

  it("should include correct hostname and pid", () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info("Test message");

    const entries = transport.getEntries();
    expect(entries[0].pid).toBe(process.pid);
    expect(entries[0].hostname).toBe(hostname());
  });

  it("should emit consistent schema from factory functions", () => {
    const { logger: componentLogger, getEntries: getComponentEntries, clear: clearComponent } =
      createTestLogger("component-test");
    componentLogger.info("Component message");

    const entries = getComponentEntries();
    const validation = validateLogEntry(entries[0]);
    expect(validation.valid).toBe(true);

    clearComponent();
  });
});

describe("AuditEvent Schema Validation", () => {
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

  it("should emit valid AuditEvent with required fields", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("tool_call", "test_tool", "success", 150);

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const event = JSON.parse(content.trim()) as AuditEvent;

    const validation = validateAuditEvent(event);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    await writer.clearAllData();
  });

  it("should emit valid AuditEvent with all optional fields", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("pattern_load", "load_skill", "success", 200, {
      input: { skillId: "database/rls-policy", version: "1.0.0" },
      output: { resultCount: 1, tokensUsed: 500 },
      projectPath: "/test/project",
      sessionId: "session-123",
      context: { patternId: "database/rls-policy", category: "database" },
    });

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const event = JSON.parse(content.trim()) as AuditEvent;

    const validation = validateAuditEvent(event);
    expect(validation.valid).toBe(true);

    // Verify optional fields are present
    expect(event.sessionId).toBe("session-123");
    expect(event.context?.patternId).toBe("database/rls-policy");
    expect((event.output as Record<string, unknown>).resultCount).toBe(1);

    await writer.clearAllData();
  });

  it("should emit valid AuditEvent for all event types", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    const eventTypes = [
      "pattern_search", "pattern_load", "pattern_find",
      "skill_execute", "session_start", "session_note",
      "branch_create", "tool_call",
    ] as const;

    for (const eventType of eventTypes) {
      await writer.log(eventType, "test_tool", "success", 100);
    }

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const events = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AuditEvent);

    expect(events).toHaveLength(eventTypes.length);

    for (const event of events) {
      const validation = validateAuditEvent(event);
      expect(validation.valid).toBe(true);
    }

    await writer.clearAllData();
  });

  it("should emit valid AuditEvent for all outcomes", async () => {
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    const outcomes = ["success", "failure", "partial"] as const;

    for (const outcome of outcomes) {
      await writer.log("tool_call", "test_tool", outcome, 100);
    }

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const events = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AuditEvent);

    expect(events).toHaveLength(3);

    for (let i = 0; i < events.length; i++) {
      const validation = validateAuditEvent(events[i]);
      expect(validation.valid).toBe(true);
      expect(events[i].outcome).toBe(outcomes[i]);
    }

    await writer.clearAllData();
  });
});

describe("Sanitization Consistency", () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    transport.clear();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should sanitize paths consistently between Logger and AuditWriter", async () => {
    // Test Logger path sanitization
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info({ path: "/Users/testuser/projects/myapp" }, "Logger path test");

    const logEntries = transport.getEntries();
    expect(logEntries[0].path).toBe("~/projects/myapp");

    // Test AuditWriter path sanitization
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("tool_call", "test_tool", "success", 100, {
      projectPath: "/Users/testuser/projects/myapp",
    });

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const event = JSON.parse(content.trim());

    expect(event.projectPath).toBe("~/projects/myapp");

    await writer.clearAllData();
  });

  it("should redact sensitive fields consistently", async () => {
    // Test Logger sensitive field redaction
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info(
      {
        password: "secret123",
        apiKey: "sk-12345",
        token: "bearer-abc",
        normalField: "visible",
      },
      "Logger sensitive test"
    );

    const logEntries = transport.getEntries();
    expect(logEntries[0].password).toBe("[REDACTED]");
    expect(logEntries[0].apiKey).toBe("[REDACTED]");
    expect(logEntries[0].token).toBe("[REDACTED]");
    expect(logEntries[0].normalField).toBe("visible");

    // Test AuditWriter sensitive field redaction
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("tool_call", "test_tool", "success", 100, {
      input: {
        password: "secret123",
        apiKey: "sk-12345",
        token: "bearer-abc",
        normalField: "visible",
      },
    });

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const event = JSON.parse(content.trim());

    expect(event.input.password).toBe("[REDACTED]");
    expect(event.input.apiKey).toBe("[REDACTED]");
    expect(event.input.token).toBe("[REDACTED]");
    expect(event.input.normalField).toBe("visible");

    await writer.clearAllData();
  });

  it("should sanitize API key patterns in values consistently", async () => {
    // Test AuditWriter API key pattern detection
    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    await writer.log("tool_call", "test_tool", "success", 100, {
      input: {
        someValue: "sk-1234567890abcdefghijklmnop",
        normalValue: "regular text",
      },
    });

    const logPath = join(testDir, "events.jsonl");
    const content = readFileSync(logPath, "utf-8");
    const event = JSON.parse(content.trim());

    // API key patterns should be redacted
    expect(event.input.someValue).toBe("[REDACTED_API_KEY]");
    expect(event.input.normalValue).toBe("regular text");

    await writer.clearAllData();
  });

  it("should handle nested sensitive fields consistently", async () => {
    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info(
      {
        config: {
          database: {
            password: "db-secret",
            host: "localhost",
          },
          api: {
            apiKey: "api-secret",
            endpoint: "https://api.example.com",
          },
        },
      },
      "Nested sensitive test"
    );

    const logEntries = transport.getEntries();
    const config = logEntries[0].config as {
      database: { password: string; host: string };
      api: { apiKey: string; endpoint: string };
    };

    expect(config.database.password).toBe("[REDACTED]");
    expect(config.database.host).toBe("localhost");
    expect(config.api.apiKey).toBe("[REDACTED]");
    expect(config.api.endpoint).toBe("https://api.example.com");
  });
});

describe("FileTransport Log Format", () => {
  const logPath = join(testDir, "test.log");

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

  it("should write valid JSON Lines format to file", async () => {
    const transport = new FileTransport({
      filePath: logPath,
      maxBufferSize: 10,
      flushIntervalMs: 1000,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    logger.info("Message 1");
    logger.info("Message 2");
    logger.info("Message 3");

    // Ensure flush before close
    await transport.flush();
    await transport.close();

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);

    expect(lines).toHaveLength(3);

    // Each line should be valid JSON
    for (const line of lines) {
      const entry = JSON.parse(line) as LogEntry;
      const validation = validateLogEntry(entry);
      expect(validation.valid).toBe(true);
    }
  });

  it("should maintain schema consistency across rotations", async () => {
    // Create transport with very small max size to trigger rotation
    const transport = new FileTransport({
      filePath: logPath,
      maxSize: 500, // Very small to trigger rotation
      maxBufferSize: 1,
      flushIntervalMs: 100,
    });

    const logger = new Logger({
      service: "test-service",
      version: "1.0.0",
      transport,
      level: "trace",
    });

    // Write enough to potentially trigger rotation
    for (let i = 0; i < 20; i++) {
      logger.info({ index: i }, `Message ${i} with some extra content`);
    }

    await transport.close();

    // Read main file (may have fewer entries after rotation)
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n").filter((line) => line.length > 0);

      for (const line of lines) {
        const entry = JSON.parse(line) as LogEntry;
        const validation = validateLogEntry(entry);
        expect(validation.valid).toBe(true);
      }
    }
  });
});
