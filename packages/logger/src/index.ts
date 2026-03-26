/**
 * @engram/logger - Shared logging infrastructure for Engram packages
 *
 * Provides structured logging with:
 * - Multiple transport options (Console, File, Null)
 * - Log levels (trace, debug, info, warn, error, fatal)
 * - Contextual child loggers
 * - Path and sensitive data sanitization
 * - Audit event logging
 * - Testing utilities
 *
 * @module @engram/logger
 *
 * @example
 * import { createLogger, ConsoleTransport } from "@engram/logger";
 *
 * const logger = createLogger({
 *   service: "my-service",
 *   version: "1.0.0",
 * });
 *
 * logger.info({ action: "start" }, "Service started");
 * logger.error({ err: error }, "Operation failed");
 */

// Types
export type {
  LogLevel,
  LogContext,
  LogEntry,
  Logger,
  LoggerOptions,
  Transport,
  ConsoleTransportOptions,
  FileTransportOptions,
  AuditEventType,
  AuditOutcome,
  AuditEvent,
  AuditWriterOptions,
} from "./types.js";

export { LOG_LEVELS, LogLevels } from "./types.js";

// Sanitization
export {
  sanitizePath,
  sanitizeError,
  sanitizeErrorMessage,
  sanitizeForLogging,
  createSanitizedErrorResponse,
  isSensitiveFieldName,
} from "./sanitize.js";

// Formatting
export {
  formatPretty,
  formatJson,
  isPrettyEnabled,
  getConfiguredLevel,
  generateRotationTimestamp,
} from "./format.js";
export type { PrettyEnabledOptions, ConfiguredLevelOptions } from "./format.js";

// Transports
export { ConsoleTransport } from "./transports/ConsoleTransport.js";
export { FileTransport } from "./transports/FileTransport.js";
export { NullTransport } from "./transports/NullTransport.js";

// Logger
export {
  Logger as LoggerImpl,
  createLogger,
  createComponentLogger,
  createToolLogger,
  createSessionLogger,
} from "./Logger.js";

// AuditWriter
export { AuditWriter, createAuditWriter } from "./AuditWriter.js";

// Testing
export {
  CaptureTransport,
  createTestLogger,
  createSilentLogger,
} from "./testing.js";
export type { TestLoggerResult } from "./testing.js";
