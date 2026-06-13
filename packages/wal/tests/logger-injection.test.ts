/**
 * Logger Injection Tests (@centient/wal)
 *
 * Covers Initiative 6 — unify logger injection:
 *   - An injected capture logger receives WAL-internal warn-path messages
 *     (malformed-line skip on read; retry-pending warn on replay).
 *   - The replay logger is forwarded to the read/confirm calls it drives, so
 *     all WAL-internal logging during a replay routes to the same logger.
 *   - The default path (no logger injected) is unchanged: every entry point
 *     works identically to before injection existed.
 *
 * We eat our own testing utilities: the capture logger is `createTestLogger`
 * from @centient/logger, which is structurally a valid `WalLogger`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestLogger } from "@centient/logger";

import {
  appendEntry,
  readEntries,
  replayUnconfirmed,
  getWalPath,
  clearRetryCounts,
} from "../src/index.js";
import type { WalLogger, WALEntryInput } from "../src/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wal-logger-"));
  clearRetryCounts();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  clearRetryCounts();
});

const entryInput: WALEntryInput = {
  type: "test-op",
  scopeId: "abc-123",
  payload: { hello: "world" },
};

describe("wal logger injection", () => {
  it("routes the malformed-line read warning to an injected capture logger", async () => {
    const walPath = getWalPath(tmpDir, "abc-123");
    // One valid line and one malformed line: the read path warns on the bad one.
    const valid =
      JSON.stringify({
        operationId: "00000000-0000-0000-0000-000000000000",
        timestamp: new Date().toISOString(),
        type: "test-op",
        scopeId: "abc-123",
        payload: {},
        confirmed: false,
      }) + "\n";
    writeFileSync(walPath, valid + "{not json\n", "utf-8");

    const { logger, getEntries } = createTestLogger("wal-capture");
    const result = await readEntries(walPath, logger);

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);

    const warnings = getEntries().filter((e) => e.level === "warn");
    expect(warnings.some((e) => e.message.includes("skipping malformed JSON line"))).toBe(true);
  });

  it("routes the replay retry-pending warning to an injected logger", async () => {
    const walPath = getWalPath(tmpDir, "abc-123");
    await appendEntry(walPath, entryInput);

    const { logger, getEntries } = createTestLogger("replay-capture");

    // Executor returns false → entry stays unconfirmed and replay warns
    // "will retry" before the dead-letter cap is reached.
    const result = await replayUnconfirmed(walPath, async () => false, {
      maxRetries: 5,
      logger,
    });

    expect(result.failedCount).toBe(1);

    const warnings = getEntries().filter((e) => e.level === "warn");
    expect(warnings.some((e) => e.message.includes("WAL entry replay failed, will retry"))).toBe(true);
  });

  it("accepts any structural WalLogger (not just @centient/logger)", async () => {
    const walPath = getWalPath(tmpDir, "abc-123");
    await appendEntry(walPath, entryInput);

    const warnMessages: string[] = [];
    const captured: WalLogger = {
      debug: () => {},
      info: () => {},
      warn: (a: unknown, b?: unknown) => {
        warnMessages.push(typeof b === "string" ? b : (a as string));
      },
      error: () => {},
    };

    await replayUnconfirmed(walPath, async () => false, { maxRetries: 5, logger: captured });

    expect(warnMessages.some((m) => m.includes("will retry"))).toBe(true);
  });

  describe("default path (no logger injected) — behavior unchanged", () => {
    it("append → read round-trips identically with no logger passed", async () => {
      const walPath = getWalPath(tmpDir, "abc-123");

      const appendResult = await appendEntry(walPath, entryInput);
      expect(appendResult.success).toBe(true);

      const readResult = await readEntries(walPath);
      expect(readResult.success).toBe(true);
      expect(readResult.entries).toHaveLength(1);
      expect(readResult.entries[0]?.operationId).toBe(appendResult.operationId);
      expect(readResult.entries[0]?.confirmed).toBe(false);
    });

    it("replay confirms a successful entry with no logger passed", async () => {
      const walPath = getWalPath(tmpDir, "abc-123");
      await appendEntry(walPath, entryInput);

      const result = await replayUnconfirmed(walPath, async () => true);
      expect(result.replayedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      const after = await readEntries(walPath);
      expect(after.entries[0]?.confirmed).toBe(true);
    });
  });
});
