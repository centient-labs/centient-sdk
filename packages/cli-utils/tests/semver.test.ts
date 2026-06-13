import { describe, expect, it } from "vitest";
import {
  SemverError,
  compareSemver,
  compareVersions,
  formatSemver,
  parseSemver,
  satisfies,
} from "../src/index.js";

describe("parseSemver", () => {
  it("parses a canonical version", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("trims whitespace", () => {
    expect(parseSemver("  2.0.0  ")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: [],
    });
  });

  it("parses pre-release identifiers, numeric ones as numbers", () => {
    expect(parseSemver("1.2.3-rc.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["rc", 1],
    });
  });

  it("discards build metadata", () => {
    expect(parseSemver("1.2.3-rc.1+build.5")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["rc", 1],
    });
    expect(parseSemver("1.2.3+build.5").prerelease).toEqual([]);
  });

  it("rejects non-numeric core parts", () => {
    expect(() => parseSemver("1.x.0")).toThrow(SemverError);
  });

  it("rejects wrong core part count", () => {
    expect(() => parseSemver("1.0")).toThrow(SemverError);
    expect(() => parseSemver("1.0.0.0")).toThrow(SemverError);
  });

  it("rejects invalid pre-release identifiers", () => {
    expect(() => parseSemver("1.2.3-rc!")).toThrow(SemverError);
  });

  it("rejects non-strings", () => {
    expect(() => parseSemver(undefined as unknown as string)).toThrow(SemverError);
  });

  it("rejects assorted non-string input types with a helpful coerced message", () => {
    // String(input) must not itself throw for any of these, and the offending
    // value must be surfaced in SemverError.input via String() coercion.
    const cases: Array<{ input: unknown; shows: string }> = [
      { input: 123, shows: "123" },
      { input: null, shows: "null" },
      { input: { major: 1 }, shows: "[object Object]" },
      { input: [1, 2, 3], shows: "1,2,3" },
      { input: true, shows: "true" },
      { input: Symbol("v1"), shows: "Symbol(v1)" },
    ];
    for (const { input, shows } of cases) {
      let caught: unknown;
      expect(() => {
        try {
          parseSemver(input as unknown as string);
        } catch (e) {
          caught = e;
          throw e;
        }
      }).toThrow(SemverError);
      const err = caught as SemverError;
      expect(err.input).toBe(shows);
      expect(err.message).toContain("not a string");
    }
  });

  it("is lenient on leading-zero numeric pre-release ids (kept as strings)", () => {
    // §9 says '01' is invalid; this comparison-only lib deliberately keeps it
    // as a string identifier rather than throwing. Pin that contract.
    const parsed = parseSemver("1.0.0-01");
    expect(parsed.prerelease).toEqual(["01"]);
    // Round-trips losslessly because it stayed a string.
    expect(formatSemver(parsed)).toBe("1.0.0-01");
    // A plain '0' (length 1, no leading-zero problem) is still numeric.
    expect(parseSemver("1.0.0-0").prerelease).toEqual([0]);
    // As an alphanumeric identifier, '01' sorts ABOVE a purely-numeric one.
    expect(
      compareSemver(parseSemver("1.0.0-01"), parseSemver("1.0.0-1"))
    ).toBe(1);
  });

  it("SemverError carries expected + input fields", () => {
    try {
      parseSemver("1.x.0");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SemverError);
      const err = e as SemverError;
      expect(err.input).toBe("1.x.0");
      expect(err.expected).toContain("dot-separated");
    }
  });
});

describe("formatSemver round-trip", () => {
  const roundtrip = ["3.4.5", "0.0.0", "1.2.3-rc.1", "2.0.0-alpha.1", "1.0.0-0"];
  for (const v of roundtrip) {
    it(`round-trips ${v}`, () => {
      expect(formatSemver(parseSemver(v))).toBe(v);
    });
  }
});

describe("compareSemver ordering table", () => {
  // Each row: a, b, expected sign of compare(a, b).
  const rows: Array<[string, string, -1 | 0 | 1]> = [
    ["1.0.0", "2.0.0", -1],
    ["2.0.0", "1.0.0", 1],
    ["1.0.0", "1.1.0", -1],
    ["1.1.0", "1.1.1", -1],
    ["1.2.3", "1.2.3", 0],
    // Pre-release sorts below its release (SemVer 2.0 §11).
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0", "1.0.0-alpha", 1],
    // Field-by-field pre-release precedence.
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    ["1.0.0-alpha.beta", "1.0.0-beta", -1],
    ["1.0.0-beta", "1.0.0-beta.2", -1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-beta.11", "1.0.0-rc.1", -1],
    ["1.0.0-rc.1", "1.0.0", -1],
    // Numeric identifiers sort below alphanumeric.
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-rc.1", "1.0.0-rc.1", 0],
  ];

  for (const [a, b, expected] of rows) {
    it(`compare(${a}, ${b}) === ${expected}`, () => {
      expect(compareSemver(parseSemver(a), parseSemver(b))).toBe(expected);
    });
  }

  it("the canonical SemVer §11 chain sorts ascending", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    const shuffled = [...chain].reverse();
    shuffled.sort((x, y) => compareSemver(parseSemver(x), parseSemver(y)));
    expect(shuffled).toEqual(chain);
  });

  it("compareVersions works on raw strings", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("compareVersions propagates SemverError from a malformed operand", () => {
    // Delegates to parseSemver for both operands; a bad input on either side
    // must surface as a SemverError rather than a silent NaN comparison.
    expect(() => compareVersions("1.x.0", "1.0.0")).toThrow(SemverError);
    expect(() => compareVersions("1.0.0", "not-a-version")).toThrow(SemverError);
    expect(() =>
      compareVersions(undefined as unknown as string, "1.0.0")
    ).toThrow(SemverError);
  });
});

describe("satisfies", () => {
  it("matches wildcards and empty range", () => {
    expect(satisfies("1.2.3", "*")).toBe(true);
    expect(satisfies("1.2.3", "")).toBe(true);
  });

  it("matches exact version", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "1.2.4")).toBe(false);
  });

  it("matches >= and >", () => {
    expect(satisfies("1.2.3", ">=1.2.0")).toBe(true);
    expect(satisfies("1.2.3", ">=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
  });

  it("matches <= and <", () => {
    expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
    expect(satisfies("1.2.2", "<1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "<1.2.3")).toBe(false);
  });

  it("matches caret range (same major)", () => {
    expect(satisfies("1.5.3", "^1.2.0")).toBe(true);
    expect(satisfies("1.2.0", "^1.2.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfies("1.1.0", "^1.2.0")).toBe(false);
  });

  it("matches tilde range (same major.minor)", () => {
    expect(satisfies("1.2.5", "~1.2.0")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfies("1.2.0", "~1.2.0")).toBe(true);
  });

  it("orders pre-releases below their release in bounds", () => {
    expect(satisfies("1.0.0-rc.1", "<1.0.0")).toBe(true);
    expect(satisfies("1.0.0-rc.1", ">=1.0.0")).toBe(false);
  });

  it("throws on a malformed range", () => {
    expect(() => satisfies("1.0.0", "not-a-range")).toThrow(SemverError);
  });
});
