/**
 * Test Fixtures for E2E Logger Tests
 *
 * Factory functions for creating sample audit events and test data.
 *
 * @module tests/e2e/fixtures/sample-events
 */

import { randomUUID } from "crypto";
import type { AuditEventType, AuditOutcome } from "../../../src/types.js";

export interface TestAuditEvent {
  eventType: AuditEventType;
  tool: string;
  outcome: AuditOutcome;
  duration: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  projectPath?: string;
  sessionId?: string;
}

/**
 * Create a test audit event with optional overrides
 */
export function createTestEvent(
  overrides: Partial<TestAuditEvent> = {}
): TestAuditEvent {
  return {
    eventType: "tool_call",
    tool: `test_tool_${randomUUID().slice(0, 8)}`,
    outcome: "success",
    duration: Math.floor(Math.random() * 500),
    input: { query: "test" },
    projectPath: `/test/project/${randomUUID().slice(0, 8)}`,
    sessionId: `test-session-${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

/**
 * Generate a payload of approximately sizeKB kilobytes
 */
export function generateLargePayload(sizeKB: number = 10): Record<string, unknown> {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const data = Array.from({ length: sizeKB * 100 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
  return { data };
}

/**
 * Generate multiple test events
 */
export function generateTestEvents(
  count: number,
  baseOptions: Partial<TestAuditEvent> = {}
): TestAuditEvent[] {
  return Array.from({ length: count }, (_, i) =>
    createTestEvent({
      ...baseOptions,
      tool: baseOptions.tool || `test_tool_${i}`,
      duration: i * 10,
    })
  );
}

/**
 * Create a log entry for testing Logger
 */
export function createTestLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    message: `Test message ${randomUUID().slice(0, 8)}`,
    context: {
      requestId: randomUUID(),
      operation: "test",
      ...overrides,
    },
  };
}
