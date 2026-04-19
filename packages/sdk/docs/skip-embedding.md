# Skip-embedding optimization (`skipEmbedding`)

`crystals.update` accepts an optional `skipEmbedding: boolean` parameter that tells the server to commit the update **without** regenerating the crystal's embedding. The persisted embedding stays at its previous value; subsequent semantic search returns the (now-stale) prior content.

This is a **compute-cost optimization** for high-frequency updates where the new content is not meaningful to semantic search — heartbeats, lock holders, last-seen timestamps, counters, status flags. Misuse on content-bearing fields silently degrades search quality without surfacing an error.

## Quick start

```typescript
import { createEngramClient } from "@centient/sdk";

const client = createEngramClient();

// Heartbeat update — runs every few seconds. The embedding is meaningless
// for this content, so skip the regen and reclaim the LLM compute.
await client.crystals.update(instanceCrystalId, {
  contentInline: JSON.stringify({ lastHeartbeat: new Date().toISOString() }),
  skipEmbedding: true,
});
```

When `skipEmbedding` is omitted (or `false`), today's behaviour is preserved: every update regenerates the embedding.

## When to use

✅ **Good fits:**
- Heartbeat / liveness timestamps written by long-running daemons
- Lock-holder fields with rapid contention
- Counters (request count, error count, retry count)
- Status flags (`active` / `paused` / `draining`)
- Bookkeeping metadata that no one searches semantically

❌ **Don't use for:**
- Anything a user might type a query about
- Content fields (titles, descriptions, body text)
- Tags or categories that participate in faceted search
- Any field where retrieval quality matters

## Composes with `expectedVersion`

Both flags are independent:

```typescript
// Atomic CAS update + embedding skip — typical for maintainer's
// heartbeat write that must not race with a peer's lock takeover.
await client.crystals.update(instanceCrystalId, {
  contentInline: JSON.stringify({ lastHeartbeat: now, holder: instanceId }),
  expectedVersion: localVersion,
  skipEmbedding: true,
});
```

CAS is still enforced server-side. The embedding is still skipped on success.

## Server requirements

Requires engram-server **>= 0.31.0** (landed via [centient-labs/engram-server#65](https://github.com/centient-labs/engram-server/issues/65)). This SDK release bumps `MIN_SERVER_VERSION` to `0.31.0` so the same floor covers both `expectedVersion` CAS (0.30.0, engram-server#60) and `skipEmbedding` (0.31.0, engram-server#65).

**Older servers silently ignore the field** — the optimization becomes a no-op (embedding regenerates as before). Correctness is unaffected; only the compute saving is lost. A caller pointing this SDK at a pre-0.31.0 server will fail `client.checkCompatibility()` against the pinned floor, not the `skipEmbedding`-specific capability.

### Verifying support at runtime

`client.checkCompatibility()` is the supported way to gate `skipEmbedding` usage. Because `MIN_SERVER_VERSION` now includes the `skipEmbedding`-capable release, a compatible server is a `skipEmbedding`-capable server:

```typescript
const { compatible, serverVersion, minRequired } =
  await client.checkCompatibility();
if (!compatible) {
  throw new Error(
    `Server ${serverVersion} < ${minRequired}; skipEmbedding unavailable`,
  );
}
// safe to use skipEmbedding below
```

If you need a lower-level check against an ad-hoc server, guard the response:

```typescript
const res = await fetch(`${baseUrl}/health`);
if (!res.ok) throw new Error(`health check failed: ${res.status}`);
const health = await res.json();
// health.version is now safely parsed JSON from a 2xx response
```

## What `skipEmbedding` does NOT do

- It does not delete the existing embedding. Searches continue to return the crystal at its old embedding.
- It does not skip the version bump. `vaultVersion`/`version` still increments per the server's normal semantics.
- It does not skip audit-trail emission. Every update flows through the server's standard observability.
- It does not skip integrity checks (CAS, validation, ACL).

## Background

This is **ADR-017 OQ#2** in the maintainer planning docs. Maintainer's instance-heartbeat pattern writes `lastHeartbeat` every few seconds; without `skipEmbedding`, every write would trigger a 50–100ms LLM call to regenerate the embedding for content nobody searches semantically. With `skipEmbedding: true`, that compute is reclaimed entirely.

## References

- [centient-labs/engram-server#65](https://github.com/centient-labs/engram-server/issues/65) — server-side sibling
- [centient-labs/centient-sdk#35](https://github.com/centient-labs/centient-sdk/issues/35) — this SDK feature
- [Optimistic concurrency (`expectedVersion`)](./optimistic-concurrency.md) — composable companion API
- centient-labs/maintainer ADR-017 §Open Questions OQ#2
