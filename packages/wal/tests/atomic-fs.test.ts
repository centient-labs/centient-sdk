/**
 * Atomic FS Tests — public atomicWrite / atomicAppendLine primitives.
 *
 * Covers:
 *   - durability shape: write then read back (with and without fsync)
 *   - overwrite atomicity: target replaced wholesale, no partial content
 *   - tmp-file cleanup on write failure (ENOTDIR and, on POSIX, EACCES from a
 *     read-only directory — no orphaned *.tmp left behind in either case)
 *   - concurrent appends under PIPE_BUF: every line lands intact, no torn lines
 *   - lines exceeding PIPE_BUF round-trip intact when appended serially
 *   - trailing-newline contract for atomicAppendLine (added newline + rejection
 *     of caller-supplied embedded newlines)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

import { atomicWrite, atomicAppendLine } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "atomic-fs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Count leftover *.tmp siblings in a directory. */
function tmpFileCount(dir: string): number {
  return readdirSync(dir).filter((f) => f.endsWith(".tmp")).length;
}

// ============================================================================
// atomicWrite
// ============================================================================

describe("atomicWrite", () => {
  it("writes content that reads back identically", async () => {
    const target = join(tmpDir, "data.txt");
    await atomicWrite(target, "hello world\n");
    expect(readFileSync(target, "utf-8")).toBe("hello world\n");
  });

  it("creates the parent directory recursively", async () => {
    const target = join(tmpDir, "nested", "deep", "data.txt");
    await atomicWrite(target, "content");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("content");
  });

  it("overwrites an existing file wholesale (no partial/leftover content)", async () => {
    const target = join(tmpDir, "data.txt");
    await atomicWrite(target, "the original longer content");
    await atomicWrite(target, "short");
    // A truncating write would leave trailing bytes; rename replaces the inode.
    expect(readFileSync(target, "utf-8")).toBe("short");
  });

  it("leaves no orphaned tmp file on success", async () => {
    const target = join(tmpDir, "data.txt");
    await atomicWrite(target, "content");
    expect(tmpFileCount(tmpDir)).toBe(0);
  });

  it("durably persists content when fsync is enabled (reads back)", async () => {
    const target = join(tmpDir, "durable.txt");
    await atomicWrite(target, "fsynced content", { fsync: true });
    expect(readFileSync(target, "utf-8")).toBe("fsynced content");
    expect(tmpFileCount(tmpDir)).toBe(0);
  });

  it("cleans up the tmp file and leaves the original intact on write failure", async () => {
    const target = join(tmpDir, "data.txt");
    await atomicWrite(target, "original");

    // Point at a directory that does not exist AND cannot be created: make the
    // parent a file, so mkdir/open of a child path fails.
    const blocker = join(tmpDir, "blocker");
    await atomicWrite(blocker, "i am a file");
    const doomed = join(blocker, "child.txt"); // parent is a file → ENOTDIR

    await expect(atomicWrite(doomed, "nope")).rejects.toThrow();

    // Original untouched, no orphaned tmp anywhere under tmpDir.
    expect(readFileSync(target, "utf-8")).toBe("original");
    expect(tmpFileCount(tmpDir)).toBe(0);
  });

  // POSIX-only: chmod 0o000 does not deny writes the way it does on Windows
  // (and CI may run as root, where mode bits are bypassed). Skip there.
  const denyByMode = platform() !== "win32" && process.getuid?.() !== 0;
  it.runIf(denyByMode)(
    "cleans up the tmp file when the temp write fails on a read-only directory",
    async () => {
      const roDir = join(tmpDir, "readonly");
      await atomicWrite(join(roDir, "seed.txt"), "seed"); // creates roDir
      // Strip all write permission: open(tmp, "w") inside roDir → EACCES.
      chmodSync(roDir, 0o500);
      try {
        const doomed = join(roDir, "data.txt");
        await expect(atomicWrite(doomed, "nope")).rejects.toThrow();
        // The failed temp create/write must not leave a *.tmp orphan behind.
        expect(tmpFileCount(roDir)).toBe(0);
      } finally {
        // Restore so afterEach's recursive rm can clean up.
        chmodSync(roDir, 0o700);
      }
    },
  );
});

// ============================================================================
// atomicAppendLine
// ============================================================================

describe("atomicAppendLine", () => {
  it("appends a single trailing newline (caller must not include one)", async () => {
    const target = join(tmpDir, "log.jsonl");
    await atomicAppendLine(target, "line one");
    await atomicAppendLine(target, "line two");
    expect(readFileSync(target, "utf-8")).toBe("line one\nline two\n");
  });

  it("creates the parent directory recursively", async () => {
    const target = join(tmpDir, "nested", "log.jsonl");
    await atomicAppendLine(target, "x");
    expect(readFileSync(target, "utf-8")).toBe("x\n");
  });

  it("persists durably with fsync enabled", async () => {
    const target = join(tmpDir, "log.jsonl");
    await atomicAppendLine(target, "durable", { fsync: true });
    expect(readFileSync(target, "utf-8")).toBe("durable\n");
  });

  it("preserves every line under concurrent appends below PIPE_BUF", async () => {
    const target = join(tmpDir, "concurrent.jsonl");
    const COUNT = 200;
    // Each line is well under PIPE_BUF (4096 bytes), so each append is a single
    // atomic write(2) on POSIX — no interleaving, no torn lines.
    const lines = Array.from({ length: COUNT }, (_, i) => `entry-${i}-${"x".repeat(64)}`);

    await Promise.all(lines.map((line) => atomicAppendLine(target, line)));

    const written = readFileSync(target, "utf-8");
    // Trailing newline → final split element is empty; drop it.
    const got = written.split("\n").filter((l) => l.length > 0);
    expect(got).toHaveLength(COUNT);

    // No line was torn or merged: every original line is present exactly once.
    const gotSet = new Set(got);
    expect(gotSet.size).toBe(COUNT);
    for (const line of lines) {
      expect(gotSet.has(line)).toBe(true);
    }
  });

  it("rejects a line containing a newline (single-line contract is enforced)", async () => {
    const target = join(tmpDir, "log.jsonl");
    await expect(atomicAppendLine(target, "a\nb")).rejects.toThrow(TypeError);
    // The rejected call must not have created or written the file: the contract
    // is enforced before any filesystem mutation, so nothing is half-written.
    expect(existsSync(target)).toBe(false);
  });

  it("preserves whole lines that EXCEED PIPE_BUF when appended serially", async () => {
    // Above PIPE_BUF (4096 bytes) the kernel may split the write(2), so the
    // *concurrent* atomicity guarantee no longer holds (documented). Serial
    // appends, however, must still round-trip every line intact — a single
    // appender never races itself. This pins the documented boundary: large
    // lines are supported, only cross-appender atomicity is forfeited.
    const target = join(tmpDir, "big.jsonl");
    const big = "B".repeat(8192); // 8 KiB payload + "\n" → well over PIPE_BUF
    const small = "small";
    await atomicAppendLine(target, big);
    await atomicAppendLine(target, small);
    await atomicAppendLine(target, big);

    const written = readFileSync(target, "utf-8");
    expect(written).toBe(`${big}\n${small}\n${big}\n`);
    const got = written.split("\n").filter((l) => l.length > 0);
    expect(got).toEqual([big, small, big]);
  });
});
