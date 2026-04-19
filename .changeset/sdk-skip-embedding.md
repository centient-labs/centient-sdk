---
"@centient/sdk": minor
---

Add optional `skipEmbedding: boolean` to `UpdateKnowledgeCrystalParams`. Closes #35.

When set to `true`, the server commits the update without regenerating the crystal's embedding. Use for high-frequency status updates (heartbeats, lock holders, counters, last-seen timestamps) where the embedding is meaningless for semantic search and the regenerate-on-every-write LLM cost is pure waste.

**Composes with `expectedVersion`:** a single update may set both. CAS still enforced; embedding still skipped on success.

**Server requirements:** requires engram-server **>= 0.31.0** (engram-server#65 shipped in 0.31.0). `MIN_SERVER_VERSION` is bumped from `0.30.0` to `0.31.0` in this release — a single floor now gates both `expectedVersion` CAS (engram-server#60 in 0.30.0) and `skipEmbedding` (engram-server#65 in 0.31.0). `client.checkCompatibility()` is now a meaningful runtime gate for `skipEmbedding` usage.

**Older servers silently ignore the field** — the optimization becomes a no-op (embedding regenerates as before). Correctness is unaffected on any server; callers pointing the SDK at a pre-0.31.0 server will fail `checkCompatibility()` against the new floor.

**Default:** omit the field for pre-`skipEmbedding` behavior (server regenerates the embedding). JSDoc guidance: to opt out of the optimization, **omit** rather than passing explicit `false`. The SDK forwards whatever the caller supplies without injecting a default on the wire.

**Docs:** new `packages/sdk/docs/skip-embedding.md` with usage guidance, when-to-use checklist, composition example with `expectedVersion`, runtime-gating example via `checkCompatibility()`, and clear "what this does NOT do" section. Linked from the SDK README.

**Tests:** 5 new crystals.update tests + 5 `checkCompatibility` fixture bumps (0.30 → 0.31 floor). Crystals tests: forwards `skipEmbedding: true`, forwards explicit `false`, omits when field absent (backward compat), composes with `expectedVersion` happy path, composes with `expectedVersion` 409 conflict (still surfaces `CrystalVersionConflictError` via `.rejects.toBeInstanceOf` + `.rejects.toMatchObject`). All field naming is camelCase per ADR-018.

**ADR cross-reference:** pairs with **ADR-017 OQ#2** in the maintainer repo. The SDK can't update a cross-repo ADR directly; the maintainer team owns marking OQ#2 resolved once both sides ship. This PR forwards the decision (passthrough optional field, coordinated `MIN_SERVER_VERSION` floor) without claiming resolution authority over the ADR itself.

Ships together with engram-server 0.31.0.
