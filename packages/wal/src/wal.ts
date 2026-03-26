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

import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { createComponentLogger } from "@engram/logger";

import type {
  WALEntry,
  WALEntryInput,
  WALAppendResult,
  WALConfirmResult,
  WALReadResult,
  WALValidationResult,
  WALCompactResult,
} from "./types.js";

const logger = createComponentLogger("engram", "wal");

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
 * @returns Result with the generated operationId
 */
export async function appendEntry(
  walPath: string,
  input: WALEntryInput,
): Promise<WALAppendResult> {
  const operationId = randomUUID();

  try {
    await mkdir(dirname(walPath), { recursive: true });

    const entry: WALEntry = {
      operationId,
      timestamp: new Date().toISOString(),
      confirmed: false,
      ...input,
    };

    const line = JSON.stringify(entry) + "\n";
    await appendFile(walPath, line, "utf-8");

    return { success: true, operationId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ operationId, error: message }, "WAL append failed");
    return { success: false, operationId, error: `WAL append failed: ${message}` };
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
 * and rewrites the entire file. This is acceptable since WAL files are < 100KB.
 *
 * **Known limitation:** Uses read-then-rewrite which has a TOCTOU vulnerability
 * under concurrent access. A future optimization could use append-only semantics
 * with a separate compaction step (see `compactWal`). For now, callers should
 * serialize confirmEntry calls per-file to avoid data races.
 *
 * @param walPath - Full path to the WAL file
 * @param operationId - The operationId to confirm
 * @returns Result indicating success or error
 */
export async function confirmEntry(
  walPath: string,
  operationId: string,
): Promise<WALConfirmResult> {
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
    await writeFile(walPath, content, "utf-8");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ operationId, error: message }, "WAL confirm failed");
    return { success: false, error: `WAL confirm failed: ${message}` };
  }
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
 * the file with only the unconfirmed entries. This reduces file size and speeds
 * up subsequent reads and replays.
 *
 * Safe to call periodically (e.g., after a successful replay pass). If the WAL
 * file does not exist, returns success with zero counts.
 *
 * @param walPath - Full path to the WAL file
 * @returns Result with counts of removed and remaining entries
 */
export async function compactWal(walPath: string): Promise<WALCompactResult> {
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
    await writeFile(walPath, content, "utf-8");

    return { success: true, removed, remaining: remaining.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, removed: 0, remaining: 0, error: `WAL compact failed: ${message}` };
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
 * Checks the three required structural fields (`operationId`, `type`, `confirmed`)
 * to catch malformed or corrupted entries before they enter the system.
 * Does not validate the full schema (e.g., `scopeId`, `stage`) — those are
 * checked at the caller boundary. This guard ensures the WAL's own invariants hold.
 */
export function isWALEntry(obj: unknown): obj is WALEntry {
  if (obj === null || typeof obj !== "object") {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate["operationId"] === "string" &&
    typeof candidate["type"] === "string" &&
    typeof candidate["confirmed"] === "boolean"
  );
}
