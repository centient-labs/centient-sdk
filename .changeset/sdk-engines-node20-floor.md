---
"@centient/sdk": minor
---

Raise `engines.node` to `>=20.0.0` (was `>=18.0.0`).

The SDK's per-request timeout and connection-establishment abort are built on
the global `fetch` API with `AbortController` / `AbortSignal`. Those WHATWG
`fetch` semantics are what the timeout and abort paths depend on, and the rest
of the monorepo (`@centient/events`, `@centient/wal`) plus the repo's stated
support floor already require Node 20. This aligns the SDK's declared floor with
the runtime it is actually built and tested against and makes the dependency on
conformant global `fetch`/`AbortSignal` explicit.

No source, type, or runtime-behavior change — but raising the published
`engines.node` floor is **consumer-visible**: the last published `@centient/sdk`
declares `>=18.0.0`, so Node 18 installers will now see an `EBADENGINE` warning
(and a hard failure under `--engine-strict`). That is a tightening of the
supported-runtime contract, so this ships as a **minor** bump rather than a
patch.
