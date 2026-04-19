/**
 * WAL (Write-Ahead Log) Core Implementation
 *
 * Append-only JSON lines log for crash recovery.
 * One file per scope at `{walDir}/{scope-id}.jsonl`.
 *
 * Lifecycle:
 * 1. Before an operation, `appendEntry()` logs it (confirmed: false)
 * 2. Execute the operation
 * 3. On success, `confirmEntry()` marks the operation confirmed
 * 4. On crash/restart, `getUnconfirmedEntries()` finds pending operations for replay
 */

import { mkdir, readFile, rename, unlink, readdir, lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { createComponentLogger } from "@centient/logger";

import type {
  WALEntry,
  WALEntryInput,
  WALAppendOptions,
  WALAppendResult,
  WALConfirmResult,
  WALReadResult,
  WALValidationResult,
  WALCompactResult,
} from "./types.js";

const logger = createComponentLogger("engram", "wal");

// ---------------------------------------------------------------------------
// Per-Path Mutex (Promise-Chain Serialization)
// ---------------------------------------------------------------------------

/**
 * Per-WAL-path promise-chain mutex.
 *
 * Serializes `confirmEntry` and `compactWal` on the same file path to prevent
 * TOCTOU races from read-modify-write cycles. Different file paths run in
 * parallel. `appendEntry` uses an O_APPEND handle with fsync and does not
 * need the mutex.
 */
const walMutex = new Map<string, Promise<void>>();

async function withWalMutex<T>(walPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = walMutex.get(walPath) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  // Register our slot before awaiting so subsequent callers chain onto next, not prev
  walMutex.set(walPath, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve();
    // Only delete if no subsequent waiter has replaced our slot
    if (walMutex.get(walPath) === next) {
      walMutex.delete(walPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Atomic File Writes (Crash Safety)
// ---------------------------------------------------------------------------

/**
 * Write content to a file atomically via temp-file-then-rename.
 *
 * `rename()` is atomic on the same filesystem, so a crash mid-write leaves
 * the original file intact rather than truncating it. We also `fsync()` the
 * temp file before rename so the data is durably on disk before the rename
 * commits — without this, an OS crash after rename can leave the target
 * pointing at an inode whose data pages never flushed.
 *
 * **Requirement:** `filePath` must be on the same filesystem mount.
 * `rename()` fails with EXDEV across mount boundaries.
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(content, "utf-8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, filePath);
  } catch (err) {
    try { await unlink(tmpPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Scope ID Validation
// ---------------------------------------------------------------------------

/**
 * Pattern matching valid scope IDs (UUID hex characters and hyphens only).
 * Prevents path traversal by rejecting `../`, slashes, and other special chars.
 */
const SCOPE_ID_PATTERN = /^[0-9a-f-]+$/i;

/**
 * Validate that a scope ID is safe for use in filesystem paths.
 *
 * Rejects IDs containing path traversal sequences (`../`), slashes, or any
 * characters outside the hex+hyphen set expected for UUIDs.
 *
 * @param scopeId - The scope ID to validate
 * @returns Validation result with structured error on failure
 */
export function validateScopeId(scopeId: string): WALValidationResult {
  if (!scopeId || scopeId.length === 0) {
    return {
      success: false,
      error: "Scope ID must not be empty",
    };
  }

  if (!SCOPE_ID_PATTERN.test(scopeId)) {
    return {
      success: false,
      error: `Invalid scope ID: must match ${SCOPE_ID_PATTERN} (hex characters and hyphens only)`,
    };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Path Helper
// ---------------------------------------------------------------------------

/**
 * Build the WAL file path for a scope.
 *
 * @param walDir - Directory for WAL files
 * @param scopeId - Scope identifier used as the filename
 * @returns Full path to the WAL JSONL file
 */
export function getWalPath(walDir: string, scopeId: string): string {
  return join(walDir, `${scopeId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a new entry to the WAL.
 *
 * Generates a UUID v4 operationId and ISO 8601 timestamp automatically.
 * The entry is written as a single JSON line followed by a newline.
 * Creates the WAL directory if it does not exist.
 *
 * @param walPath - Full path to the WAL file
 * @param input - Entry fields (operationId, timestamp, confirmed are auto-generated)
 * @param options - Optional settings (autoConfirm writes the entry as confirmed)
 * @returns Result with the generated operationId
 */
export async function appendEntry(
  walPath: string,
  input: WALEntryInput,
  options?: WALAppendOptions,
): Promise<WALAppendResult> {
  const operationId = randomUUID();
  const autoConfirmed = options?.autoConfirm === true;

  try {
    await mkdir(dirname(walPath), { recursive: true });

    const entry: WALEntry = {
      ...input,
      operationId,
      timestamp: new Date().toISOString(),
      confirmed: autoConfirmed,
    };

    const line = JSON.stringify(entry) + "\n";
    // Append with explicit fsync: the WAL's whole purpose is crash recovery,
    // so a successful return must mean the bytes are durably on disk. The
    // default appendFile buffers through the page cache; an immediate crash
    // would lose the entry despite success: true.
    const fh = await open(walPath, "a");
    try {
      await fh.writeFile(line, "utf-8");
      await fh.sync();
    } finally {
      await fh.close();
    }

    return { success: true, operationId, autoConfirmed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ walPath, operationId, error: message }, "WAL append failed");
    return { success: false, operationId, autoConfirmed: false, error: `WAL append failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read all entries from a WAL file.
 *
 * Parses each non-blank line as a JSON WALEntry. Returns an empty array
 * if the file does not exist (this is not an error — a missing WAL means
 * no operations have been logged yet).
 *
 * @param walPath - Full path to the WAL file
 * @returns Result with parsed entries
 */
export async function readEntries(walPath: string): Promise<WALReadResult> {
  try {
    let content: string;
    try {
      content = await readFile(walPath, "utf-8");
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return { success: true, entries: [] };
      }
      throw err;
    }

    const lines = content.split("\n");
    const entries: WALEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (parseErr: unknown) {
        const parseMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
        logger.warn({ line: i + 1, error: parseMessage }, "WAL: skipping malformed JSON line");
        continue;
      }

      if (!isWALEntry(parsed)) {
        logger.warn(
          { line: i + 1, keys: Object.keys(parsed as Record<string, unknown>) },
          "WAL: skipping entry missing required fields (operationId, type, confirmed)",
        );
        continue;
      }

      entries.push(parsed);
    }

    return { success: true, entries };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ walPath, error: message }, "WAL read failed");
    return { success: false, entries: [], error: `WAL read failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/**
 * Mark a WAL entry as confirmed.
 *
 * Reads all entries, sets `confirmed: true` for the matching operationId,
 * and rewrites the entire file atomically (temp-file-then-rename).
 * Serialized per-path via an in-process mutex to prevent TOCTOU races.
 *
 * @param walPath - Full path to the WAL file
 * @param operationId - The operationId to confirm
 * @returns Result indicating success or error
 */
export async function confirmEntry(
  walPath: string,
  operationId: string,
): Promise<WALConfirmResult> {
  return withWalMutex(walPath, async () => {
    try {
      const readResult = await readEntries(walPath);
      if (!readResult.success) {
        return { success: false, error: readResult.error };
      }

      let found = false;
      const updated = readResult.entries.map((entry) => {
        if (entry.operationId === operationId) {
          found = true;
          return { ...entry, confirmed: true };
        }
        return entry;
      });

      if (!found) {
        return {
          success: false,
          error: `WAL entry not found: operationId "${operationId}"`,
        };
      }

      const content = updated.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      await atomicWriteFile(walPath, content);

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ walPath, operationId, error: message }, "WAL confirm failed");
      return { success: false, error: `WAL confirm failed: ${message}` };
    }
  });
}

// ---------------------------------------------------------------------------
// Unconfirmed
// ---------------------------------------------------------------------------

/**
 * Get all unconfirmed WAL entries (entries pending confirmation).
 *
 * Convenience wrapper around `readEntries()` that filters to only entries
 * where `confirmed === false`.
 *
 * @param walPath - Full path to the WAL file
 * @returns Result with unconfirmed entries only
 */
export async function getUnconfirmedEntries(
  walPath: string,
): Promise<WALReadResult> {
  const result = await readEntries(walPath);
  if (!result.success) {
    return result;
  }

  return {
    success: true,
    entries: result.entries.filter((entry) => !entry.confirmed),
  };
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Compact a WAL file by removing all confirmed entries.
 *
 * Reads the WAL, filters out entries where `confirmed === true`, and rewrites
 * the file atomically with only the unconfirmed entries. Serialized per-path
 * via an in-process mutex to prevent TOCTOU races.
 *
 * Safe to call periodically (e.g., after a successful replay pass). If the WAL
 * file does not exist, returns success with zero counts.
 *
 * @param walPath - Full path to the WAL file
 * @returns Result with counts of removed and remaining entries
 */
export async function compactWal(walPath: string): Promise<WALCompactResult> {
  return withWalMutex(walPath, async () => {
    try {
      const readResult = await readEntries(walPath);
      if (!readResult.success) {
        return { success: false, removed: 0, remaining: 0, error: readResult.error };
      }

      const allEntries = readResult.entries;
      const remaining = allEntries.filter((entry) => !entry.confirmed);
      const removed = allEntries.length - remaining.length;

      if (removed === 0) {
        return { success: true, removed: 0, remaining: remaining.length };
      }

      const content =
        remaining.length > 0
          ? remaining.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
          : "";
      await atomicWriteFile(walPath, content);

      return { success: true, removed, remaining: remaining.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ walPath, error: message }, "WAL compact failed");
      return { success: false, removed: 0, remaining: 0, error: `WAL compact failed: ${message}` };
    }
  });
}

// ---------------------------------------------------------------------------
// Orphaned Temp File Cleanup
// ---------------------------------------------------------------------------

/**
 * Delete orphaned `.tmp` files left by crashed processes.
 *
 * Globs `*.jsonl.*.tmp` in `walDir` and removes them. Best-effort:
 * logs warnings on failure but does not throw.
 *
 * @param walDir - Directory containing WAL files
 */
export async function cleanupOrphanedTempFiles(walDir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(walDir);
  } catch {
    // Directory doesn't exist — nothing to clean
    return;
  }

  const tmpFiles = files.filter((f) => /\.jsonl\.[0-9a-f-]+\.tmp$/i.test(f));
  for (const tmpFile of tmpFiles) {
    try {
      const fullPath = join(walDir, tmpFile);
      const stat = await lstat(fullPath);
      if (!stat.isFile()) continue;
      await unlink(fullPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ file: tmpFile, error: message }, "Failed to clean up orphaned temp file");
    }
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Type guard for Node.js system errors (ENOENT, EACCES, etc.). */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Runtime type guard for WALEntry objects parsed from JSON.
 *
 * Checks the required structural fields (`operationId`, `type`, `confirmed`,
 * `scopeId`, `timestamp`) to catch malformed or corrupted entries before they
 * enter the system. This guard ensures the WAL's own invariants hold.
 */
export function isWALEntry(obj: unknown): obj is WALEntry {
  if (obj === null || typeof obj !== "object") {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate["operationId"] === "string" &&
    typeof candidate["type"] === "string" &&
    typeof candidate["confirmed"] === "boolean" &&
    typeof candidate["scopeId"] === "string" &&
    typeof candidate["timestamp"] === "string"
  );
}
