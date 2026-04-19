---
"@centient/sdk": minor
---

Add optional `skipEmbedding: boolean` to `UpdateKnowledgeCrystalParams`. Closes #35.

When set to `true`, the server commits the update without regenerating the crystal's embedding. Use for high-frequency status updates (heartbeats, lock holders, counters, last-seen timestamps) where the embedding is meaningless for semantic search and the regenerate-on-every-write LLM cost is pure waste.

**Composes with `expectedVersion`:** a single update may set both. CAS still enforced; embedding still skipped on success.

**Server requirements:** requires engram-server with `skipEmbedding` support on `PATCH /crystals/:id` (engram-server#65). **Older servers silently ignore the field** — the optimization becomes a no-op (embedding regenerates as before). Correctness is unaffected; only the compute saving is lost. This is intentional so the SDK can ship without coordinating a flag-day server upgrade. `MIN_SERVER_VERSION` will be bumped in a follow-up release once engram-server#65 lands and the version is known.

**Default:** `false` (regenerate embedding on every update — pre-`skipEmbedding` behavior). Fully backward compatible.

**Docs:** new `packages/sdk/docs/skip-embedding.md` with usage guidance, when-to-use checklist, composition example with `expectedVersion`, and clear "what this does NOT do" section. Linked from the SDK README.

**Tests:** 5 new — forwards `skipEmbedding: true`, forwards explicit `false`, omits when not supplied (backward compat), composes with `expectedVersion` happy path, composes with `expectedVersion` 409 conflict (still surfaces `CrystalVersionConflictError`). All field naming is camelCase per ADR-018.

**Tracking:** `TODO(skipEmbedding)` comment added at `packages/sdk/src/client.ts` adjacent to `MIN_SERVER_VERSION` so the pending version bump surfaces during normal code review once engram-server#65 ships.

**ADR cross-reference:** pairs with **ADR-017 OQ#2** in the maintainer repo. The SDK can't update a cross-repo ADR directly; the maintainer team owns marking OQ#2 resolved once both sides ship. This PR forwards the decision (passthrough optional field, intentional silent no-op on older servers) without claiming resolution authority over the ADR itself.

Pairs with engram-server#65; ship them together. A follow-up SDK patch bumps `MIN_SERVER_VERSION` to the engram-server release that lands #65.
