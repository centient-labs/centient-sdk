---
"@centient/config-loader": minor
---

Add `@centient/config-loader`: layered configuration resolution (env > project file > user file > defaults) with caching, write-back, non-fatal warnings, tilde-app path helpers (0o700 home enforcement), and walk-up project-root discovery. Zero runtime dependencies; injectable fs/env/home/logger. Resolves and layers only — validation schemas stay in consumers. Malformed config files are surfaced as `ConfigError` rather than silently skipped. Factory: `createConfigLoader()`.
