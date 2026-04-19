/**
 * File Transport
 *
 * Writes log entries to a file with buffering and size-based rotation.
 *
 * @module transports/FileTransport
 */

import {
  existsSync,
  mkdirSync,
  createWriteStream,
  type WriteStream,
} from "fs";
import { stat, rename, readdir, unlink } from "fs/promises";
import { dirname, join, basename } from "path";
import type { Transport, LogEntry, FileTransportOptions } from "../types.js";
import { formatJson, generateRotationTimestamp } from "../format.js";

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_FILES = 5;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_MAX_BUFFER_SIZE = 100;

/**
 * Transport that writes log entries to a file with buffering and rotation
 *
 * Features:
 * - Buffered async writes to avoid blocking the event loop
 * - Size-based rotation with configurable max size
 * - Configurable number of rotated files to keep
 * - Secure file permissions (0o600 for files, 0o700 for directories)
 */
export class FileTransport implements Transport {
  private filePath: string;
  private maxSize: number;
  private maxFiles: number;
  private flushIntervalMs: number;
  private maxBufferSize: number;

  private writeStream: WriteStream | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private rotating: Promise<void> | null = null;
  private pendingFlush: Promise<void> | null = null;
  private closed = false;

  constructor(options: FileTransportOptions) {
    this.filePath = options.filePath;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  }

  /**
   * Initialize the transport: ensure directory exists, create write stream.
   * Synchronous to ensure stream is ready immediately after first write.
   * Rotation check is async and runs in background to avoid blocking.
   */
  private ensureInitialized(): void {
    if (this.initialized || this.closed) return;

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Schedule async rotation check in the background (non-blocking)
    // The rotation will happen on the next periodic flush if needed
    this.scheduleRotationCheck();

    // Create write stream for async writes
    this.writeStream = createWriteStream(this.filePath, {
      flags: "a",
      mode: 0o600,
    });
    this.writeStream.on("error", (err) => {
      // Logger of last resort: write-stream failures (disk full, EACCES, etc.)
      // must not take down the process, but silently swallowing them means
      // operators have no signal that logs are being lost. Write directly to
      // stderr with a clear prefix so the failure is visible without depending
      // on the very transport that just failed.
      // eslint-disable-next-line no-console
      console.error(
        `[FileTransport] write error on ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Set up periodic flush (async to allow rotation checks)
    this.flushTimer = setInterval(() => {
      void this.flushAsync();
    }, this.flushIntervalMs);
    // Don't keep process alive just for logging
    this.flushTimer.unref();

    this.initialized = true;
  }

  /**
   * Schedule a rotation check to run asynchronously.
   * Uses a cached promise to prevent concurrent rotation operations.
   */
  private scheduleRotationCheck(): void {
    if (this.rotating) return;
    this.rotating = this.rotateIfNeeded().finally(() => {
      this.rotating = null;
    });
  }

  /**
   * Rotate log file if it exceeds size threshold
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      // Check if file exists using async stat (throws if not found)
      let stats;
      try {
        stats = await stat(this.filePath);
      } catch {
        // File doesn't exist, no rotation needed
        return;
      }

      if (stats.size < this.maxSize) return;

      // Generate rotation filename: <basename>-YYYY-MM-DD-HHMMSS-<pid>.jsonl
      const timestamp = generateRotationTimestamp();
      const base = basename(this.filePath, ".jsonl");
      const dir = dirname(this.filePath);
      const rotatedPath = join(dir, `${base}-${timestamp}-${process.pid}.jsonl`);

      // Close current stream before rotation
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      await rename(this.filePath, rotatedPath);

      // Cleanup old rotated files
      await this.cleanupOldFiles();
    } catch {
      // Ignore rotation errors - continue with current file
    }
  }

  /**
   * Delete old rotated files beyond maxFiles limit
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      const base = basename(this.filePath, ".jsonl");
      const files = await readdir(dir);

      // Find rotated files matching pattern
      const filteredFiles = files.filter(
        (f) =>
          // Path traversal prevention: reject filenames with path separators
          !f.includes("/") &&
          !f.includes("\\") &&
          f.startsWith(`${base}-`) &&
          f.endsWith(".jsonl") &&
          f !== basename(this.filePath)
      );

      // Get file stats asynchronously
      const rotatedFiles = await Promise.all(
        filteredFiles.map(async (f) => {
          const filePath = join(dir, f);
          const fileStat = await stat(filePath);
          return {
            name: f,
            path: filePath,
            mtime: fileStat.mtime.getTime(),
          };
        })
      );

      // Sort by modification time (newest first)
      rotatedFiles.sort((a, b) => b.mtime - a.mtime);

      // Delete files beyond maxFiles limit
      const filesToDelete = rotatedFiles.slice(this.maxFiles);
      await Promise.all(filesToDelete.map((file) => unlink(file.path)));
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Synchronously flush buffered entries to disk.
   * Only writes if the stream is ready (initialized).
   */
  private flushSync(): void {
    if (this.buffer.length === 0 || !this.writeStream || this.closed) return;

    const data = this.buffer.join("");
    this.buffer = [];
    this.writeStream.write(data);
  }

  /**
   * Async flush that handles rotation before writing.
   * Used by periodic flush timer and when buffer is full.
   * Ensures rotation happens before data is written to the file.
   */
  private async flushAsync(): Promise<void> {
    if (this.closed) return;

    // Wait for any pending rotation to complete
    if (this.rotating) {
      await this.rotating;
    }

    // Check if rotation is needed before flushing
    if (this.initialized) {
      await this.rotateIfNeeded();

      // Re-open stream if it was closed during rotation
      if (!this.writeStream && !this.closed) {
        this.writeStream = createWriteStream(this.filePath, {
          flags: "a",
          mode: 0o600,
        });
        this.writeStream.on("error", () => {
          // Silently fail if we can't write to log file
        });
      }
    }

    this.flushSync();
  }

  /**
   * Write a log entry to the buffer.
   * The entry is buffered immediately (non-blocking).
   * When buffer reaches maxBufferSize, an async flush is scheduled.
   */
  write(entry: LogEntry): void {
    if (this.closed) return;

    this.ensureInitialized();
    this.buffer.push(formatJson(entry) + "\n");

    // Schedule async flush if buffer is full (non-blocking)
    // Track the pending flush so close() can wait for it
    if (this.buffer.length >= this.maxBufferSize && !this.pendingFlush) {
      this.pendingFlush = this.flushAsync().finally(() => {
        this.pendingFlush = null;
      });
    }
  }

  /**
   * Flush all buffered entries to disk
   */
  async flush(): Promise<void> {
    if (this.closed) return;

    // Ensure initialization is complete before flushing
    this.ensureInitialized();

    // Wait for any pending rotation to complete
    if (this.rotating) {
      await this.rotating;
    }

    // Check if rotation is needed before flushing
    await this.rotateIfNeeded();

    // Re-open stream if it was closed during rotation
    if (!this.writeStream && !this.closed) {
      this.writeStream = createWriteStream(this.filePath, {
        flags: "a",
        mode: 0o600,
      });
      this.writeStream.on("error", () => {
        // Silently fail if we can't write to log file
      });
    }

    this.flushSync();

    // Wait for write stream to drain
    if (this.writeStream && !this.writeStream.writableEnded) {
      await new Promise<void>((resolve) => {
        if (this.writeStream) {
          this.writeStream.once("drain", resolve);
          // Resolve immediately if not backed up
          if (!this.writeStream.writableNeedDrain) {
            resolve();
          }
        } else {
          resolve();
        }
      });
    }
  }

  /**
   * Close the transport and release resources
   */
  async close(): Promise<void> {
    if (this.closed) return;

    // Wait for any pending rotation to complete before closing
    if (this.rotating) {
      await this.rotating;
    }

    // Wait for any pending flush to complete
    if (this.pendingFlush) {
      await this.pendingFlush;
    }

    this.closed = true;

    // Flush any remaining buffered entries
    this.flushSync();

    // Clear flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Close write stream
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        if (this.writeStream) {
          this.writeStream.end(() => resolve());
        } else {
          resolve();
        }
      });
      this.writeStream = null;
    }
  }
}
