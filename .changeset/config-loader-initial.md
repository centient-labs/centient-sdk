---
"@centient/config-loader": minor
---

Add `@centient/config-loader`: layered configuration resolution (env > project file > user file > defaults) with caching, write-back, non-fatal warnings, tilde-app path helpers (0o700 home enforcement), and walk-up project-root discovery. Zero runtime dependencies; injectable fs/env/home/logger. Resolves and layers only — validation schemas stay in consumers. Malformed config files are surfaced as `ConfigError` rather than silently skipped. Factory: `createConfigLoader()`.

Hardening (pre-release, folded into the initial release):

- `configFileMode` option (default `0o600`) makes the write-back file mode configurable instead of unconditionally imposing owner-only permissions; the asserted-on-every-write behaviour is now documented.
- An empty/whitespace `homeDir` (which `os.homedir()` can return when home is undeterminable, and which would otherwise yield a silent cwd-relative path) now throws `ConfigError("INVALID_HOME")`.
- `unflatten()` raises `ConfigError("KEY_CONFLICT")` when dotted keys imply contradictory shapes (e.g. `a.b` and `a.b.c`) instead of silently last-write-wins; write-back inherits this guard.
- `projectMaxWalkUpDepth` loader option / `DiscoveryOptions.maxDepth` makes the project-root walk-up cap configurable (default 64, exported as `DEFAULT_MAX_WALK_UP_DEPTH`) for deeply nested monorepos.
- Documented the deliberate `${VAR}`-collapses-to-`""` deviation from POSIX shell semantics on `expandEnvRefs`.
