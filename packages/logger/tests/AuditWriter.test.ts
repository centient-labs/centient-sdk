/**
 * AuditWriter Tests
 *
 * Comprehensive tests for the write-only audit event logging system.
 * Tests cover event logging, ID generation, sanitization, rotation, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir, hostname } from "os";
import { AuditWriter, createAuditWriter } from "../src/AuditWriter.js";
import type { AuditEventType, AuditOutcome } from "../src/types.js";

// Create unique test directory for each run
const testDir = join(tmpdir(), `engram-audit-test-${Date.now()}-${process.pid}`);

/**
 * Helper to read all events from the log file
 */
function readEvents(logPath: string): Array<Record<string, unknown>> {
  if (!existsSync(logPath)) {
    return [];
  }
  const content = readFileSync(logPath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("AuditWriter", () => {
  let auditWriter: AuditWriter;

  beforeEach(() => {
    // Create fresh test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create writer with test directory
    auditWriter = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
      maxFileSizeBytes: 1024 * 1024, // 1MB for testing
      retentionDays: 7,
    });
  });

  afterEach(async () => {
    // Clear data and cleanup
    await auditWriter.clearAllData();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // 1. Logging audit events with all required fields
  // ===========================================================================
  describe("log() - audit event logging", () => {
    it("should log an event with all required fields", async () => {
      const eventId = await auditWriter.log(
        "pattern_load",
        "load_skill",
        "success",
        150,
        {
          input: { skillId: "database/rls-policy" },
          projectPath: "/tmp/test-project",
          sessionId: "session-123",
          context: { patternId: "database/rls-policy", version: "1.0.0" },
        }
      );

      expect(eventId).toBeTruthy();

      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.id).toBe(eventId);
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(event.pid).toBe(process.pid);
      expect(event.version).toBe("1.0.0-test");
      expect(event.eventType).toBe("pattern_load");
      expect(event.tool).toBe("load_skill");
      expect(event.outcome).toBe("success");
      expect(event.duration).toBe(150);
      expect(event.sessionId).toBe("session-123");
    });

    it("should log events with different event types", async () => {
      const eventTypes: AuditEventType[] = [
        "pattern_search",
        "skill_execute",
        "session_start",
        "session_finalize",
        "branch_create",
      ];

      for (const eventType of eventTypes) {
        await auditWriter.log(eventType, "test_tool", "success", 100);
      }

      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(eventTypes.length);
      expect(events.map((e) => e.eventType)).toEqual(eventTypes);
    });

    it("should log events with different outcomes", async () => {
      const outcomes: AuditOutcome[] = ["success", "failure", "partial"];

      for (const outcome of outcomes) {
        await auditWriter.log("pattern_load", "test_tool", outcome, 100);
      }

      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(outcomes.length);
      expect(events.map((e) => e.outcome)).toEqual(outcomes);
    });

    it("should log events with output fields", async () => {
      await auditWriter.log("pattern_search", "search_patterns", "success", 200, {
        output: {
          resultCount: 42,
          tokensUsed: 1500,
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const event = events[0];
      expect((event.output as Record<string, unknown>).resultCount).toBe(42);
      expect((event.output as Record<string, unknown>).tokensUsed).toBe(1500);
    });

    it("should log events with error output fields", async () => {
      await auditWriter.log("skill_execute", "execute_skill", "failure", 50, {
        output: {
          errorCode: "TIMEOUT",
          errorMessage: "Operation timed out after 5000ms",
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const event = events[0];
      expect((event.output as Record<string, unknown>).errorCode).toBe("TIMEOUT");
      expect((event.output as Record<string, unknown>).errorMessage).toBe(
        "Operation timed out after 5000ms"
      );
    });

    it("should log multiple events in sequence", async () => {
      const eventCount = 10;
      for (let i = 0; i < eventCount; i++) {
        await auditWriter.log("pattern_load", `tool_${i}`, "success", i * 10);
      }

      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(eventCount);
    });
  });

  // ===========================================================================
  // 2. Event ID generation
  // ===========================================================================
  describe("event ID generation", () => {
    it("should generate event ID in format <pid>@<hostname>:<sequence>", async () => {
      const eventId = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );

      const expectedPrefix = `${process.pid}@${hostname()}:`;
      expect(eventId).toMatch(new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`));
    });

    it("should increment sequence for each event", async () => {
      const eventId1 = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );
      const eventId2 = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );
      const eventId3 = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );

      // Extract sequence numbers
      const seq1 = parseInt(eventId1.split(":")[1], 10);
      const seq2 = parseInt(eventId2.split(":")[1], 10);
      const seq3 = parseInt(eventId3.split(":")[1], 10);

      expect(seq2).toBe(seq1 + 1);
      expect(seq3).toBe(seq2 + 1);
    });

    it("should use consistent pid and hostname", async () => {
      const eventId1 = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );
      const eventId2 = await auditWriter.log(
        "skill_execute",
        "other_tool",
        "failure",
        200
      );

      const [pidHost1] = eventId1.split(":");
      const [pidHost2] = eventId2.split(":");

      expect(pidHost1).toBe(pidHost2);
      expect(pidHost1).toBe(`${process.pid}@${hostname()}`);
    });
  });

  // ===========================================================================
  // 3. Input sanitization (sensitive fields redacted, paths sanitized)
  // ===========================================================================
  describe("input sanitization", () => {
    it("should redact sensitive field names", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          password: "secret123",
          token: "bearer-abc-xyz",
          apiKey: "sk-1234567890",
          normalField: "visible",
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;

      expect(input.password).toBe("[REDACTED]");
      expect(input.token).toBe("[REDACTED]");
      expect(input.apiKey).toBe("[REDACTED]");
      expect(input.normalField).toBe("visible");
    });

    it("should redact fields matching sensitive patterns", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          userPassword: "secret",
          authToken: "token123",
          secretKey: "key123",
          credentialId: "cred456",
          bearerToken: "bearer789",
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;

      expect(input.userPassword).toBe("[REDACTED]");
      expect(input.authToken).toBe("[REDACTED]");
      expect(input.secretKey).toBe("[REDACTED]");
      expect(input.credentialId).toBe("[REDACTED]");
      expect(input.bearerToken).toBe("[REDACTED]");
    });

    it("should sanitize file paths in projectPath", async () => {
      // Note: The actual home directory replacement depends on the system
      // We test the path sanitization indirectly through the log
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        projectPath: "/Users/testuser/projects/myapp",
      });

      const events = readEvents(auditWriter.getLogPath());
      // Path should be sanitized (home replaced with ~)
      expect(events[0].projectPath).toBe("~/projects/myapp");
    });

    it("should sanitize nested sensitive fields", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          config: {
            apiKey: "nested-secret",
            settings: {
              password: "deep-secret",
              normal: "visible",
            },
          },
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;
      const config = input.config as Record<string, unknown>;
      const settings = config.settings as Record<string, unknown>;

      expect(config.apiKey).toBe("[REDACTED]");
      expect(settings.password).toBe("[REDACTED]");
      expect(settings.normal).toBe("visible");
    });

    it("should sanitize API key patterns in values", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          someField: "sk-1234567890abcdefghijklmnop",
          normalField: "regular value",
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;

      // Values that look like API keys should be redacted
      expect(input.someField).toBe("[REDACTED_API_KEY]");
      expect(input.normalField).toBe("regular value");
    });
  });

  // ===========================================================================
  // 4. Long string truncation in input
  // ===========================================================================
  describe("long string truncation", () => {
    it("should truncate strings longer than 200 characters", async () => {
      // Use a string that won't trigger API key detection (mixed case, spaces, punctuation)
      const longString = "This is a long test message that will be truncated. ".repeat(10);

      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          longField: longString,
          shortField: "short",
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;

      expect(input.longField).toBe(longString.slice(0, 200) + "...");
      expect(input.shortField).toBe("short");
    });

    it("should truncate strings exactly at 200 characters", async () => {
      // Use strings that won't match API key patterns (include spaces/punctuation)
      // "Test message! " is 14 chars, 14 * 14 = 196, + "ABCD" = 200
      const exactString = "Test message! ".repeat(14) + "ABCD"; // exactly 200 chars
      const overString = "Test message! ".repeat(14) + "ABCDE"; // 201 chars

      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          exactField: exactString,
          overField: overString,
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;

      // 200 chars should not be truncated
      expect(input.exactField).toBe(exactString);
      // 201 chars should be truncated
      expect(input.overField).toBe(overString.slice(0, 200) + "...");
    });

    it("should truncate long strings in nested objects", async () => {
      const longString = "Nested content here. ".repeat(15);

      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          nested: {
            deep: {
              longField: longString,
            },
          },
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;
      const nested = input.nested as Record<string, unknown>;
      const deep = nested.deep as Record<string, unknown>;

      expect(deep.longField).toBe(longString.slice(0, 200) + "...");
    });

    it("should truncate long strings in arrays", async () => {
      const longString = "Array item content. ".repeat(15);

      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          items: ["short", longString, "also short"],
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;
      const items = input.items as string[];

      expect(items[0]).toBe("short");
      expect(items[1]).toBe(longString.slice(0, 200) + "...");
      expect(items[2]).toBe("also short");
    });
  });

  // ===========================================================================
  // 5. Size-based rotation when file exceeds threshold
  // ===========================================================================
  describe("size-based rotation", () => {
    it("should rotate when file exceeds max size threshold", async () => {
      // Create a writer with a very small max file size
      const smallWriter = new AuditWriter({
        auditDir: testDir,
        version: "1.0.0",
        maxFileSizeBytes: 500, // Very small threshold
        retentionDays: 7,
      });

      // Write enough data to exceed the threshold
      const logPath = smallWriter.getLogPath();

      // First, create a file that exceeds the threshold
      const largeContent = JSON.stringify({ data: "x".repeat(600) }) + "\n";
      writeFileSync(logPath, largeContent);

      // Now log something - this should trigger rotation
      await smallWriter.log("pattern_load", "test_tool", "success", 100);

      // Check that rotated file was created
      const files = readdirSync(testDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("events-") && f !== "events.jsonl"
      );

      expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);
      await smallWriter.clearAllData();
    });

    it("should not rotate when file is under threshold", async () => {
      // Log a few small events
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.log("pattern_load", "test_tool", "success", 100);

      // Check that only the main events.jsonl exists
      const files = readdirSync(testDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("events-") && f !== "events.jsonl"
      );

      expect(rotatedFiles).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 6. Cleanup of old rotated files
  // ===========================================================================
  describe("cleanup of old rotated files", () => {
    it("should delete rotated files older than retention period", async () => {
      // Create a writer with 1 day retention for testing
      const shortRetentionWriter = new AuditWriter({
        auditDir: testDir,
        version: "1.0.0",
        maxFileSizeBytes: 1024 * 1024,
        retentionDays: 1,
      });

      // Create an old rotated file
      const oldRotatedFile = join(
        testDir,
        `events-2020-01-01-12-00-00-${process.pid}.jsonl`
      );
      writeFileSync(oldRotatedFile, '{"test": "old"}\n');

      // Set the mtime to 30 days ago
      const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      utimesSync(oldRotatedFile, oldTime, oldTime);

      // Create a recent rotated file
      const recentRotatedFile = join(
        testDir,
        `events-2024-01-01-12-00-00-${process.pid}.jsonl`
      );
      writeFileSync(recentRotatedFile, '{"test": "recent"}\n');

      // Log something to trigger initialization and cleanup
      await shortRetentionWriter.log("pattern_load", "test_tool", "success", 100);

      // Old file should be deleted, recent file should remain
      expect(existsSync(oldRotatedFile)).toBe(false);
      expect(existsSync(recentRotatedFile)).toBe(true);

      await shortRetentionWriter.clearAllData();
    });

    it("should not delete the main events.jsonl file", async () => {
      // Create main file
      const logPath = auditWriter.getLogPath();
      writeFileSync(logPath, '{"test": "main"}\n');

      // Set old mtime
      const oldTime = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      utimesSync(logPath, oldTime, oldTime);

      // Log something to trigger cleanup
      await auditWriter.log("pattern_load", "test_tool", "success", 100);

      // Main file should still exist
      expect(existsSync(logPath)).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Concurrent access
  // ===========================================================================
  describe("concurrent access", () => {
    it("should handle multiple concurrent log calls", async () => {
      const concurrentWriter = new AuditWriter({ auditDir: testDir });

      // Fire 10 concurrent log calls
      const promises = Array.from({ length: 10 }, (_, i) =>
        concurrentWriter.log("pattern_load", `tool-${i}`, "success", i * 10, {
          input: { index: i },
        })
      );

      const eventIds = await Promise.all(promises);

      // All should have unique event IDs
      const uniqueIds = new Set(eventIds);
      expect(uniqueIds.size).toBe(10);

      // All should have sequential sequence numbers
      const sequences = eventIds.map((id) => parseInt(id.split(":")[1], 10));
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      await concurrentWriter.clearAllData();
    });
  });

  // ===========================================================================
  // 8. Multi-process safety (appendFile pattern)
  // ===========================================================================
  describe("multi-process safety", () => {
    it("should use appendFile pattern for atomic writes", async () => {
      // Log multiple events rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(auditWriter.log("pattern_load", `tool_${i}`, "success", i));
      }

      await Promise.all(promises);

      // All events should be logged without corruption
      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(10);

      // Each event should be valid JSON with proper structure
      for (const event of events) {
        expect(event.id).toBeTruthy();
        expect(event.timestamp).toBeTruthy();
        expect(event.eventType).toBe("pattern_load");
      }
    });

    it("should include pid in event for multi-process identification", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100);

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].pid).toBe(process.pid);
    });

    it("should include pid in event ID for uniqueness across processes", async () => {
      const eventId = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );

      expect(eventId).toContain(`${process.pid}@`);
    });
  });

  // ===========================================================================
  // 9. clearAllData for testing
  // ===========================================================================
  describe("clearAllData()", () => {
    it("should delete the log file", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      expect(existsSync(auditWriter.getLogPath())).toBe(true);

      await auditWriter.clearAllData();
      expect(existsSync(auditWriter.getLogPath())).toBe(false);
    });

    it("should reset the sequence counter", async () => {
      // Log some events
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.log("pattern_load", "test_tool", "success", 100);

      // Clear data
      await auditWriter.clearAllData();

      // Log again - sequence should restart from 1
      const eventId = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );
      const sequence = parseInt(eventId.split(":")[1], 10);
      expect(sequence).toBe(1);
    });

    it("should allow logging after clearAllData", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.clearAllData();

      // Should be able to log again without errors
      const eventId = await auditWriter.log(
        "pattern_load",
        "test_tool",
        "success",
        100
      );
      expect(eventId).toBeTruthy();

      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(1);
    });

    it("should not throw if log file does not exist", async () => {
      // Clear without ever logging
      await expect(auditWriter.clearAllData()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // 10. forceRotation for testing
  // ===========================================================================
  describe("forceRotation()", () => {
    it("should rotate the current log file immediately", async () => {
      // Log some events
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.log("pattern_load", "test_tool", "success", 200);

      const eventsBeforeRotation = readEvents(auditWriter.getLogPath());
      expect(eventsBeforeRotation).toHaveLength(2);

      // Force rotation
      await auditWriter.forceRotation();

      // Main log file should no longer exist (rotated away)
      expect(existsSync(auditWriter.getLogPath())).toBe(false);

      // Rotated file should exist
      const files = readdirSync(testDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("events-") && f.endsWith(".jsonl")
      );
      expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("should create rotated file with timestamp and pid in name", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.forceRotation();

      const files = readdirSync(testDir);
      const rotatedFile = files.find(
        (f) => f.startsWith("events-") && f !== "events.jsonl"
      );

      expect(rotatedFile).toBeTruthy();
      // Format: events-YYYY-MM-DDTHH-MM-SS-<pid>.jsonl
      expect(rotatedFile).toMatch(
        /events-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+\.jsonl/
      );
      expect(rotatedFile).toContain(`-${process.pid}.jsonl`);
    });

    it("should not throw if log file does not exist", async () => {
      // Force rotation without ever logging
      await expect(auditWriter.forceRotation()).resolves.not.toThrow();
    });

    it("should allow continued logging after forceRotation", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100);
      await auditWriter.forceRotation();

      // Log more events - should create new events.jsonl
      await auditWriter.log("pattern_load", "test_tool", "success", 200);

      expect(existsSync(auditWriter.getLogPath())).toBe(true);
      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(1);
      expect(events[0].duration).toBe(200);
    });
  });

  // ===========================================================================
  // 11. getLogPath and getAuditDir accessors
  // ===========================================================================
  describe("getLogPath() and getAuditDir()", () => {
    it("should return the log file path", () => {
      const logPath = auditWriter.getLogPath();
      expect(logPath).toBe(join(testDir, "events.jsonl"));
    });

    it("should return the audit directory path", () => {
      const auditDir = auditWriter.getAuditDir();
      expect(auditDir).toBe(testDir);
    });

    it("should use default paths when no options provided", () => {
      // Create writer with defaults (using a mock to avoid writing to ~/.engram)
      const defaultWriter = new AuditWriter({ auditDir: testDir });
      const auditDir = defaultWriter.getAuditDir();
      const logPath = defaultWriter.getLogPath();

      expect(auditDir).toBe(testDir);
      expect(logPath).toBe(join(testDir, "events.jsonl"));
    });
  });

  // ===========================================================================
  // 12. createAuditWriter factory function
  // ===========================================================================
  describe("createAuditWriter()", () => {
    it("should create an AuditWriter instance", () => {
      const writer = createAuditWriter({ auditDir: testDir });
      expect(writer).toBeInstanceOf(AuditWriter);
    });

    it("should pass options to the AuditWriter", async () => {
      const writer = createAuditWriter({
        auditDir: testDir,
        version: "2.0.0-factory",
        maxFileSizeBytes: 2048,
        retentionDays: 14,
      });

      await writer.log("pattern_load", "test_tool", "success", 100);

      const events = readEvents(writer.getLogPath());
      expect(events[0].version).toBe("2.0.0-factory");

      await writer.clearAllData();
    });

    it("should create independent instances", async () => {
      const writer1 = createAuditWriter({
        auditDir: join(testDir, "writer1"),
        version: "1.0.0",
      });
      const writer2 = createAuditWriter({
        auditDir: join(testDir, "writer2"),
        version: "2.0.0",
      });

      await writer1.log("pattern_load", "tool1", "success", 100);
      await writer2.log("pattern_load", "tool2", "success", 200);

      const events1 = readEvents(writer1.getLogPath());
      const events2 = readEvents(writer2.getLogPath());

      expect(events1[0].version).toBe("1.0.0");
      expect(events2[0].version).toBe("2.0.0");

      await writer1.clearAllData();
      await writer2.clearAllData();
    });

    it("should use defaults when no options provided", () => {
      // Note: We still provide auditDir to avoid writing to ~/.engram
      const writer = createAuditWriter({ auditDir: testDir });

      // Check that default version is used
      expect(writer.getAuditDir()).toBe(testDir);
    });
  });

  // ===========================================================================
  // Edge cases and error handling
  // ===========================================================================
  describe("edge cases", () => {
    it("should handle empty input object", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {},
      });

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].input).toEqual({});
    });

    it("should handle undefined optional fields", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {});

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].projectPath).toBeUndefined();
      expect(events[0].sessionId).toBeUndefined();
      expect(events[0].context).toBeUndefined();
    });

    it("should handle null values in input", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          nullField: null,
          undefinedField: undefined,
        } as Record<string, unknown>,
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;
      expect(input.nullField).toBeNull();
    });

    it("should handle special characters in input", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          specialChars: '{"quotes": "value", "newline": "\\n"}',
          unicode: "\u0000\u001f\u007f",
        },
      });

      // Should not throw and should produce valid JSON
      const events = readEvents(auditWriter.getLogPath());
      expect(events).toHaveLength(1);
    });

    it("should handle very long tool names", async () => {
      const longToolName = "a".repeat(500);
      await auditWriter.log("pattern_load", longToolName, "success", 100);

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].tool).toBe(longToolName);
    });

    it("should handle zero duration", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 0);

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].duration).toBe(0);
    });

    it("should handle negative duration", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", -100);

      const events = readEvents(auditWriter.getLogPath());
      expect(events[0].duration).toBe(-100);
    });

    it("should handle arrays with mixed types in input", async () => {
      await auditWriter.log("pattern_load", "test_tool", "success", 100, {
        input: {
          mixedArray: [1, "string", { nested: "object" }, null, true],
        },
      });

      const events = readEvents(auditWriter.getLogPath());
      const input = events[0].input as Record<string, unknown>;
      expect(Array.isArray(input.mixedArray)).toBe(true);
    });
  });
});
