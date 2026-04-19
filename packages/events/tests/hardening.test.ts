/**
 * Hardening Tests (P2: no silent degradation)
 *
 * Covers the three fixes bundled with the wal/logger hardening pass:
 *   - JSONL serialization failure (circular ref) does NOT crash the subscriber
 *   - Follow-mode init is single-flight under concurrent next() calls
 *   - Follow-mode oversized-line overflow surfaces as an iterator error,
 *     not a silent drop
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJsonlSubscriber, fromJsonl } from "../src/index.js";

let tmpDir: string | null = null;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "events-harden-"));
  return tmpDir;
}

function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("jsonl subscriber — serialization failure isolation", () => {
  it("drops events that cannot be serialized without crashing the subscriber", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");

    const { subscriber, flush } = createJsonlSubscriber<{ payload: unknown }>(path);

    const circular: Record<string, unknown> = { type: "bad" };
    circular["self"] = circular;

    // Before fix: JSON.stringify throws and the exception escapes onEvent.
    // After fix: the single event is logged and dropped; subscriber keeps working.
    expect(() => subscriber.onEvent({ payload: circular })).not.toThrow();
    subscriber.onEvent({ payload: { type: "good" } });

    await flush();

    const contents = readFileSync(path, "utf-8");
    expect(contents).toContain('"type":"good"');
    expect(contents).not.toContain('"type":"bad"');
  });
});

describe("fromJsonl follow mode — single-flight init", () => {
  it("serves concurrent next() calls from a single init pass", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");

    // Seed two events so two concurrent next() calls can both resolve from
    // the initial readNewContent() without waiting for a file-watch event.
    // Before fix: each concurrent call could enter init() and race to open
    // the file + install a watcher, leaking the loser's handle.
    writeFileSync(
      path,
      [
        JSON.stringify({ _ts: "t1", event: { n: 1 } }),
        JSON.stringify({ _ts: "t2", event: { n: 2 } }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const iter = fromJsonl<{ n: number }>(path, { follow: true })[Symbol.asyncIterator]();

    const [a, b] = await Promise.all([iter.next(), iter.next()]);
    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    const values = [a.value?.n, b.value?.n].sort();
    expect(values).toEqual([1, 2]);

    await iter.return?.();
  });
});

describe("fromJsonl follow mode — oversized line surfaces as error", () => {
  it("rejects the iterator when a line exceeds MAX_LINE_BYTES", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    // Seed a valid event so init succeeds
    writeFileSync(path, JSON.stringify({ _ts: "t", event: { n: 0 } }) + "\n", "utf-8");

    const iter = fromJsonl<{ n: number }>(path, { follow: true })[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);

    // Park a next() call, then append a 2 MiB chunk with no newline. The
    // watcher fires, readNewContent accumulates the chunk as `remainder`,
    // the overflow guard triggers, and the pending next() must reject.
    const pending = iter.next();

    await tick(50);
    appendFileSync(path, "x".repeat(2 * 1024 * 1024), "utf-8");

    await expect(
      Promise.race([
        pending,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no error raised")), 4000)),
      ]),
    ).rejects.toThrow(/exceeds/);

    await iter.return?.();
  }, 10000);
});
