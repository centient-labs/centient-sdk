/**
 * JSONL Rotation Tests (#132)
 *
 * The production failure this guards against is a 601 MB un-rotated
 * `maintainer.jsonl`. The two properties that matter most here are:
 *
 *   1. **Default off** — a subscriber created without `rotation` behaves
 *      exactly as it did before rotation existed.
 *   2. **Retention never deletes an operator's file** — the prune pass unlinks
 *      files, so the anchored stamp match gets an adversarial name battery.
 *
 * Every test drives the clock explicitly, so rotated names are deterministic
 * and nothing depends on wall-clock ordering.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventStream, createJsonlSubscriber } from "../src/index.js";
import type { EventsLogger } from "../src/index.js";
import { isRotatedSiblingName, rotateIfNeeded } from "../src/rotation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string | null = null;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "events-rotation-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

/** A settable clock: tests advance it between rotations to control stamps. */
function makeClock(startIso: string): { clock: () => Date; advance: (ms: number) => void } {
  let ms = Date.parse(startIso);
  return {
    clock: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

/** Captures both call shapes of the EventsLogger overload pair. */
function makeCapturedLogger(): { logger: EventsLogger; records: CapturedLog[] } {
  const records: CapturedLog[] = [];
  const at =
    (level: CapturedLog["level"]) =>
    (a: Record<string, unknown> | string, b?: string): void => {
      records.push(
        typeof a === "string"
          ? { level, message: a }
          : { level, message: b ?? "", context: a },
      );
    };
  return {
    records,
    logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") },
  };
}

/** ~185 bytes per written line — enough that a handful crosses a small threshold. */
function bigEvent(n: number): { n: number; pad: string } {
  return { n, pad: "x".repeat(120) };
}

type BigEvent = ReturnType<typeof bigEvent>;

/** The `n` of every event on disk, across the live file and all rotated siblings. */
function readAllEventIds(dir: string, liveName: string): number[] {
  const ids: number[] = [];
  for (const name of readdirSync(dir)) {
    if (name !== liveName && !isRotatedSiblingName(join(dir, liveName), name)) continue;
    for (const line of readFileSync(join(dir, name), "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      ids.push((JSON.parse(line) as { event: BigEvent }).event.n);
    }
  }
  return ids.sort((a, b) => a - b);
}

function rotatedSiblings(dir: string, liveName: string): string[] {
  return readdirSync(dir)
    .filter((name) => isRotatedSiblingName(join(dir, liveName), name))
    .sort();
}

// ---------------------------------------------------------------------------
// Default-off
// ---------------------------------------------------------------------------

describe("jsonl rotation — off by default", () => {
  it("never rotates, prunes, or renames when no rotation option is passed", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path);
    for (let i = 0; i < 20; i++) {
      subscriber.onEvent(bigEvent(i));
      // Flush per event so there are 20 separate append+check opportunities.
      await flush();
    }

    // Well past any default a rotation-enabled subscriber would have used.
    expect(statSync(path).size).toBeGreaterThan(3000);
    expect(readdirSync(dir)).toEqual(["events.jsonl"]);
    expect(readAllEventIds(dir, "events.jsonl")).toHaveLength(20);
  });

  it("leaves a pre-existing oversized file alone at construction", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "x".repeat(10_000), "utf-8");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path);
    subscriber.onEvent(bigEvent(1));
    await flush();

    expect(readdirSync(dir)).toEqual(["events.jsonl"]);
    expect(statSync(path).size).toBeGreaterThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

describe("jsonl rotation — size threshold", () => {
  it("rotates at the next flush once the file has reached maxSizeBytes", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
      clock,
    });

    // First batch: file starts empty, so nothing rotates — it ends oversized.
    for (const n of [0, 1, 2]) subscriber.onEvent(bigEvent(n));
    await flush();
    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([]);
    expect(statSync(path).size).toBeGreaterThanOrEqual(500);

    // Second batch: the pre-append check sees the oversized file and rotates.
    advance(1_000);
    for (const n of [3, 4]) subscriber.onEvent(bigEvent(n));
    await flush();

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      "events.jsonl.2026-07-02T10-15-31-000Z",
    ]);
    // The whole second batch landed in the fresh file, not split across the rename.
    expect(readAllEventIds(dir, "events.jsonl")).toEqual([0, 1, 2, 3, 4]);
    expect(readFileSync(path, "utf-8").trim().split("\n")).toHaveLength(2);
  });

  it("loses no lines across repeated rotations", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 400, maxFiles: 50 },
      clock,
    });

    for (let i = 0; i < 30; i++) {
      subscriber.onEvent(bigEvent(i));
      await flush();
      advance(1_000);
    }

    expect(rotatedSiblings(dir, "events.jsonl").length).toBeGreaterThan(1);
    expect(readAllEventIds(dir, "events.jsonl")).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );
  });

  it("disambiguates rotated names that collide on the same millisecond", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    // Clock never advances — every rotation stamps the same millisecond.
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 300, maxFiles: 50 },
      clock,
    });

    for (let i = 0; i < 6; i++) {
      subscriber.onEvent(bigEvent(i));
      subscriber.onEvent(bigEvent(i + 100));
      await flush();
    }

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      "events.jsonl.2026-07-02T10-15-30-000Z",
      "events.jsonl.2026-07-02T10-15-30-000Z-1",
      "events.jsonl.2026-07-02T10-15-30-000Z-2",
      "events.jsonl.2026-07-02T10-15-30-000Z-3",
      "events.jsonl.2026-07-02T10-15-30-000Z-4",
    ]);
    // No rotation overwrote an earlier one.
    expect(readAllEventIds(dir, "events.jsonl")).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// Boot-time rotation
// ---------------------------------------------------------------------------

describe("jsonl rotation — boot-time", () => {
  it("rotates a file left oversized by a previous process before the first append", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "seeded\n".repeat(200), "utf-8"); // ~1400 bytes
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    const { flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
      clock,
    });

    // No events at all: the boot check is seeded onto the flush chain, so an
    // await on flush() observes it.
    await flush();

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      "events.jsonl.2026-07-02T10-15-30-000Z",
    ]);
    expect(readdirSync(dir)).toEqual(["events.jsonl.2026-07-02T10-15-30-000Z"]);
  });

  it("rotates only once when concurrent flushes race the boot check", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "seeded\n".repeat(200), "utf-8");
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
      clock,
    });

    subscriber.onEvent(bigEvent(1));
    await Promise.all([flush(), flush(), flush()]);

    expect(rotatedSiblings(dir, "events.jsonl")).toHaveLength(1);
    expect(readFileSync(path, "utf-8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(path, "utf-8")).toContain('"n":1');
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe("jsonl rotation — retention", () => {
  it("keeps only the newest maxFiles rotated siblings", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 300, maxFiles: 2 },
      clock,
    });

    for (let i = 0; i < 6; i++) {
      subscriber.onEvent(bigEvent(i));
      subscriber.onEvent(bigEvent(i + 100));
      await flush();
      advance(1_000);
    }

    // The first flush only fills the file; rotations land at :32 … :35, and
    // only the two newest survive retention.
    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      "events.jsonl.2026-07-02T10-15-34-000Z",
      "events.jsonl.2026-07-02T10-15-35-000Z",
    ]);
  });

  it("prunes same-millisecond siblings in numeric, not lexicographic, order", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    const stamp = "2026-07-02T10-15-30-000Z";
    // `-10` sorts BEFORE `-2` as a string; it is newer, so it must survive.
    for (const suffix of [stamp, `${stamp}-2`, `${stamp}-10`]) {
      writeFileSync(join(dir, `events.jsonl.${suffix}`), "old\n", "utf-8");
    }
    writeFileSync(path, "x".repeat(1000), "utf-8");

    const { logger } = makeCapturedLogger();
    const result = await rotateIfNeeded({
      filePath: path,
      config: { maxSizeBytes: 500, maxFiles: 2 },
      logger,
      now: () => new Date("2026-07-02T10:15:31.000Z"),
    });

    expect(result.rotated).toBe(true);
    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      `events.jsonl.${stamp}-10`,
      "events.jsonl.2026-07-02T10-15-31-000Z",
    ]);
  });

  it("discards every rotated sibling when maxFiles is 0", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 300, maxFiles: 0 },
      clock,
    });

    for (let i = 0; i < 4; i++) {
      subscriber.onEvent(bigEvent(i));
      subscriber.onEvent(bigEvent(i + 100));
      await flush();
      advance(1_000);
    }

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([]);
    expect(readdirSync(dir)).toEqual(["events.jsonl"]);
  });
});

// ---------------------------------------------------------------------------
// Prune safety — the dangerous part
// ---------------------------------------------------------------------------

describe("jsonl rotation — prune never touches operator files", () => {
  /** Names an operator (or another tool) might reasonably leave in the log dir. */
  const bystanders = [
    "events.jsonl.old",
    "events.jsonl.1",
    "events.jsonl.bak",
    "events.jsonl.gz",
    "2026.06.13.events.jsonl",
    "events.jsonl.2026-07-02T10-15-30-123Z.bak", // stamped, then suffixed
    "events.jsonl.2026-07-02T10-15-30-123", // stamp without the Z
    "events.jsonl.2026-07-02T10-15-30-123Z-", // trailing dash, no number
    "events.jsonl.2026-07-02T10-15-30-123Z-x", // non-numeric disambiguator
    "events.jsonl-2026-07-02T10-15-30-123Z", // dash instead of the dot
    "other.jsonl.2026-07-02T10-15-30-123Z", // a different log's rotation
    "events.jsonl.2026-07-02T10:15:30.123Z", // raw ISO, not the safe stamp
  ];

  it("sweeps its own rotated files and leaves every bystander in place", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    for (const name of bystanders) writeFileSync(join(dir, name), "operator\n", "utf-8");
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    // maxFiles: 0 makes retention maximally aggressive — if the match were
    // loose, every bystander would be gone.
    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 300, maxFiles: 0 },
      clock,
    });

    for (let i = 0; i < 4; i++) {
      subscriber.onEvent(bigEvent(i));
      subscriber.onEvent(bigEvent(i + 100));
      await flush();
      advance(1_000);
    }

    expect(readdirSync(dir).sort()).toEqual([...bystanders, "events.jsonl"].sort());
    for (const name of bystanders) {
      expect(readFileSync(join(dir, name), "utf-8")).toBe("operator\n");
    }
  });

  it("matches the rotated-name shape exactly", () => {
    const path = "/logs/events.jsonl";
    for (const name of bystanders) {
      expect([name, isRotatedSiblingName(path, name)]).toEqual([name, false]);
    }
    for (const name of [
      "events.jsonl.2026-07-02T10-15-30-123Z",
      "events.jsonl.2026-07-02T10-15-30-123Z-1",
      "events.jsonl.2026-07-02T10-15-30-123Z-42",
    ]) {
      expect([name, isRotatedSiblingName(path, name)]).toEqual([name, true]);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure handling — visible, never fatal
// ---------------------------------------------------------------------------

describe("jsonl rotation — failures are logged, never thrown", () => {
  it("reports a stat failure as a logged non-rotation", async () => {
    const dir = makeTmpDir();
    // Parent is a regular file, so stat() fails with ENOTDIR (not ENOENT).
    writeFileSync(join(dir, "notadir"), "", "utf-8");
    const { logger, records } = makeCapturedLogger();

    const result = await rotateIfNeeded({
      filePath: join(dir, "notadir", "events.jsonl"),
      config: { maxSizeBytes: 10, maxFiles: 5 },
      logger,
      now: () => new Date("2026-07-02T10:15:30.000Z"),
    });

    expect(result).toEqual({ rotated: false, reason: "stat-failed", pruned: [] });
    expect(records.filter((r) => r.level === "warn")).toHaveLength(1);
    expect(records[0]?.message).toMatch(/size check failed/);
  });

  it("distinguishes an absent file from a failed check", async () => {
    const dir = makeTmpDir();
    const { logger, records } = makeCapturedLogger();

    const result = await rotateIfNeeded({
      filePath: join(dir, "events.jsonl"),
      config: { maxSizeBytes: 10, maxFiles: 5 },
      logger,
      now: () => new Date("2026-07-02T10:15:30.000Z"),
    });

    expect(result).toEqual({ rotated: false, reason: "absent", pruned: [] });
    expect(records).toEqual([]); // first-write ENOENT is not a problem to report
  });

  /**
   * Fault injection for the `rename()` IO boundary, without mocking `node:fs`.
   *
   * The live log gets a basename just under NAME_MAX (255 on APFS/ext4).
   * Appending the 25-character `.<stamp>` suffix pushes the ROTATED name past
   * that limit, so `rename()` fails with a real ENAMETOOLONG from the kernel —
   * while the live file itself, already within the limit, stays perfectly
   * writable. That is precisely the shape this branch must survive: rotation
   * cannot proceed, but the stream must keep appending.
   */
  const LONG_LIVE_BASENAME = `${"a".repeat(248)}.jsonl`; // 254 chars
  const LONG_ROTATED_BASENAME = `${LONG_LIVE_BASENAME}.2026-07-02T10-15-30-000Z`; // 279

  /** Fail loudly if this filesystem does not enforce NAME_MAX — the fault would not be armed. */
  function assertRenameFaultArmed(dir: string): void {
    expect(() => writeFileSync(join(dir, LONG_ROTATED_BASENAME), "", "utf-8")).toThrow(
      /ENAMETOOLONG/,
    );
  }

  it("reports a failed rename as a logged non-rotation, leaving the live file in place", async () => {
    const dir = makeTmpDir();
    const path = join(dir, LONG_LIVE_BASENAME);
    writeFileSync(path, "x".repeat(1000), "utf-8");
    assertRenameFaultArmed(dir);
    const { logger, records } = makeCapturedLogger();

    const result = await rotateIfNeeded({
      filePath: path,
      config: { maxSizeBytes: 500, maxFiles: 5 },
      logger,
      now: () => new Date("2026-07-02T10:15:30.000Z"),
    });

    // Does not throw, and reports the failure rather than a silent no-op.
    expect(result).toEqual({ rotated: false, reason: "rename-failed", pruned: [] });

    // The failure is visible on the injected logger, carrying the context an
    // operator needs to act on it.
    const warns = records.filter((r) => r.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]?.message).toMatch(/rename failed/);
    expect(warns[0]?.context?.filePath).toBe(path);
    expect(warns[0]?.context?.rotatedTo).toBe(join(dir, LONG_ROTATED_BASENAME));
    expect(warns[0]?.context?.error).toMatch(/ENAMETOOLONG/);
    // And no "rotated" success line was emitted alongside it.
    expect(records.filter((r) => r.level === "info")).toEqual([]);

    // The live file is untouched — not renamed, not truncated, not half-moved.
    expect(readdirSync(dir)).toEqual([LONG_LIVE_BASENAME]);
    expect(statSync(path).size).toBe(1000);
  });

  it("keeps the stream appending after a rename failure", async () => {
    const dir = makeTmpDir();
    const path = join(dir, LONG_LIVE_BASENAME);
    writeFileSync(path, "seeded\n".repeat(200), "utf-8"); // ~1400 bytes, over threshold
    assertRenameFaultArmed(dir);
    const { logger, records } = makeCapturedLogger();
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
      clock,
      logger,
    });

    // The file is over threshold, so every flush retries the rotation and
    // every attempt fails. The stream must survive all of them.
    subscriber.onEvent(bigEvent(0));
    await expect(flush()).resolves.toBeUndefined();
    subscriber.onEvent(bigEvent(1));
    await expect(flush()).resolves.toBeUndefined();

    // The assertion that matters: both events actually reached disk, in the
    // still-live file, after the failed rotations.
    const contents = readFileSync(path, "utf-8");
    expect(contents).toContain("seeded"); // pre-existing bytes never moved
    expect(contents).toContain('"n":0');
    expect(contents).toContain('"n":1');
    expect(readdirSync(dir)).toEqual([LONG_LIVE_BASENAME]);

    // Still reported on every attempt — not silently swallowed after the first.
    const warns = records.filter((r) => r.message.includes("rename failed"));
    expect(warns.length).toBeGreaterThanOrEqual(2);
  });

  it("reports an exhausted rotated-name namespace as a logged non-rotation", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "x".repeat(1000), "utf-8");
    // Take every name pickRotatedName would try: the bare stamp, plus -1..-1000.
    const stamp = "2026-07-02T10-15-30-000Z";
    writeFileSync(join(dir, `events.jsonl.${stamp}`), "", "utf-8");
    for (let n = 1; n <= 1000; n++) {
      writeFileSync(join(dir, `events.jsonl.${stamp}-${n}`), "", "utf-8");
    }
    const { logger, records } = makeCapturedLogger();

    const result = await rotateIfNeeded({
      filePath: path,
      config: { maxSizeBytes: 500, maxFiles: 5 },
      logger,
      now: () => new Date("2026-07-02T10:15:30.000Z"),
    });

    expect(result).toEqual({ rotated: false, reason: "rename-failed", pruned: [] });
    const warns = records.filter((r) => r.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]?.message).toMatch(/could not find a free rotated name/);
    expect(warns[0]?.context?.attempts).toBe(1000);

    // rename() was never reached, so nothing moved and retention never ran.
    expect(statSync(path).size).toBe(1000);
    expect(readdirSync(dir)).toHaveLength(1002);
  });

  it("keeps writing when retention cannot delete a rotated sibling", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    // A DIRECTORY whose name matches the rotated shape: unlink() will fail on it.
    const undeletable = join(dir, "events.jsonl.2026-07-02T10-15-29-000Z");
    mkdirSync(undeletable);
    writeFileSync(join(undeletable, "held"), "", "utf-8");

    const { logger, records } = makeCapturedLogger();
    const { clock, advance } = makeClock("2026-07-02T10:15:30.000Z");

    const { subscriber, flush } = createJsonlSubscriber<BigEvent>(path, {
      rotation: { maxSizeBytes: 300, maxFiles: 0 },
      clock,
      logger,
    });

    subscriber.onEvent(bigEvent(0));
    subscriber.onEvent(bigEvent(1));
    await flush();
    advance(1_000);
    subscriber.onEvent(bigEvent(2));
    await expect(flush()).resolves.toBeUndefined();

    // The rotation happened, the undeletable sibling survived, and the event
    // after it still reached disk.
    expect(readFileSync(path, "utf-8")).toContain('"n":2');
    expect(readdirSync(dir)).toContain("events.jsonl.2026-07-02T10-15-29-000Z");
    const warns = records.filter((r) => r.message.includes("could not delete"));
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0]?.context?.filePath).toBe(undeletable);
  });

  it("rejects invalid rotation settings at construction instead of clamping", () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");

    expect(() => createJsonlSubscriber(path, { rotation: { maxSizeBytes: 0 } })).toThrow(
      TypeError,
    );
    expect(() => createJsonlSubscriber(path, { rotation: { maxSizeBytes: -1 } })).toThrow(
      /positive integer/,
    );
    expect(() => createJsonlSubscriber(path, { rotation: { maxSizeBytes: 1.5 } })).toThrow(
      TypeError,
    );
    expect(() => createJsonlSubscriber(path, { rotation: { maxFiles: -1 } })).toThrow(
      /non-negative integer/,
    );
    // The empty object is valid — it means "rotate with the defaults".
    expect(() => createJsonlSubscriber(path, { rotation: {} })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Stream wiring
// ---------------------------------------------------------------------------

describe("createEventStream — rotation plumbing", () => {
  it("applies stream-level rotation to jsonl() subscribers", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "seeded\n".repeat(200), "utf-8");
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    const stream = createEventStream<BigEvent>({
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
    });
    stream.jsonl(path, { clock });
    await stream.close();

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([
      "events.jsonl.2026-07-02T10-15-30-000Z",
    ]);
  });

  it("lets a per-call rotation override the stream default", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "seeded\n".repeat(200), "utf-8"); // ~1400 bytes
    const { clock } = makeClock("2026-07-02T10:15:30.000Z");

    // Stream default would rotate (500); the per-call override (100 KiB) must not.
    const stream = createEventStream<BigEvent>({
      rotation: { maxSizeBytes: 500, maxFiles: 5 },
    });
    stream.jsonl(path, { rotation: { maxSizeBytes: 100 * 1024 }, clock });
    await stream.close();

    expect(rotatedSiblings(dir, "events.jsonl")).toEqual([]);
  });

  it("stays off when neither the stream nor the call asks for rotation", async () => {
    const dir = makeTmpDir();
    const path = join(dir, "events.jsonl");
    writeFileSync(path, "seeded\n".repeat(200), "utf-8");

    const stream = createEventStream<BigEvent>();
    stream.jsonl(path);
    await stream.close();

    expect(readdirSync(dir)).toEqual(["events.jsonl"]);
  });
});
