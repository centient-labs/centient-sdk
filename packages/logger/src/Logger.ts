/**
 * Core Logger Implementation
 *
 * Provides structured logging with transport abstraction, context management,
 * and child loggers.
 *
 * @module Logger
 */

import { hostname } from "os";
import type {
  Logger as ILogger,
  LoggerOptions,
  LogLevel,
  LogContext,
  LogEntry,
  Transport,
} from "./types.js";
import { LOG_LEVELS } from "./types.js";
import { sanitizePath, sanitizeError, isSensitiveFieldName } from "./sanitize.js";
import { getConfiguredLevel } from "./format.js";
import { ConsoleTransport } from "./transports/ConsoleTransport.js";

/**
 * Maximum number of array items to include in log context.
 * Arrays exceeding this limit will be truncated with metadata indicating truncation.
 */
const MAX_CONTEXT_ARRAY_ITEMS = 20;

/**
 * Core logger implementation with transport abstraction
 */
export class Logger implements ILogger {
  private level: number;
  private baseContext: LogContext;
  private transport: Transport;
  private component: string;
  private service: string;
  private pid: number;
  private host: string;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.level = LOG_LEVELS[options.level ?? getConfiguredLevel()];
    this.baseContext = options.context ?? {};
    this.transport = options.transport ?? new ConsoleTransport();
    this.component =
      (this.baseContext.component as string) ||
      (this.baseContext.tool as string) ||
      "main";
    this.pid = process.pid;
    this.host = hostname();
  }

  private sanitizeValue(key: string, value: unknown): unknown {
    if (isSensitiveFieldName(key)) {
      return "[REDACTED]";
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: sanitizeError(value),
        stack: value.stack
          ?.split("\n")
          .slice(0, 5)
          .map((line) => sanitizePath(line))
          .join("\n"),
      };
    }

    if (typeof value === "string") {
      if (
        value.startsWith("/") ||
        value.includes("/Users/") ||
        value.includes("/home/")
      ) {
        return sanitizePath(value);
      }
      if (value.length > 500) {
        return value.slice(0, 500) + "...[truncated]";
      }
      return value;
    }

    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        const truncated = value.length > MAX_CONTEXT_ARRAY_ITEMS;
        const items = value
          .slice(0, MAX_CONTEXT_ARRAY_ITEMS)
          .map((item, i) => this.sanitizeValue(String(i), item));

        if (truncated) {
          return {
            _items: items,
            _truncated: true,
            _originalLength: value.length,
          };
        }
        return items;
      }
      return this.sanitizeContext(value as LogContext);
    }

    return value;
  }

  private sanitizeContext(context: LogContext): LogContext {
    const sanitized: LogContext = {};
    for (const [key, value] of Object.entries(context)) {
      sanitized[key] = this.sanitizeValue(key, value);
    }
    return sanitized;
  }

  private buildEntry(
    level: LogLevel,
    context: LogContext,
    message: string
  ): LogEntry {
    const timestamp = new Date().toISOString();
    const sanitizedContext = this.sanitizeContext({
      ...this.baseContext,
      ...context,
    });

    // Strip reserved top-level field names from user context so they can't
    // override the logger-computed values. The spread order below (computed
    // fields first, ...restContext last) means any key left in restContext
    // would silently overwrite the computed value — this destructure enforces
    // the reservation boundary. `version` is intentionally NOT reserved;
    // callers own it.
    const {
      component: _c,
      tool: _t,
      service: _s,
      timestamp: _ts,
      level: _lv,
      message: _msg,
      pid: _p,
      hostname: _h,
      ...restContext
    } = sanitizedContext;

    return {
      timestamp,
      level,
      component: this.component,
      message,
      service: this.service,
      pid: this.pid,
      hostname: this.host,
      ...restContext,
    };
  }

  private write(
    level: LogLevel,
    contextOrMessage: LogContext | string,
    message?: string
  ): void {
    if (LOG_LEVELS[level] < this.level) return;

    let context: LogContext;
    let msg: string;

    if (typeof contextOrMessage === "string") {
      context = {};
      msg = contextOrMessage;
    } else {
      context = contextOrMessage;
      msg = message ?? "";
    }

    const entry = this.buildEntry(level, context, msg);
    this.transport.write(entry);
  }

  trace(contextOrMessage: LogContext | string, message?: string): void {
    this.write("trace", contextOrMessage, message);
  }

  debug(contextOrMessage: LogContext | string, message?: string): void {
    this.write("debug", contextOrMessage, message);
  }

  info(contextOrMessage: LogContext | string, message?: string): void {
    this.write("info", contextOrMessage, message);
  }

  warn(contextOrMessage: LogContext | string, message?: string): void {
    this.write("warn", contextOrMessage, message);
  }

  error(contextOrMessage: LogContext | string, message?: string): void {
    this.write("error", contextOrMessage, message);
  }

  fatal(contextOrMessage: LogContext | string, message?: string): void {
    this.write("fatal", contextOrMessage, message);
  }

  child(context: LogContext): Logger {
    // Child inherits component unless overridden
    const childContext = {
      ...this.baseContext,
      ...this.sanitizeContext(context),
    };
    if (!childContext.component && !childContext.tool) {
      childContext.component = this.component;
    }

    return new Logger({
      service: this.service,
      transport: this.transport,
      level: (Object.entries(LOG_LEVELS).find(
        ([, v]) => v === this.level
      )?.[0] ?? "info") as LogLevel,
      context: childContext,
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new logger instance
 *
 * @param options - Logger configuration options
 * @returns A new Logger instance
 *
 * @example
 * const logger = createLogger({ service: "my-app" });
 * logger.info({ appVersion: "1.0.0" }, "Application started");
 */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * Create a logger with a specific component name
 *
 * @param service - The service name
 * @param component - The component name
 * @param options - Additional logger options
 * @returns A new Logger instance with component set
 */
export function createComponentLogger(
  service: string,
  component: string,
  options: Partial<LoggerOptions> = {}
): Logger {
  return new Logger({
    ...options,
    service,
    context: {
      ...options.context,
      component,
    },
  });
}

/**
 * Create a logger for a specific tool
 *
 * @param service - The service name
 * @param toolName - The tool name
 * @param options - Additional logger options
 * @returns A new Logger instance with tool set as component
 */
export function createToolLogger(
  service: string,
  toolName: string,
  options: Partial<LoggerOptions> = {}
): Logger {
  return new Logger({
    ...options,
    service,
    context: {
      ...options.context,
      tool: toolName,
    },
  });
}

/**
 * Create a logger for a session
 *
 * @param service - The service name
 * @param sessionId - The session identifier
 * @param projectPath - The project path (will be sanitized)
 * @param options - Additional logger options
 * @returns A new Logger instance with session context
 */
export function createSessionLogger(
  service: string,
  sessionId: string,
  projectPath: string,
  options: Partial<LoggerOptions> = {}
): Logger {
  return new Logger({
    ...options,
    service,
    context: {
      ...options.context,
      sessionId,
      projectPath: sanitizePath(projectPath),
    },
  });
}
