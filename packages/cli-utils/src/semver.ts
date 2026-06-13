/**
 * Semver-lite: parse / compare / satisfies for `major.minor.patch` with
 * optional pre-release identifiers.
 *
 * We intentionally avoid a dependency on the `semver` npm package — every
 * @centient package ships zero external runtime dependencies. Callers here
 * need only a tiny slice: parse, total-order compare, and the handful of
 * range forms below. Build metadata (`+meta`) is parsed and ignored for
 * ordering, matching SemVer 2.0 §10.
 *
 * Reconciled from soma persona `src/semver/parse.ts` + `filter.ts`. Two
 * extensions over that seed, called out because they are a superset:
 *   - pre-release identifiers (`1.2.3-rc.1`) are parsed and ordered per
 *     SemVer 2.0 §11 (a pre-release sorts *below* its release).
 *   - `throw`n errors use a local {@link SemverError} (the seed threw a
 *     persona-specific error type that does not belong in a shared package).
 *
 * Supported range forms (no compound ranges, no `||`, no hyphen ranges):
 *   - `"1.2.3"`   exact match
 *   - `">=1.2.3"` inclusive lower bound
 *   - `">1.2.3"`  exclusive lower bound
 *   - `"<=1.2.3"` inclusive upper bound
 *   - `"<1.2.3"`  exclusive upper bound
 *   - `"^1.2.3"`  caret: same major, at or above the base (>=1.2.3 <2.0.0)
 *   - `"~1.2.3"`  tilde: same major.minor, at or above the base (>=1.2.3 <1.3.0)
 *   - `"*"` / `""` any version
 */

/** Thrown when a version or range string cannot be parsed. */
export class SemverError extends Error {
  /** What a valid input would have looked like. */
  readonly expected: string;
  /** The offending input. */
  readonly input: string;

  constructor(message: string, expected: string, input: string) {
    super(message);
    this.name = "SemverError";
    this.expected = expected;
    this.input = input;
  }
}

/** A parsed semantic version. `prerelease` is `[]` for a release version. */
export interface SemverTuple {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, e.g. `["rc", "1"]`. Empty for releases. */
  prerelease: readonly (string | number)[];
}

const NUMERIC = /^\d+$/;
const PRERELEASE_ID = /^[0-9A-Za-z-]+$/;

/**
 * Parse a `major.minor.patch[-prerelease][+build]` string into a
 * {@link SemverTuple}. Build metadata is parsed off and discarded. Throws
 * {@link SemverError} on malformed input rather than degrading silently.
 */
export function parseSemver(input: string): SemverTuple {
  if (typeof input !== "string") {
    throw new SemverError(
      "semver input was not a string",
      "a 'major.minor.patch' version string such as '1.2.3'",
      String(input)
    );
  }
  const trimmed = input.trim();

  // Strip build metadata (everything from the first '+'); it does not affect
  // identity or ordering (SemVer 2.0 §10).
  const plusIdx = trimmed.indexOf("+");
  const withoutBuild = plusIdx === -1 ? trimmed : trimmed.slice(0, plusIdx);

  // Split off the pre-release section (everything after the first '-').
  const dashIdx = withoutBuild.indexOf("-");
  const core = dashIdx === -1 ? withoutBuild : withoutBuild.slice(0, dashIdx);
  const preRaw = dashIdx === -1 ? "" : withoutBuild.slice(dashIdx + 1);

  const parts = core.split(".");
  if (parts.length !== 3 || !parts.every((p) => NUMERIC.test(p))) {
    throw new SemverError(
      `'${input}' is not a valid semver`,
      "three dot-separated non-negative integers (e.g. '2.1.0'), optionally with a '-prerelease' suffix",
      input
    );
  }

  const [major, minor, patch] = parts.map((p) => Number.parseInt(p, 10)) as [
    number,
    number,
    number,
  ];

  const prerelease = parsePrerelease(preRaw, input);
  return { major, minor, patch, prerelease };
}

function parsePrerelease(
  preRaw: string,
  input: string
): readonly (string | number)[] {
  if (preRaw === "") return [];
  const ids = preRaw.split(".");
  return ids.map((id) => {
    if (!PRERELEASE_ID.test(id)) {
      throw new SemverError(
        `'${input}' has an invalid pre-release identifier '${id}'`,
        "pre-release identifiers matching [0-9A-Za-z-] separated by dots (e.g. '1.2.3-rc.1')",
        input
      );
    }
    // Numeric identifiers compare numerically; leading-zero numerics are
    // invalid per SemVer 2.0 §9, but we keep them as strings rather than
    // rejecting — being lenient on read is safe for a comparison-only lib.
    if (NUMERIC.test(id) && !(id.length > 1 && id.startsWith("0"))) {
      return Number.parseInt(id, 10);
    }
    return id;
  });
}

/** Format a {@link SemverTuple} back to a string. Round-trips {@link parseSemver}. */
export function formatSemver(v: SemverTuple): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length === 0) return core;
  return `${core}-${v.prerelease.join(".")}`;
}

/**
 * Compare two versions. Returns -1 if `a < b`, 0 if equal, 1 if `a > b`.
 *
 * Ordering follows SemVer 2.0 §11: compare major, minor, patch numerically;
 * then a version *with* a pre-release sorts below the otherwise-equal release.
 * Pre-release identifiers are compared field-by-field — numeric identifiers
 * compare numerically and always sort below alphanumeric ones; a longer
 * identifier list wins when all preceding fields are equal.
 */
export function compareSemver(a: SemverTuple, b: SemverTuple): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(
  a: readonly (string | number)[],
  b: readonly (string | number)[]
): -1 | 0 | 1 {
  // A release (no pre-release) outranks a pre-release of the same core.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePreId(a[i]!, b[i]!);
    if (cmp !== 0) return cmp;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function comparePreId(a: string | number, b: string | number): -1 | 0 | 1 {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  if (aNum && bNum) {
    if (a === b) return 0;
    return (a as number) < (b as number) ? -1 : 1;
  }
  const as = a as string;
  const bs = b as string;
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

/** Convenience comparator over version strings. Parses both, then compares. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return compareSemver(parseSemver(a), parseSemver(b));
}

/**
 * Check whether `version` satisfies `range`. See the module header for the
 * full list of supported range forms. Throws {@link SemverError} when either
 * the version or the range is malformed.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version);
  const r = (range ?? "").trim();

  if (r === "" || r === "*") return true;

  if (r.startsWith(">=")) {
    return compareSemver(v, parseSemver(r.slice(2))) >= 0;
  }
  if (r.startsWith("<=")) {
    return compareSemver(v, parseSemver(r.slice(2))) <= 0;
  }
  if (r.startsWith(">")) {
    return compareSemver(v, parseSemver(r.slice(1))) > 0;
  }
  if (r.startsWith("<")) {
    return compareSemver(v, parseSemver(r.slice(1))) < 0;
  }
  if (r.startsWith("^")) {
    const base = parseSemver(r.slice(1));
    if (compareSemver(v, base) < 0) return false;
    return v.major === base.major;
  }
  if (r.startsWith("~")) {
    const base = parseSemver(r.slice(1));
    if (compareSemver(v, base) < 0) return false;
    return v.major === base.major && v.minor === base.minor;
  }

  // Fallback: a bare version string is treated as an exact match.
  return compareSemver(v, parseSemver(r)) === 0;
}
