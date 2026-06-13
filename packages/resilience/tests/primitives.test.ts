/**
 * Tests for the shared primitives (clock, random, result) and a source-grep
 * guard enforcing the observable-architecture rule: no `Date.now()` /
 * `Math.random()` outside the single injectable seams (clock.ts / random.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createManualClock, systemClock } from "../src/clock.js";
import { fixedRandom, sequenceRandom, systemRandom } from "../src/random.js";
import { ok, err, isOk, isErr } from "../src/result.js";

describe("clock", () => {
  it("manual clock advances and sets deterministically", () => {
    const t = createManualClock(100);
    expect(t.now()).toBe(100);
    t.advance(50);
    expect(t.clock()).toBe(150);
    t.set(1_000);
    expect(t.now()).toBe(1_000);
  });

  it("manual clock rejects negative advance", () => {
    expect(() => createManualClock(0).advance(-1)).toThrow(RangeError);
  });

  it("systemClock returns a number close to Date.now()", () => {
    const before = Date.now();
    const value = systemClock();
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});

describe("random", () => {
  it("fixedRandom returns its value and validates range", () => {
    expect(fixedRandom(0.3)()).toBe(0.3);
    expect(() => fixedRandom(1)).toThrow(RangeError);
    expect(() => fixedRandom(-0.1)).toThrow(RangeError);
  });

  it("sequenceRandom cycles through its values", () => {
    const r = sequenceRandom([0.1, 0.2, 0.3]);
    expect([r(), r(), r(), r()]).toEqual([0.1, 0.2, 0.3, 0.1]);
    expect(() => sequenceRandom([])).toThrow(RangeError);
    expect(() => sequenceRandom([1.5])).toThrow(RangeError);
  });

  it("systemRandom stays in [0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      const v = systemRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("result", () => {
  it("constructs and narrows ok/err", () => {
    const good = ok(42);
    const bad = err("nope");
    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) expect(good.value).toBe(42);
    if (isErr(bad)) expect(bad.error).toBe("nope");
  });
});

describe("observable-architecture source guard", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));

  function sourceFiles(): string[] {
    return readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
  }

  /**
   * Strip comments so the guard checks executable code only. The rule targets
   * logic paths; documenting "no Date.now() here" in a doc comment is fine.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
      .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not URLs)
  }

  it("no logic path reads Date.now() except clock.ts (the seam)", () => {
    for (const file of sourceFiles()) {
      if (file === "clock.ts") continue;
      const code = stripComments(readFileSync(`${srcDir}/${file}`, "utf8"));
      expect(code, `${file} must not call Date.now() in a logic path`).not.toMatch(
        /Date\.now\(\)/,
      );
    }
  });

  it("no logic path reads Math.random() except random.ts (the seam)", () => {
    for (const file of sourceFiles()) {
      if (file === "random.ts") continue;
      const code = stripComments(readFileSync(`${srcDir}/${file}`, "utf8"));
      expect(code, `${file} must not call Math.random() in a logic path`).not.toMatch(
        /Math\.random\(\)/,
      );
    }
  });
});
