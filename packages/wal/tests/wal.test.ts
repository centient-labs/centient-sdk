/**
 * WAL Tests — Core Operations + v0.3.0 Improvements
 *
 * Covers: append, confirm, compact, read, replay, plus:
 *   - Per-path mutex serialization
 *   - Atomic file writes (crash safety)
 *   - Dead-letter support (retry cap)
 *   - Auto-confirm at append time
 *   - Orphaned temp file cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendEntry,
  readEntries,
  confirmEntry,
  getUnconfirmedEntries,
  compactWal,
  getWalPath,
  validateScopeId,
  isWALEntry,
  replayUnconfirmed,
  replayAndCompact,
  cleanupOrphanedTempFiles,
  clearRetryCounts,
} from "../src/index.js";

import type {
  WALEntryInput,
  DeadLetterPayload,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let walPath: string;

function makeInput(overrides: Partial<WALEntryInput> = {}): WALEntryInput {
  return {
    type: "test_op",
    scopeId: "aaa-bbb-ccc",
    payload: { key: "value" },
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wal-test-"));
  walPath = join(tmpDir, "test.jsonl");
  clearRetryCounts();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// ============================================================================
// Core Operations (existing behavior, regression coverage)
// ============================================================================

describe("appendEntry", () => {
  it("creates the WAL file and appends an entry", async () => {
    const result = await appendEntry(walPath, makeInput());
    expect(result.success).toBe(true);
    expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.autoConfirmed).toBe(false);
    expect(existsSync(walPath)).toBe(true);
  });

  it("appends multiple entries", async () => {
    await appendEntry(walPath, makeInput({ type: "op_1" }));
    await appendEntry(walPath, makeInput({ type: "op_2" }));
    const read = await readEntries(walPath);
    expect(read.entries).toHaveLength(2);
    expect(read.entries[0]!.type).toBe("op_1");
    expect(read.entries[1]!.type).toBe("op_2");
  });

  it("auto-generated fields cannot be overridden by input spread", async () => {
    // Even if a caller manages to sneak extra fields through at runtime,
    // auto-generated fields must always win (spread order security)
    const input = makeInput() as Record<string, unknown>;
    input["operationId"] = "attacker-controlled-id";
    input["confirmed"] = true;
    const result = await appendEntry(walPath, input as WALEntryInput);

    expect(result.operationId).not.toBe("attacker-controlled-id");
    const read = await readEntries(walPath);
    expect(read.entries[0]!.confirmed).toBe(false);
    expect(read.entries[0]!.operationId).not.toBe("attacker-controlled-id");
  });
});

describe("readEntries", () => {
  it("returns empty array for missing file", async () => {
    const result = await readEntries(walPath);
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it("skips malformed JSON lines", async () => {
    writeFileSync(walPath, '{"operationId":"a","type":"t","confirmed":false,"scopeId":"x","timestamp":"2025-01-01T00:00:00Z"}\nnot json\n');
    const result = await readEntries(walPath);
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("skips valid JSON that fails isWALEntry (missing required fields)", async () => {
    // Valid JSON but missing operationId — should be skipped
    const validEntry = '{"operationId":"a","type":"t","confirmed":false,"scopeId":"x","timestamp":"2025-01-01T00:00:00Z"}';
    const missingOpId = '{"type":"t","confirmed":false,"scopeId":"x","timestamp":"2025-01-01T00:00:00Z"}';
    writeFileSync(walPath, `${validEntry}\n${missingOpId}\n`);

    const result = await readEntries(walPath);
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
  });
});

describe("confirmEntry", () => {
  it("marks an entry as confirmed", async () => {
    const { operationId } = await appendEntry(walPath, makeInput());
    const result = await confirmEntry(walPath, operationId);
    expect(result.success).toBe(true);

    const read = await readEntries(walPath);
    expect(read.entries[0]!.confirmed).toBe(true);
  });

  it("returns error for unknown operationId", async () => {
    await appendEntry(walPath, makeInput());
    const result = await confirmEntry(walPath, "no-such-id");
    expect(result.success).toBe(false);
    expect(result.error).toContain("no-such-id");
  });

  it("is idempotent — confirming an already-confirmed entry succeeds", async () => {
    const { operationId } = await appendEntry(walPath, makeInput());
    const first = await confirmEntry(walPath, operationId);
    const second = await confirmEntry(walPath, operationId);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const read = await readEntries(walPath);
    expect(read.entries[0]!.confirmed).toBe(true);
  });
});

describe("getUnconfirmedEntries", () => {
  it("filters to unconfirmed only", async () => {
    const { operationId } = await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));
    await confirmEntry(walPath, operationId);

    const result = await getUnconfirmedEntries(walPath);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.type).toBe("b");
  });
});

describe("compactWal", () => {
  it("removes confirmed entries", async () => {
    const { operationId } = await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));
    await confirmEntry(walPath, operationId);

    const result = await compactWal(walPath);
    expect(result.success).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);

    const read = await readEntries(walPath);
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]!.type).toBe("b");
  });

  it("returns zero counts for missing file", async () => {
    const result = await compactWal(walPath);
    expect(result.success).toBe(true);
    expect(result.removed).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it("compacts to empty file when all entries are confirmed", async () => {
    const r1 = await appendEntry(walPath, makeInput({ type: "a" }));
    const r2 = await appendEntry(walPath, makeInput({ type: "b" }));
    await confirmEntry(walPath, r1.operationId);
    await confirmEntry(walPath, r2.operationId);

    const result = await compactWal(walPath);
    expect(result.removed).toBe(2);
    expect(result.remaining).toBe(0);

    const read = await readEntries(walPath);
    expect(read.success).toBe(true);
    expect(read.entries).toHaveLength(0);
  });
});

describe("validateScopeId", () => {
  it("accepts valid hex-and-hyphen IDs", () => {
    expect(validateScopeId("aaa-bbb-ccc").success).toBe(true);
    expect(validateScopeId("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validateScopeId("../etc/passwd").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateScopeId("").success).toBe(false);
  });

  it("rejects spaces and slashes", () => {
    expect(validateScopeId("abc def").success).toBe(false);
    expect(validateScopeId("abc/def").success).toBe(false);
  });

  it("accepts hyphen-only IDs (valid per pattern)", () => {
    expect(validateScopeId("---").success).toBe(true);
  });
});

describe("getWalPath", () => {
  it("builds path with .jsonl extension", () => {
    expect(getWalPath("/tmp/wal", "abc-123")).toBe("/tmp/wal/abc-123.jsonl");
  });

  it("preserves case in scopeId", () => {
    expect(getWalPath("/tmp/wal", "AABB-CC")).toBe("/tmp/wal/AABB-CC.jsonl");
  });
});

describe("isWALEntry", () => {
  it("accepts valid entries with all required fields", () => {
    expect(isWALEntry({
      operationId: "x", type: "t", confirmed: false,
      scopeId: "s", timestamp: "2025-01-01T00:00:00Z",
    })).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isWALEntry(null)).toBe(false);
    expect(isWALEntry("string")).toBe(false);
  });

  it("rejects missing confirmed field", () => {
    expect(isWALEntry({ operationId: "x", type: "t", scopeId: "s", timestamp: "t" })).toBe(false);
  });

  it("rejects missing scopeId field", () => {
    expect(isWALEntry({ operationId: "x", type: "t", confirmed: false, timestamp: "t" })).toBe(false);
  });

  it("rejects missing timestamp field", () => {
    expect(isWALEntry({ operationId: "x", type: "t", confirmed: false, scopeId: "s" })).toBe(false);
  });
});

// ============================================================================
// Improvement 1: Per-Path Mutex Serialization
// ============================================================================

describe("mutex serialization", () => {
  it("concurrent confirmEntry calls on same file: both succeed, no lost updates", async () => {
    const r1 = await appendEntry(walPath, makeInput({ type: "a" }));
    const r2 = await appendEntry(walPath, makeInput({ type: "b" }));

    const [c1, c2] = await Promise.all([
      confirmEntry(walPath, r1.operationId),
      confirmEntry(walPath, r2.operationId),
    ]);

    expect(c1.success).toBe(true);
    expect(c2.success).toBe(true);

    const read = await readEntries(walPath);
    const confirmed = read.entries.filter((e) => e.confirmed);
    expect(confirmed).toHaveLength(2);
  });

  it("concurrent confirmEntry + compactWal: both succeed", async () => {
    const r1 = await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));
    await confirmEntry(walPath, r1.operationId);

    const r3 = await appendEntry(walPath, makeInput({ type: "c" }));

    const [confirmRes, compactRes] = await Promise.all([
      confirmEntry(walPath, r3.operationId),
      compactWal(walPath),
    ]);

    expect(confirmRes.success).toBe(true);
    expect(compactRes.success).toBe(true);
  });

  it("operations on different files execute in parallel", async () => {
    const path1 = join(tmpDir, "wal1.jsonl");
    const path2 = join(tmpDir, "wal2.jsonl");

    const r1 = await appendEntry(path1, makeInput({ type: "a" }));
    const r2 = await appendEntry(path2, makeInput({ type: "b" }));

    const [c1, c2] = await Promise.all([
      confirmEntry(path1, r1.operationId),
      confirmEntry(path2, r2.operationId),
    ]);

    expect(c1.success).toBe(true);
    expect(c2.success).toBe(true);
  });

  it("stress test: 20 concurrent confirmEntry calls all succeed", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await appendEntry(walPath, makeInput({ type: `op_${i}` }));
      ids.push(r.operationId);
    }

    const results = await Promise.all(
      ids.map((id) => confirmEntry(walPath, id)),
    );

    expect(results.every((r) => r.success)).toBe(true);

    const read = await readEntries(walPath);
    expect(read.entries.filter((e) => e.confirmed)).toHaveLength(20);
  }, 10000);
});

// ============================================================================
// Improvement 2: Atomic File Writes (Crash Safety)
// ============================================================================

describe("atomic file writes", () => {
  it("confirmEntry uses temp file (no orphaned .tmp after success)", async () => {
    const { operationId } = await appendEntry(walPath, makeInput());
    await confirmEntry(walPath, operationId);

    const files = readdirSync(tmpDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("compactWal uses temp file (no orphaned .tmp after success)", async () => {
    const { operationId } = await appendEntry(walPath, makeInput());
    await confirmEntry(walPath, operationId);
    await compactWal(walPath);

    const files = readdirSync(tmpDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("file content is valid after confirmEntry (not truncated)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await appendEntry(walPath, makeInput({ type: `op_${i}` }));
      ids.push(r.operationId);
    }

    await confirmEntry(walPath, ids[5]!);

    const read = await readEntries(walPath);
    expect(read.success).toBe(true);
    expect(read.entries).toHaveLength(10);
    expect(read.entries[5]!.confirmed).toBe(true);
  });
});

// ============================================================================
// Improvement 2b: Orphaned Temp File Cleanup
// ============================================================================

describe("cleanupOrphanedTempFiles", () => {
  it("removes .tmp files matching WAL pattern", async () => {
    writeFileSync(join(tmpDir, "abc.jsonl.550e8400-e29b-41d4.tmp"), "data");
    writeFileSync(join(tmpDir, "def.jsonl.aaaa-bbbb.tmp"), "data");
    writeFileSync(join(tmpDir, "normal.jsonl"), "data");

    await cleanupOrphanedTempFiles(tmpDir);

    const files = readdirSync(tmpDir);
    expect(files).not.toContain("abc.jsonl.550e8400-e29b-41d4.tmp");
    expect(files).not.toContain("def.jsonl.aaaa-bbbb.tmp");
    expect(files).toContain("normal.jsonl");
  });

  it("handles missing directory silently", async () => {
    await cleanupOrphanedTempFiles(join(tmpDir, "nonexistent"));
  });

  it("skips non-regular files (symlink protection)", async () => {
    mkdirSync(join(tmpDir, "subdir.jsonl.aaa-bbb.tmp"));
    await expect(cleanupOrphanedTempFiles(tmpDir)).resolves.not.toThrow();
    // The directory should still exist (was not unlinked)
    expect(existsSync(join(tmpDir, "subdir.jsonl.aaa-bbb.tmp"))).toBe(true);
  });

  it("does nothing when no .tmp files exist", async () => {
    writeFileSync(join(tmpDir, "normal.jsonl"), "data");
    await cleanupOrphanedTempFiles(tmpDir);
    expect(readdirSync(tmpDir)).toContain("normal.jsonl");
  });
});

// ============================================================================
// Improvement 3: Dead-Letter Support (Retry Cap)
// ============================================================================

describe("dead-letter support", () => {
  it("dead-letters an entry after maxRetries failures", async () => {
    const { operationId: origId } = await appendEntry(walPath, makeInput({ type: "flaky_op" }));

    const failingExecutor = async () => false;

    for (let i = 0; i < 4; i++) {
      const result = await replayUnconfirmed(walPath, failingExecutor);
      expect(result.failedCount).toBe(1);
      expect(result.deadLetteredCount).toBe(0);
    }

    // 5th attempt triggers dead-letter
    const result = await replayUnconfirmed(walPath, failingExecutor);
    expect(result.deadLetteredCount).toBe(1);
    expect(result.failedCount).toBe(0);

    // Verify dead-letter entry was written
    const read = await readEntries(walPath);
    const deadLetters = read.entries.filter((e) => e.type === "dead_letter");
    expect(deadLetters).toHaveLength(1);

    const dlPayload = deadLetters[0]!.payload as DeadLetterPayload;
    expect(dlPayload.originalOperationId).toBe(origId);
    expect(dlPayload.originalType).toBe("flaky_op");
    expect(dlPayload.failureCount).toBe(5);
    expect(dlPayload.lastError).toBe("Executor returned false");
    expect(dlPayload.deadLetteredAt).toBeTruthy();
  });

  it("dead-letter entry has confirmed: true", async () => {
    await appendEntry(walPath, makeInput({ type: "bad_op" }));

    const failingExecutor = async () => false;

    for (let i = 0; i < 5; i++) {
      await replayUnconfirmed(walPath, failingExecutor);
    }

    const read = await readEntries(walPath);
    const deadLetters = read.entries.filter((e) => e.type === "dead_letter");
    expect(deadLetters[0]!.confirmed).toBe(true);
  });

  it("dead-letter result has deadLettered: true and success: false", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    const failingExecutor = async () => false;
    const result = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 1 });

    expect(result.deadLetteredCount).toBe(1);
    const entryResult = result.results[0]!;
    expect(entryResult.deadLettered).toBe(true);
    expect(entryResult.success).toBe(false);
    expect(entryResult.error).toContain("Dead-lettered");
  });

  it("propagates stage and phase from original entry to dead-letter", async () => {
    await appendEntry(walPath, makeInput({ type: "staged_op", stage: "build", phase: 2 }));

    const failingExecutor = async () => false;
    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 1 });

    const read = await readEntries(walPath);
    const dl = read.entries.find((e) => e.type === "dead_letter")!;
    expect(dl.stage).toBe("build");
    expect(dl.phase).toBe(2);
  });

  it("respects custom maxRetries option", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    const failingExecutor = async () => false;

    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 2 });
    const r2 = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 2 });
    expect(r2.deadLetteredCount).toBe(1);
  });

  it("retry count persists across multiple replayUnconfirmed calls", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    const r3 = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });

    expect(r3.deadLetteredCount).toBe(1);
  });

  it("clearRetryCounts resets state", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });

    clearRetryCounts();

    const result = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    expect(result.deadLetteredCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it("WAL_MAX_RETRIES env var is respected", async () => {
    vi.stubEnv("WAL_MAX_RETRIES", "2");

    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    await replayUnconfirmed(walPath, failingExecutor);
    const r2 = await replayUnconfirmed(walPath, failingExecutor);
    expect(r2.deadLetteredCount).toBe(1);
  });

  it("options.maxRetries takes precedence over WAL_MAX_RETRIES", async () => {
    vi.stubEnv("WAL_MAX_RETRIES", "1");

    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    const r2 = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 3 });
    expect(r2.deadLetteredCount).toBe(0);
    expect(r2.failedCount).toBe(1);
  });

  it("WAL_MAX_RETRIES non-numeric falls back to default (5)", async () => {
    vi.stubEnv("WAL_MAX_RETRIES", "abc");

    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    // Should use default of 5
    for (let i = 0; i < 4; i++) {
      const r = await replayUnconfirmed(walPath, failingExecutor);
      expect(r.deadLetteredCount).toBe(0);
    }
    const r5 = await replayUnconfirmed(walPath, failingExecutor);
    expect(r5.deadLetteredCount).toBe(1);
  });

  it("WAL_MAX_RETRIES=0 clamps to 1", async () => {
    vi.stubEnv("WAL_MAX_RETRIES", "0");

    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    const r1 = await replayUnconfirmed(walPath, failingExecutor);
    expect(r1.deadLetteredCount).toBe(1);
  });

  it("successful replay clears retry count for that entry", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    let callCount = 0;
    const sometimesFailingExecutor = async () => {
      callCount++;
      return callCount >= 3;
    };

    await replayUnconfirmed(walPath, sometimesFailingExecutor, { maxRetries: 5 });
    await replayUnconfirmed(walPath, sometimesFailingExecutor, { maxRetries: 5 });
    const r3 = await replayUnconfirmed(walPath, sometimesFailingExecutor, { maxRetries: 5 });

    expect(r3.replayedCount).toBe(1);
    expect(r3.deadLetteredCount).toBe(0);
  });

  it("captures executor exception as lastError", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    const throwingExecutor = async () => { throw new Error("kaboom"); };

    for (let i = 0; i < 5; i++) {
      await replayUnconfirmed(walPath, throwingExecutor);
    }

    const read = await readEntries(walPath);
    const dl = read.entries.find((e) => e.type === "dead_letter");
    const payload = dl!.payload as DeadLetterPayload;
    expect(payload.lastError).toContain("kaboom");
  });

  it("maxRetries clamped: 0 becomes 1 (lower bound)", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    const r1 = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: 0 });
    expect(r1.deadLetteredCount).toBe(1);
  });

  it("maxRetries clamped: negative becomes 1", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));
    const failingExecutor = async () => false;

    const r1 = await replayUnconfirmed(walPath, failingExecutor, { maxRetries: -5 });
    expect(r1.deadLetteredCount).toBe(1);
  });
});

// ============================================================================
// Improvement 4: Auto-Confirm at Append Time
// ============================================================================

describe("auto-confirm", () => {
  it("appendEntry with autoConfirm writes entry as confirmed", async () => {
    const result = await appendEntry(walPath, makeInput(), { autoConfirm: true });
    expect(result.success).toBe(true);
    expect(result.autoConfirmed).toBe(true);

    const read = await readEntries(walPath);
    expect(read.entries[0]!.confirmed).toBe(true);
  });

  it("appendEntry without autoConfirm writes entry as unconfirmed (default)", async () => {
    const result = await appendEntry(walPath, makeInput());
    expect(result.autoConfirmed).toBe(false);

    const read = await readEntries(walPath);
    expect(read.entries[0]!.confirmed).toBe(false);
  });

  it("auto-confirmed entries are not returned by getUnconfirmedEntries", async () => {
    await appendEntry(walPath, makeInput({ type: "auto" }), { autoConfirm: true });
    await appendEntry(walPath, makeInput({ type: "manual" }));

    const unconfirmed = await getUnconfirmedEntries(walPath);
    expect(unconfirmed.entries).toHaveLength(1);
    expect(unconfirmed.entries[0]!.type).toBe("manual");
  });

  it("auto-confirmed entries are removed by compactWal", async () => {
    await appendEntry(walPath, makeInput({ type: "auto" }), { autoConfirm: true });
    await appendEntry(walPath, makeInput({ type: "pending" }));

    const result = await compactWal(walPath);
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);

    const read = await readEntries(walPath);
    expect(read.entries[0]!.type).toBe("pending");
  });
});

// ============================================================================
// Replay (basic + replayAndCompact with options)
// ============================================================================

describe("replayUnconfirmed", () => {
  it("replays unconfirmed entries and confirms them", async () => {
    await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));

    const result = await replayUnconfirmed(walPath, async () => true);
    expect(result.success).toBe(true);
    expect(result.replayedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.deadLetteredCount).toBe(0);

    const unconfirmed = await getUnconfirmedEntries(walPath);
    expect(unconfirmed.entries).toHaveLength(0);
  });

  it("returns empty result for missing WAL file", async () => {
    const result = await replayUnconfirmed(walPath, async () => true);
    expect(result.success).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  it("returns success: false when any entry fails", async () => {
    await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));

    let count = 0;
    const result = await replayUnconfirmed(walPath, async () => {
      count++;
      return count === 1; // first succeeds, second fails
    });

    expect(result.success).toBe(false);
    expect(result.replayedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  it("handles WAL read failure gracefully", async () => {
    // Create a file then make it unreadable
    await appendEntry(walPath, makeInput());
    chmodSync(walPath, 0o000);

    const result = await replayUnconfirmed(walPath, async () => true);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.totalEntries).toBe(0);

    // Restore permissions for cleanup
    chmodSync(walPath, 0o644);
  });
});

describe("replayAndCompact", () => {
  it("replays and compacts in one call", async () => {
    await appendEntry(walPath, makeInput({ type: "a" }));
    await appendEntry(walPath, makeInput({ type: "b" }));

    const result = await replayAndCompact(walPath, async () => true);
    expect(result.replay.replayedCount).toBe(2);
    expect(result.compact.removed).toBe(2);
    expect(result.compact.remaining).toBe(0);
  });

  it("passes options through to replay", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    const failingExecutor = async () => false;

    const result = await replayAndCompact(walPath, failingExecutor, { maxRetries: 1 });
    expect(result.replay.deadLetteredCount).toBe(1);

    const read = await readEntries(walPath);
    const unconfirmed = read.entries.filter((e) => !e.confirmed);
    expect(unconfirmed).toHaveLength(0);
  });

  it("retains failing entry when maxRetries not yet reached", async () => {
    await appendEntry(walPath, makeInput({ type: "op" }));

    const failingExecutor = async () => false;
    const result = await replayAndCompact(walPath, failingExecutor, { maxRetries: 5 });

    expect(result.replay.failedCount).toBe(1);
    expect(result.compact.remaining).toBe(1);
  });

  it("skips compaction when replay cannot read WAL", async () => {
    await appendEntry(walPath, makeInput());
    chmodSync(walPath, 0o000);

    const result = await replayAndCompact(walPath, async () => true);
    expect(result.replay.success).toBe(false);
    expect(result.compact.success).toBe(false);
    expect(result.compact.error).toContain("Skipped");

    chmodSync(walPath, 0o644);
  });
});
