/**
 * Logger Injection Tests (@centient/events)
 *
 * Covers Initiative 6 — unify logger injection:
 *   - An injected capture logger receives stream-internal warn-path messages.
 *   - The JSONL subscriber routes its diagnostics to the injected logger.
 *   - The default path (no logger injected) is unchanged: the factory works
 *     and emits no console output, so behavior is identical to before
 *     injection existed.
 *
 * We eat our own testing utilities: the capture logger is `createTestLogger`
 * from @centient/logger, which is structurally a valid `EventsLogger`.
 */

import { describe, it, expect } from "vitest";
import { createTestLogger } from "@centient/logger";

import { createEventStream, createJsonlSubscriber } from "../src/index.js";
import type { EventsLogger } from "../src/index.js";

describe("events logger injection", () => {
  it("routes stream-internal warn messages to an injected capture logger", async () => {
    const { logger, getEntries } = createTestLogger("events-capture");

    const stream = createEventStream<number>({ logger });
    await stream.close();

    // emit() on a closed stream is the canonical internal warn path.
    stream.emit(1);

    const warnings = getEntries().filter((e) => e.level === "warn");
    expect(warnings.some((e) => e.message.includes("emit() called on closed stream"))).toBe(true);
  });

  it("routes JSONL serialization-failure diagnostics to an injected logger", () => {
    const { logger, getEntries } = createTestLogger("jsonl-capture");

    const { subscriber } = createJsonlSubscriber<unknown>("/tmp/does-not-matter.jsonl", { logger });

    // A BigInt is not JSON-serializable — the subscriber logs an error and
    // drops the single event rather than crashing the stream.
    subscriber.onEvent({ bad: 1n } as unknown);

    const errors = getEntries().filter((e) => e.level === "error");
    expect(errors.some((e) => e.message.includes("JSONL serialization failed"))).toBe(true);
  });

  it("accepts any structural EventsLogger (not just @centient/logger)", async () => {
    const calls: string[] = [];
    const captured: EventsLogger = {
      debug: () => {},
      info: () => {},
      warn: (a: unknown, b?: unknown) => {
        calls.push(typeof b === "string" ? b : (a as string));
      },
      error: () => {},
    };

    const stream = createEventStream<number>({ logger: captured });
    await stream.close();
    stream.emit(1);

    expect(calls.some((m) => m.includes("emit() called on closed stream"))).toBe(true);
  });

  describe("default path (no logger injected) — behavior unchanged", () => {
    it("delivers events identically when no logger is passed", async () => {
      // No `logger` option: the default `@centient/logger` component logger
      // is used (as before injection existed). The observable contract —
      // ordered fan-out delivery — must be unchanged.
      const stream = createEventStream<number>();
      const received: number[] = [];

      const iterator = stream.subscribe()[Symbol.asyncIterator]();
      stream.emit(1);
      stream.emit(2);
      received.push((await iterator.next()).value as number);
      received.push((await iterator.next()).value as number);
      await stream.close();

      expect(received).toEqual([1, 2]);
    });
  });
});
