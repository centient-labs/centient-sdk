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

import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("forwards an injected logger from createEventStream to JSONL subscribers created via jsonl()", async () => {
    // The stream resolves its own default logger internally, but jsonl() must
    // forward the *injected* logger (not the resolved default) to the JSONL
    // subscriber so consumer-supplied loggers see JSONL diagnostics too. This
    // asserts the forwarding wire, not just that the component name survives.
    const { logger, getEntries } = createTestLogger("forwarded-capture");

    const stream = createEventStream<unknown>({ logger });
    stream.jsonl("/tmp/events-jsonl-forwarding.jsonl");
    // BigInt is not JSON-serializable — the JSONL subscriber logs an error.
    stream.emit({ bad: 1n });
    await stream.close();

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
    // vi.spyOn restores the original console.error in afterEach even if a test
    // throws mid-body, so a failure here can't leak a patched console.error into
    // later tests (the previous manual try/finally only restored on the happy
    // path before the assertions ran).
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("emits JSONL diagnostics under the events:jsonl component (not events)", async () => {
      // Regression: stream.jsonl() must NOT forward the stream's *resolved*
      // default logger to the JSONL subscriber. Doing so overrides the
      // subscriber's own `events:jsonl` component, so default-path diagnostics
      // would print under `[events]` instead of the historical `[events:jsonl]`.
      // The default `@centient/logger` writes formatted lines via console.error,
      // so we capture those lines and assert the component tag.
      const captured: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => String(a)).join(" "));
      });

      const stream = createEventStream<unknown>();
      stream.jsonl("/tmp/events-jsonl-component-regression.jsonl");
      // A BigInt is not JSON-serializable — JSONL logs an error and drops it.
      stream.emit({ bad: 1n });
      await stream.close();

      const diag = captured.find((l) => l.includes("JSONL serialization failed"));
      expect(diag).toBeDefined();
      expect(diag).toContain("[events:jsonl]");
      expect(diag).not.toMatch(/\[events\] /);
    });

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
