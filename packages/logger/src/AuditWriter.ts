/**
 * AuditWriter - Write-only audit event logging
 *
 * Features:
 * - Multi-process safe (appendFile pattern - open-write-close each time)
 * - Event IDs for idempotent dashboard import (<pid>@<hostname>:<sequence>)
 * - Centralized logs at ~/.engram/audit/events.jsonl
 * - Size-based rotation (50MB threshold, checked on startup)
 * - Auto-cleanup of rotated files older than retention period
 *
 * @module AuditWriter
 */

import { appendFile, stat, rename, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { homedir, hostname } from "os";
import type {
  AuditEvent,
  AuditEventType,
  AuditOutcome,
  AuditWriterOptions,
} from "./types.js";
import { sanitizePath, sanitizeForLogging, isSensitiveFieldName } from "./sanitize.js";
import { generateRotationTimestamp } from "./format.js";

const DEFAULT_AUDIT_DIR = join(homedir(), ".engram", "audit");
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_RETENTION_DAYS = 90;
const MAX_SANITIZATION_DEPTH = 10;

/**
 * AuditWriter - Write-only audit event logging
 *
 * Use this class to log audit events for security and compliance purposes.
 * Events are written to ~/.engram/audit/events.jsonl by default.
 *
 * Query functionality is NOT included - that will be provided by engram
 * REST API in Phase 2.
 */
export class AuditWriter {
  private auditDir: string;
  private logPath: string;
  private maxFileSizeBytes: number;
  private retentionDays: number;
  private version: string;
  private sequence: number = 0;
  private pid: number;
  private host: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: AuditWriterOptions = {}) {
    this.auditDir = options.auditDir ?? DEFAULT_AUDIT_DIR;
    this.logPath = join(this.auditDir, "events.jsonl");
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.version = options.version ?? "0.0.0";
    this.pid = process.pid;
    this.host = hostname();
  }

  /**
   * Generate a unique event ID
   * Format: <pid>@<hostname>:<sequence>
   */
  private generateEventId(): string {
    this.sequence++;
    return `${this.pid}@${this.host}:${this.sequence}`;
  }

  /**
   * Initialize: ensure directory exists, check rotation, cleanup old files
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.initPromise = null;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Ensure audit directory exists
      await mkdir(this.auditDir, { recursive: true });

      // Check if rotation is needed
      await this.rotateIfNeeded();

      // Cleanup old rotated files
      await this.cleanupOldFiles();

      this.initialized = true;
    } catch {
      // Continue anyway - logging is best-effort
      this.initialized = true;
    }
  }

  /**
   * Rotate log file if it exceeds size threshold
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await stat(this.logPath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB >= this.maxFileSizeBytes / (1024 * 1024)) {
        const timestamp = generateRotationTimestamp();
        const rotatedPath = join(
          this.auditDir,
          `events-${timestamp}-${this.pid}.jsonl`
        );

        try {
          await rename(this.logPath, rotatedPath);
        } catch (renameError: unknown) {
          // ENOENT means another process already rotated - that's fine
          const isEnoent =
            renameError instanceof Error &&
            "code" in renameError &&
            renameError.code === "ENOENT";
          if (!isEnoent) {
            throw renameError;
          }
        }
      }
    } catch (error: unknown) {
      // ENOENT means file doesn't exist - that's fine for fresh start
      const isEnoent =
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT";
      if (!isEnoent) {
        // Log rotation errors are non-fatal
      }
    }
  }

  /**
   * Delete rotated log files older than retention period
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await readdir(this.auditDir);
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        // Path traversal prevention: reject filenames with path separators
        if (file.includes("/") || file.includes("\\")) continue;

        // Match rotated files: events-YYYY-MM-DD-HHMMSS-<pid>.jsonl
        if (
          file.startsWith("events-") &&
          file.endsWith(".jsonl") &&
          file !== "events.jsonl"
        ) {
          const filePath = join(this.auditDir, file);
          try {
            const stats = await stat(filePath);
            if (stats.mtime.getTime() < cutoff) {
              await unlink(filePath);
            }
          } catch {
            // Ignore errors on individual files
          }
        }
      }
    } catch {
      // Ignore cleanup errors - not critical
    }
  }

  /**
   * Sanitize input to remove sensitive fields
   */
  private sanitizeInput(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    // First apply comprehensive sanitization (API keys, paths, sensitive fields)
    const sanitized = sanitizeForLogging(input) as Record<string, unknown>;

    // Then apply truncation to long strings and additional field-name checks
    return this.truncateLongStrings(sanitized);
  }

  /**
   * Truncate long string values to prevent excessive log sizes
   * @param input - The object to truncate
   * @param depth - Current recursion depth (default: 0)
   */
  private truncateLongStrings(
    input: Record<string, unknown>,
    depth: number = 0
  ): Record<string, unknown> {
    // Prevent stack overflow on deeply nested objects
    if (depth >= MAX_SANITIZATION_DEPTH) {
      return { _truncated: "[DEPTH_LIMIT_EXCEEDED]" };
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      // Check using centralized sensitive field detection
      if (isSensitiveFieldName(key)) {
        result[key] = "[REDACTED]";
      } else if (typeof value === "string" && value.length > 200) {
        result[key] = value.slice(0, 200) + "...";
      } else if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result[key] = this.truncateLongStrings(
          value as Record<string, unknown>,
          depth + 1
        );
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (typeof item === "string" && item.length > 200) {
            return item.slice(0, 200) + "...";
          }
          if (typeof item === "object" && item !== null) {
            return this.truncateLongStrings(
              item as Record<string, unknown>,
              depth + 1
            );
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Log an audit event
   *
   * Uses appendFile (open-write-close) for multi-process safety.
   *
   * @param eventType - Type of audit event
   * @param tool - Tool that triggered the event
   * @param outcome - Result of the operation
   * @param duration - Duration in milliseconds
   * @param options - Additional event data
   * @returns The generated event ID
   *
   * @example
   * const eventId = await auditWriter.log(
   *   "pattern_load",
   *   "load_skill",
   *   "success",
   *   150,
   *   {
   *     input: { skillId: "database/rls-policy" },
   *     projectPath: "/Users/dev/myproject",
   *     context: { patternId: "database/rls-policy", version: "1.0.0" }
   *   }
   * );
   */
  async log(
    eventType: AuditEventType,
    tool: string,
    outcome: AuditOutcome,
    duration: number,
    options: {
      input?: Record<string, unknown>;
      output?: AuditEvent["output"];
      projectPath?: string;
      sessionId?: string;
      context?: AuditEvent["context"];
    } = {}
  ): Promise<string> {
    await this.initialize();

    const eventId = this.generateEventId();
    const event: AuditEvent = {
      id: eventId,
      timestamp: new Date().toISOString(),
      pid: this.pid,
      version: this.version,
      eventType,
      tool,
      outcome,
      duration,
      projectPath: options.projectPath
        ? sanitizePath(options.projectPath)
        : undefined,
      sessionId: options.sessionId,
      input: this.sanitizeInput(options.input || {}),
      output: options.output || {},
      context: options.context,
    };

    const line = JSON.stringify(event) + "\n";

    try {
      // appendFile is atomic at the OS level for reasonable line sizes
      await appendFile(this.logPath, line, "utf-8");
    } catch {
      // Best-effort logging - don't throw on write errors
    }

    return eventId;
  }

  /**
   * Get the log file path
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Get the audit directory path
   */
  getAuditDir(): string {
    return this.auditDir;
  }

  /**
   * Clear all data (for testing)
   */
  async clearAllData(): Promise<void> {
    try {
      await unlink(this.logPath);
    } catch {
      // File may not exist
    }
    this.sequence = 0;
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Force rotation (for testing)
   */
  async forceRotation(): Promise<void> {
    await this.initialize();

    const timestamp = generateRotationTimestamp();
    const rotatedPath = join(
      this.auditDir,
      `events-${timestamp}-${this.pid}.jsonl`
    );

    try {
      await rename(this.logPath, rotatedPath);
    } catch (error: unknown) {
      const isEnoent =
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT";
      if (!isEnoent) {
        throw error;
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an AuditWriter instance
 *
 * @param options - AuditWriter configuration options
 * @returns A new AuditWriter instance
 *
 * @example
 * const auditWriter = createAuditWriter({
 *   version: "1.0.0",
 *   auditDir: "/custom/audit/dir"
 * });
 */
export function createAuditWriter(
  options: AuditWriterOptions = {}
): AuditWriter {
  return new AuditWriter(options);
}
