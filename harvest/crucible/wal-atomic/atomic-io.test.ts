/**
 * Unit tests for atomic-io.ts.
 *
 * Verifies:
 *   - atomicWrite creates files with correct content
 *   - atomicWrite is idempotent (overwrites existing files)
 *   - atomicWrite auto-creates parent directories
 *   - atomicWrite cleans up .tmp file on write failure
 *   - atomicAppendLine appends content with newline
 *   - atomicAppendLine auto-creates parent directories
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { atomicWrite, atomicAppendLine } from "../../src/utils/atomic-io.js";

function tempDir(): string {
  return join(tmpdir(), `atomic-io-test-${randomUUID()}`);
}

describe("atomicWrite", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("writes content to a new file", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "test.json");

    await atomicWrite(filePath, '{"ok":true}');
    const content = await readFile(filePath, "utf8");
    expect(content).toBe('{"ok":true}');
  });

  it("overwrites existing file content", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "test.txt");

    await atomicWrite(filePath, "first");
    await atomicWrite(filePath, "second");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("second");
  });

  it("auto-creates parent directories", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "nested", "deep", "file.txt");

    await atomicWrite(filePath, "hello");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("hello");
  });

  it("does not leave .tmp file on success", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "file.txt");

    await atomicWrite(filePath, "content");
    // Verify no .tmp files remain
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("writes empty string", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "empty.txt");

    await atomicWrite(filePath, "");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("");
  });

  it("preserves multi-line content exactly", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "multiline.txt");
    const expected = "line1\nline2\nline3";

    await atomicWrite(filePath, expected);
    const content = await readFile(filePath, "utf8");
    expect(content).toBe(expected);
  });
});

describe("atomicWrite error cleanup", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      // Restore write permissions before cleanup
      await chmod(d, 0o755).catch(() => undefined);
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("cleans up temp file on write error and re-throws", async () => {
    const dir = tempDir();
    dirs.push(dir);
    // Create the directory, then make it read-only so writeFile fails
    const { mkdir: mkdirFs, chmod: chmodFs } = await import("node:fs/promises");
    await mkdirFs(dir, { recursive: true });
    await chmodFs(dir, 0o444); // read-only — writeFile will fail with EACCES

    const filePath = join(dir, "write-fail.txt");

    // atomicWrite should throw (cannot write temp file)
    await expect(atomicWrite(filePath, "content")).rejects.toThrow();

    // Restore write permissions to check for leftover temp files
    await chmodFs(dir, 0o755);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    // No .tmp files should remain — the cleanup path removed them (or write
    // never created them because it failed immediately)
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("cleans up temp file on rename error and re-throws", async () => {
    const dir = tempDir();
    dirs.push(dir);
    // Create the directory
    const { mkdir: mkdirFs } = await import("node:fs/promises");
    await mkdirFs(dir, { recursive: true });

    // Write to a temp file in dir, then try to rename to a target in a
    // non-writable subdirectory — rename will fail with ENOENT/EACCES.
    // Strategy: filePath targets a nested dir that doesn't exist, but the
    // temp file is written in the parent (same dir as filePath).
    // atomicWrite calls mkdir(dir) which succeeds, writes the tmp file,
    // then tries to rename. We create the tmp file in dir successfully,
    // but make the target a directory (not a file) so rename fails.
    const targetDir = join(dir, "subdir");
    await mkdirFs(targetDir);
    // Target path IS an existing directory — rename(file, dir) fails on POSIX
    const filePath = targetDir;

    await expect(atomicWrite(filePath, "content")).rejects.toThrow();

    // No .tmp files should remain in dir after cleanup
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });
});

describe("atomicAppendLine", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("creates file and appends a line with newline", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "log.jsonl");

    await atomicAppendLine(filePath, '{"event":"start"}');
    const content = await readFile(filePath, "utf8");
    expect(content).toBe('{"event":"start"}\n');
  });

  it("appends multiple lines in order", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "log.jsonl");

    await atomicAppendLine(filePath, "line1");
    await atomicAppendLine(filePath, "line2");
    await atomicAppendLine(filePath, "line3");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("line1\nline2\nline3\n");
  });

  it("auto-creates parent directories", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "nested", "log.txt");

    await atomicAppendLine(filePath, "entry");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("entry\n");
  });

  it("file exists and has correct size after append", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = join(dir, "size.txt");

    await atomicAppendLine(filePath, "hello");
    const s = await stat(filePath);
    // "hello\n" = 6 bytes
    expect(s.size).toBe(6);
  });
});
