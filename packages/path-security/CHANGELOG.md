# @centient/path-security

## 0.1.0

### Minor Changes

- 17fb0e3: Add `@centient/path-security`: allowed-roots path-traversal validation
  (`validateWithinRoots`), symlink-safe containment (`resolveRealPathWithinRoots`),
  and a single-component sanitizer (`sanitizeComponent`). Result-typed API
  (`ok`/`error` with a machine-readable `PathError.code`); zero runtime
  dependencies. Checks are the strictest-of-seeds across the centient, crucible,
  and soma path utilities, with adversarial table-driven coverage for encoded
  traversal, null bytes, control characters, unicode normalization tricks,
  Windows device/drive/UNC forms, trailing-dot/space confusion, long-path edges,
  and symlink escape. Unexpected `fs.realpath` failures surface as a typed
  `RealpathGuardError` carrying the failing `operation`, `probe` path, and errno
  `code` as first-class properties (original error preserved via `cause`).
