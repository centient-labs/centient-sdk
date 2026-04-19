/**
 * Type definitions for @centient/logger
 *
 * Consolidated types from centient's logger.ts and AuditLogger.ts
 *
 * @module types
 */

// ============================================================================
// Log Level Types
// ============================================================================

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Numeric values for log levels (lower = more verbose)
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Log level constants for convenient reference
 */
export const LogLevels = {
  TRACE: "trace" as const,
  DEBUG: "debug" as const,
  INFO: "info" as const,
  WARN: "warn" as const,
  ERROR: "error" as const,
  FATAL: "fatal" as const,
};

// ============================================================================
// Log Context and Entry Types
// ============================================================================

/**
 * Arbitrary context data to include with log entries
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Standard log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  service: string;
  pid: number;
  hostname: string;
  [key: string]: unknown;
}

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Logger interface with support for context and child loggers
 */
export interface Logger {
  trace(context: LogContext, message: string): void;
  trace(message: string): void;
  debug(context: LogContext, message: string): void;
  debug(message: string): void;
  info(context: LogContext, message: string): void;
  info(message: string): void;
  warn(context: LogContext, message: string): void;
  warn(message: string): void;
  error(context: LogContext, message: string): void;
  error(message: string): void;
  fatal(context: LogContext, message: string): void;
  fatal(message: string): void;
  child(context: LogContext): Logger;
  close(): Promise<void>;
}

/**
 * Options for creating a logger
 */
export interface LoggerOptions {
  /** Service name for log entries */
  service: string;
  /** Transport to use for output */
  transport?: Transport;
  /** Minimum log level to output */
  level?: LogLevel;
  /** Base context to include in all entries */
  context?: LogContext;
}

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Transport interface for log output destinations
 */
export interface Transport {
  /** Write a log entry */
  write(entry: LogEntry): void;
  /** Flush any buffered entries */
  flush(): Promise<void>;
  /** Close the transport and release resources */
  close(): Promise<void>;
}

/**
 * Options for console transport
 */
export interface ConsoleTransportOptions {
  /** Use pretty (colored) output instead of JSON */
  pretty?: boolean;
}

/**
 * Options for file transport
 */
export interface FileTransportOptions {
  /** Path to log file */
  filePath: string;
  /** Maximum file size in bytes before rotation (default: 50MB) */
  maxSize?: number;
  /** Maximum number of rotated files to keep (default: 5) */
  maxFiles?: number;
  /** Buffer flush interval in ms (default: 1000) */
  flushIntervalMs?: number;
  /** Maximum buffer size before forced flush (default: 100) */
  maxBufferSize?: number;
}

// ============================================================================
// Audit Types
// ============================================================================

export type AuditEventType =
  | "pattern_search"
  | "pattern_load"
  | "pattern_find"
  | "pattern_sign"
  | "skill_execute"
  | "pattern_index"
  | "pattern_version_create"
  | "pattern_version_deprecate"
  | "artifact_search"
  | "artifact_load"
  | "artifact_code_extract"
  | "session_start"
  | "session_note"
  | "session_search"
  | "session_finalize"
  | "research_plan"
  | "consultation"
  | "branch_create"
  | "branch_close"
  | "tool_call";

export type AuditOutcome = "success" | "failure" | "partial";

/**
 * Audit event structure for security/compliance logging
 */
export interface AuditEvent {
  id: string;
  timestamp: string;
  pid: number;
  version: string;
  eventType: AuditEventType;
  tool: string;
  outcome: AuditOutcome;
  duration: number;
  projectPath?: string;
  sessionId?: string;
  input: {
    [key: string]: unknown;
  };
  output: {
    resultCount?: number;
    tokensUsed?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  context?: {
    patternId?: string;
    skillId?: string;
    category?: string;
    version?: string;
  };
}

/**
 * Options for AuditWriter
 */
export interface AuditWriterOptions {
  /** Directory for audit logs (default: ~/.engram/audit) */
  auditDir?: string;
  /** Maximum file size in bytes before rotation (default: 50MB) */
  maxFileSizeBytes?: number;
  /** Days to retain rotated logs (default: 90) */
  retentionDays?: number;
  /** Service version string */
  version?: string;
}
