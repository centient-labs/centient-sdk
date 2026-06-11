---
"@centient/sdk": minor
---

Add optional `logger` to `EngramClientConfig` for client-side request
diagnostics. The client previously performed zero logging, so retries,
timeouts, and network errors were invisible to consumers diagnosing hangs vs
retry storms. With a logger injected, the client emits `debug` for each retry
(attempt number, delay, error class, HTTP method + path) and `warn` when
retries are exhausted or a request times out — across all four request paths
(`request`, `_requestRaw`, `_requestRawBody`, `_requestFormData`).

The logger contract is a minimal structural interface (`ClientLogger`,
context-first `debug`/`warn`) that a `@centient/logger` instance satisfies
directly — `@centient/logger` is NOT a runtime dependency (the SDK stays
zero-dependency). Default is a no-op: without a logger the client emits
nothing (no console fallback). All logged context is routed through sanitize
helpers: method + pathname only — never headers (`X-API-Key`,
`Authorization`), request bodies, query strings, or error messages (which can
embed full URLs).
