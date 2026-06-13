/**
 * Atomic Filesystem Primitives
 *
 * Crash-safe file write helpers extracted from the WAL's internal machinery
 * and promoted to a documented public API. Two operations:
 *
 * - {@link atomicWrite} — overwrite a whole file atomically via
 *   temp-file-then-`rename(2)`. A reader (or a crash) never observes a
 *   partially written target.
 * - {@link atomicAppendLine} — append a single line. Atomic for small
 *   payloads on POSIX; see the PIPE_BUF boundary documented below.
 *
 * ## The `fsync` option
 *
 * By default both helpers return once the bytes have been handed to the OS
 * page cache. That makes the write *visible* (and, for `atomicWrite`, the
 * rename gives crash-*consistency*: you see either the old file or the new
 * one, never a torn one) but it does NOT guarantee *durability* — an OS-level
 * crash or power loss immediately after the call can still lose the data
 * because the pages were never flushed to the physical device.
 *
 * Pass `{ fsync: true }` to upgrade to durability. When set:
 *
 * - `atomicWrite` `fsync(2)`s the temp file before the rename, then — after
 *   the rename — `fsync(2)`s the **parent directory** so the directory entry
 *   change (the rename itself) is durable. Without the directory fsync, a
 *   crash can leave the directory pointing at the old inode even though the
 *   file's data was flushed.
 * - `atomicAppendLine` `fsync(2)`s the file after the append.
 *
 * `fsync` costs a disk round-trip; leave it off for caches/scratch state and
 * turn it on for write-ahead logs and anything whose loss after a successful
 * return would be a correctness bug.
 *
 * ## PIPE_BUF / append atomicity boundary
 *
 * {@link atomicAppendLine} relies on `appendFile` issuing a single `write(2)`
 * to an `O_APPEND` file. POSIX guarantees such a write is atomic (no
 * interleaving with concurrent appenders, no torn line) **only** while the
 * payload is at most `PIPE_BUF` bytes. `PIPE_BUF` is 4096 bytes on Linux
 * (the POSIX floor is 512). The payload is the line **plus the appended
 * newline**, measured in UTF-8 bytes — multi-byte characters count for more
 * than one byte each.
 *
 * Above that boundary the kernel may split the write into multiple `write(2)`
 * calls, so a concurrent appender can interleave and a crash can leave a
 * truncated final line. For lines that may exceed ~4 KiB, or when you need a
 * durability guarantee across an arbitrary number of lines, accumulate the
 * content and use {@link atomicWrite} (read-modify-write) instead.
 *
 * ## Same-filesystem requirement
 *
 * {@link atomicWrite} renames the temp file over the target. `rename(2)` is
 * atomic only within a single filesystem; the temp file is always created as
 * a sibling of the target (same directory) so this holds. The temp file is
 * placed alongside the target precisely so the rename never crosses a mount
 * boundary (which would fail with `EXDEV`).
 *
 * ## Orphaned temp files
 *
 * If the process crashes between creating the temp file and the rename, a
 * `<target>.<uuid>.tmp` sibling is left behind. {@link atomicWrite} cleans up
 * its own temp file on any error it catches, but a hard crash (SIGKILL, power
 * loss) bypasses that. Callers that care should sweep `*.tmp` siblings on
 * startup; the WAL exposes `cleanupOrphanedTempFiles` for its own files.
 *
 * @module atomic-fs
 */

import { mkdir, rename, unlink, open } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Options shared by the atomic filesystem helpers. */
export interface AtomicWriteOptions {
  /**
   * When `true`, `fsync(2)` the written data before returning so a successful
   * return guarantees durability (survives an OS crash / power loss), not just
   * visibility. For {@link atomicWrite} this fsyncs the temp file before the
   * rename and the parent directory after it. Defaults to `false` (the bytes
   * reach the OS page cache but may not have been flushed to disk).
   */
  fsync?: boolean;
}

/**
 * Write `content` to `filePath` atomically via temp-file-then-`rename(2)`.
 *
 * Writes to a UUID-named `.tmp` sibling in the same directory, then renames it
 * over the target. Because `rename(2)` is atomic on a single filesystem, a
 * reader never observes a partial file and a crash mid-write leaves the
 * previous file intact rather than truncated. The parent directory is created
 * recursively if it does not exist. On any error the temp file is unlinked and
 * the original target (if any) is left untouched.
 *
 * Pass `{ fsync: true }` for durability: the temp file is fsynced before the
 * rename and the parent directory is fsynced after it (so the rename itself is
 * durable). See the {@link AtomicWriteOptions.fsync | fsync} option and the
 * module-level notes for the full durability / atomicity model.
 *
 * @param filePath - Destination file path. The temp file is a sibling, so the
 *   destination's directory must be on a single filesystem.
 * @param content - UTF-8 content to write.
 * @param options - Optional {@link AtomicWriteOptions} (e.g. `fsync`).
 */
export async function atomicWrite(
  filePath: string,
  content: string,
  options?: AtomicWriteOptions,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const doFsync = options?.fsync === true;

  try {
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(content, "utf-8");
      if (doFsync) {
        await fh.sync();
      }
    } finally {
      await fh.close();
    }

    await rename(tmpPath, filePath);

    if (doFsync) {
      // Flush the directory entry so the rename itself is durable. Without
      // this, a crash can leave the directory pointing at the old inode even
      // though the new file's data was already flushed.
      await fsyncDir(dir);
    }
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore cleanup failure — original target is untouched */
    }
    throw err;
  }
}

/**
 * Append a single line to `filePath` atomically.
 *
 * Appends `line` followed by a single `"\n"` using a single `write(2)` to an
 * `O_APPEND` handle. On POSIX this is atomic — no interleaving with concurrent
 * appenders, no torn line — **only** while the payload (the line plus the
 * newline, in UTF-8 bytes) is at most `PIPE_BUF` (4096 bytes on Linux). Above
 * that boundary the write may be split and the atomicity guarantee no longer
 * holds; use {@link atomicWrite} with accumulated content instead. The parent
 * directory is created recursively if it does not exist.
 *
 * Pass `{ fsync: true }` to `fsync(2)` the file after the append so a
 * successful return guarantees durability, not just visibility.
 *
 * @param filePath - Destination file path.
 * @param line - A single line of content. The trailing newline is added for
 *   you; do not include one (a `"\n"` inside `line` makes the append span
 *   multiple lines and is not what this helper guarantees).
 * @param options - Optional {@link AtomicWriteOptions} (e.g. `fsync`).
 */
export async function atomicAppendLine(
  filePath: string,
  line: string,
  options?: AtomicWriteOptions,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const doFsync = options?.fsync === true;
  const fh = await open(filePath, "a");
  try {
    await fh.writeFile(`${line}\n`, "utf-8");
    if (doFsync) {
      await fh.sync();
    }
  } finally {
    await fh.close();
  }
}

/**
 * `fsync(2)` a directory so a contained `rename(2)` is durable.
 *
 * Opening a directory for read and calling `fsync` flushes its entries on
 * POSIX. Some platforms (notably Windows) reject opening a directory as a file
 * or return `EISDIR`/`EACCES`/`EPERM`/`EINVAL` from `fsync` on a directory
 * handle — those are tolerated and swallowed, because the data flush already
 * happened and the directory durability is a best-effort upgrade there.
 */
async function fsyncDir(dirPath: string): Promise<void> {
  let dh;
  try {
    dh = await open(dirPath, "r");
  } catch {
    // Cannot open the directory as a handle (e.g. Windows) — skip the dir
    // fsync; the data fsync above already gave durability of the bytes.
    return;
  }
  try {
    await dh.sync();
  } catch (err) {
    if (!isToleratedDirSyncError(err)) {
      throw err;
    }
  } finally {
    await dh.close();
  }
}

/** Directory-fsync errors that are platform quirks rather than real failures. */
function isToleratedDirSyncError(err: unknown): boolean {
  if (!(err instanceof Error) || !("code" in err)) {
    return false;
  }
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EISDIR" || code === "EACCES" || code === "EPERM" || code === "EINVAL";
}
