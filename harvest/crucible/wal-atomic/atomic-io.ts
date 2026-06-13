/**
 * Atomic I/O Utilities
 *
 * Provides crash-safe file write helpers using the write-to-tmp-then-rename
 * pattern. On POSIX systems, rename(2) is atomic — a reader never observes
 * a partial file.
 *
 * ## Functions
 *
 * - `atomicWrite(filePath, content)` — overwrite a file atomically.
 *   Writes to a UUID-named `.tmp` sibling, then renames over the target.
 *   Cleans up the `.tmp` file on any write/rename error.
 *
 * - `atomicAppendLine(filePath, line)` — append a single line atomically.
 *   Uses Node's `appendFile` which issues a single `write(2)` syscall for
 *   small payloads — atomic on Linux (POSIX write ≤ PIPE_BUF = 4 KiB).
 *   Ensures the parent directory exists before writing.
 *
 * ## Limitations
 *
 * `atomicAppendLine` is safe for single-line appends of ≤ 4 KiB on Linux.
 * For multi-line or large payloads, prefer `atomicWrite` with the full
 * accumulated content (read-then-write pattern).
 *
 * @module utils/atomic-io
 */

import { writeFile, rename, unlink, appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Write `content` to `filePath` atomically.
 *
 * Writes to a UUID-named `.tmp` sibling in the same directory, then renames
 * it over the target. If any step fails, the `.tmp` file is deleted and the
 * original (if any) is left untouched.
 *
 * Creates the parent directory recursively if it does not exist.
 *
 * @param filePath - Absolute or relative path to the destination file
 * @param content  - UTF-8 content to write
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Append a single JSON-serializable line to `filePath` atomically.
 *
 * Uses `fs.appendFile` which issues a single `write(2)` syscall — this is
 * atomic on Linux/POSIX for payloads ≤ PIPE_BUF (4 KiB). The parent
 * directory is created recursively if absent.
 *
 * For batched writes or payloads > 4 KiB, use `atomicWrite` instead.
 *
 * @param filePath - Absolute or relative path to the JSONL file
 * @param line     - A single line of content (newline is appended automatically)
 */
export async function atomicAppendLine(filePath: string, line: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, line + "\n", "utf8");
}
