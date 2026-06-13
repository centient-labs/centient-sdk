# @centient/cli-utils

Dependency-free CLI primitives shared across Centient command-line tools:

- **Terminal capability detection** — `NO_COLOR` / `FORCE_COLOR` / `TERM`
  precedence with an injectable env record, so detection is unit-testable.
- **ANSI color helpers** — degrade to identity (empty-string) codes when color
  is unsupported.
- **Semver-lite** — `parse` / `compare` / `satisfies` for
  `major.minor.patch[-prerelease]`, no external `semver` dependency.

Zero runtime dependencies. ESM-only.

## Installation

```bash
npm install @centient/cli-utils
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/cli-utils --workspace
```

## Terminal capabilities & color

Detection is split into a **pure core** (takes an injectable `env` record and a
stream descriptor — read no globals) and thin **live-process wrappers** for
ergonomic CLI call sites.

### Color precedence order

`resolveColorSupport(env, isTTY)` resolves color support by this exact
precedence (highest wins):

1. **`FORCE_COLOR` present** (any value, including `""`) → color **ON**
2. **`NO_COLOR` present** (any value, including `""`) → color **OFF**
3. **`TERM === "dumb"`** → color **OFF**, `isDumb = true`
4. **stream is a TTY** → color **ON**
5. **otherwise** → color **OFF**

Presence is tested by key presence (the [NO_COLOR convention](https://no-color.org)):
the variable's mere presence is the signal, regardless of value. A key whose
value is `undefined` counts as **absent**.

```typescript
import {
  detectCapabilities,
  makeAnsiColors,
  colorize,
} from "@centient/cli-utils";

// Pure / testable: pass an env record and a stream descriptor.
const caps = detectCapabilities(process.env, process.stdout);
// caps -> { isTTY, hasColor, isDumb, width }

const colors = makeAnsiColors(caps.hasColor);
console.log(colorize(colors, "green", "ok"));
// "ok" is wrapped in ANSI green when color is enabled, returned unchanged when not.
```

### Live-process convenience wrappers

```typescript
import { detectTerminalCapabilities, createAnsiColors } from "@centient/cli-utils";

const caps = detectTerminalCapabilities("stdout"); // reads process.env + process.stdout
const colors = createAnsiColors();                 // colors for the live stdout
```

### Structured errors

```typescript
import { writeError } from "@centient/cli-utils";

writeError("config not found", "a path to engram.json", "pass --config <path>");
// [ERROR] config not found
//   Expected: a path to engram.json
//   Recovery: pass --config <path>
```

The sink is injectable (`writeError(what, expected, recovery, write?)`),
defaulting to `process.stderr`. Returns void; exit-code handling is the
caller's responsibility.

## Semver-lite

Parses `major.minor.patch` with optional pre-release identifiers and build
metadata. Build metadata is parsed off and ignored for ordering (SemVer 2.0
§10). Pre-releases are ordered per SemVer 2.0 §11 — a pre-release sorts *below*
its release.

```typescript
import {
  parseSemver,
  formatSemver,
  compareSemver,
  compareVersions,
  satisfies,
} from "@centient/cli-utils";

parseSemver("1.2.3-rc.1");
// { major: 1, minor: 2, patch: 3, prerelease: ["rc", 1] }

formatSemver(parseSemver("1.2.3-rc.1")); // "1.2.3-rc.1" (round-trips)

compareVersions("1.0.0-rc.1", "1.0.0"); // -1 (pre-release < release)

satisfies("1.5.3", "^1.2.0"); // true
```

### Supported range forms

No compound ranges, no `||`, no hyphen ranges.

| Range      | Meaning                                       |
|------------|-----------------------------------------------|
| `1.2.3`    | exact match                                   |
| `>=1.2.3`  | inclusive lower bound                         |
| `>1.2.3`   | exclusive lower bound                         |
| `<=1.2.3`  | inclusive upper bound                         |
| `<1.2.3`   | exclusive upper bound                         |
| `^1.2.3`   | caret: same major, at or above (`>=1.2.3 <2.0.0`) |
| `~1.2.3`   | tilde: same major.minor, at or above (`>=1.2.3 <1.3.0`) |
| `*` / `""` | any version                                   |

Malformed versions or ranges throw `SemverError` (carrying `expected` and
`input` fields) rather than degrading silently.

## API

| Export | Description |
|--------|-------------|
| `resolveColorSupport(env, isTTY)` | Pure color-support resolver (the precedence core). |
| `detectCapabilities(env, stream)` | Pure capability detection from an env record + stream descriptor. |
| `detectTerminalCapabilities(stream?)` | Live-process wrapper over `detectCapabilities`. |
| `makeAnsiColors(enabled)` | Pure ANSI color set; empty strings when disabled. |
| `createAnsiColors()` | Live-process wrapper; colors for stdout. |
| `colorize(colors, code, text)` | Wrap text in a code + reset, or identity when disabled. |
| `writeError(what, expected, recovery, write?)` | Three-part structured error to an injectable sink. |
| `parseSemver(input)` | Parse to `SemverTuple`; throws `SemverError`. |
| `formatSemver(v)` | Format back to a string (round-trips `parseSemver`). |
| `compareSemver(a, b)` / `compareVersions(a, b)` | Total-order compare (`-1` / `0` / `1`). |
| `satisfies(version, range)` | Test a version against a range. |

## License

MIT
