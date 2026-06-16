# @centient/cli-utils

## 0.1.0

### Minor Changes

- 4f02556: New package: dependency-free CLI primitives harvested from duplicated copies
  across the platform.

  - Terminal capability detection with documented `FORCE_COLOR` > `NO_COLOR` >
    `TERM=dumb` > `isTTY` > default precedence, split into a pure injectable-env
    core (`resolveColorSupport`, `detectCapabilities`) and live-process wrappers.
  - ANSI color helpers (`makeAnsiColors`, `createAnsiColors`, `colorize`) that
    degrade to identity functions when color is unsupported, plus a structured
    three-part `writeError` whose default `process.stderr` sink is exported as
    the named `defaultErrorSink` constant for testability.
  - Semver-lite (`parseSemver`, `formatSemver`, `compareSemver`,
    `compareVersions`, `satisfies`) for `major.minor.patch` with SemVer 2.0
    §11 pre-release ordering and the caret/tilde/comparator range forms — no
    external `semver` dependency.
