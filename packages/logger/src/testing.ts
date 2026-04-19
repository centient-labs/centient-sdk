/**
 * Testing Utilities for @centient/logger
 *
 * Provides utilities for capturing and inspecting log output in tests.
 *
 * @module testing
 */

import type { Logger, LogEntry, LogContext, Transport } from "./types.js";
import { Logger as LoggerImpl } from "./Logger.js";

/**
 * A transport that captures log entries for testing
 */
export class CaptureTransport implements Transport {
  private entries: LogEntry[] = [];
  private rawOutput: string[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
    this.rawOutput.push(JSON.stringify(entry));
  }

  async flush(): Promise<void> {
    // Nothing to flush
  }

  async close(): Promise<void> {
    // Nothing to close
  }

  /**
   * Get all captured log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get raw JSON output strings
   */
  getOutput(): string[] {
    return [...this.rawOutput];
  }

  /**
   * Get entries filtered by level
   */
  getEntriesByLevel(level: string): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Get entries filtered by component
   */
  getEntriesByComponent(component: string): LogEntry[] {
    return this.entries.filter((e) => e.component === component);
  }

  /**
   * Check if any entry contains the given message
   */
  hasMessage(message: string): boolean {
    return this.entries.some((e) => e.message.includes(message));
  }

  /**
   * Clear all captured entries
   */
  clear(): void {
    this.entries = [];
    this.rawOutput = [];
  }
}

/**
 * Test logger result with capture methods
 */
export interface TestLoggerResult {
  /** The logger instance */
  logger: Logger;
  /** The capture transport */
  transport: CaptureTransport;
  /** Get all captured output strings */
  getOutput: () => string[];
  /** Get all captured log entries */
  getEntries: () => LogEntry[];
  /** Clear all captured entries */
  clear: () => void;
}

/**
 * Create a logger for testing with output capture
 *
 * @param component - Component name for the logger
 * @param context - Additional context to include
 * @returns A test logger with capture methods
 *
 * @example
 * const { logger, getEntries, clear } = createTestLogger("my-component");
 *
 * logger.info("Test message");
 *
 * const entries = getEntries();
 * expect(entries[0].message).toBe("Test message");
 *
 * clear();
 */
export function createTestLogger(
  component: string = "test",
  context: LogContext = {}
): TestLoggerResult {
  const transport = new CaptureTransport();
  const logger = new LoggerImpl({
    service: "test-service",
    transport,
    level: "trace", // Capture all levels in tests
    context: {
      ...context,
      component,
    },
  });

  return {
    logger,
    transport,
    getOutput: () => transport.getOutput(),
    getEntries: () => transport.getEntries(),
    clear: () => transport.clear(),
  };
}

/**
 * Create a silent logger that discards all output
 *
 * Useful when you need a logger but don't want any output.
 *
 * @param service - Service name for the logger
 * @returns A logger that discards all output
 */
export function createSilentLogger(service: string = "test"): Logger {
  const { logger } = createTestLogger(service);
  return logger;
}
