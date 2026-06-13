---
"@centient/sdk": patch
---

Raise `engines.node` to `>=20.0.0` (was `>=18.0.0`).

The SDK's per-request timeout and connection-establishment abort are built on
the global `fetch` API with `AbortController` / `AbortSignal`. Those WHATWG
`fetch` semantics are what the timeout and abort paths depend on, and the rest
of the monorepo (`@centient/events`, `@centient/wal`) plus the repo's stated
support floor already require Node 20. This aligns the SDK's declared floor with
the runtime it is actually built and tested against and makes the dependency on
conformant global `fetch`/`AbortSignal` explicit. Metadata-only change: no
source, type, or runtime-behavior change.
