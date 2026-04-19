# Optimistic Concurrency (CAS) on Crystal Updates

When multiple processes may mutate the same knowledge crystal concurrently — lock takeover, merge-queue state transitions, schema migrations, or simply two agents writing to a shared crystal — last-write-wins is unsafe. This SDK supports storage-layer **compare-and-swap (CAS)** via the optional `expectedVersion` parameter on `crystals.update`.

## Quick start

```typescript
import { createEngramClient, CrystalVersionConflictError } from "@centient/sdk";

const client = createEngramClient();

const current = await client.crystals.get(crystalId);

try {
  const updated = await client.crystals.update(crystalId, {
    title: "New title",
    expectedVersion: current.version, // server rejects if version has moved
  });
  console.log("applied, new version:", updated.version);
} catch (err) {
  if (err instanceof CrystalVersionConflictError) {
    console.log("conflict; server is at version", err.currentVersion);
  } else {
    throw err;
  }
}
```

When `expectedVersion` is **omitted**, the update is unconditional — identical to pre-CAS behavior. Existing callers require no changes.

## Semantics

- On **match** (`current.version === expectedVersion`): the update succeeds, `version` is incremented atomically server-side, and the returned `KnowledgeCrystal.version` reflects the new value. Use the returned `version` to chain subsequent CAS writes without a re-read.
- On **mismatch**: the server responds with HTTP 409 + error body:
  ```json
  {
    "code": "OPERATION_VERSION_CONFLICT",
    "message": "expected version 7, got 8",
    "currentVersion": 8
  }
  ```
  The SDK surfaces this as `CrystalVersionConflictError` with `err.currentVersion` carrying the server-reported current version so callers can re-fetch, merge, and retry without a second round trip.

## Standard retry loop

```typescript
import { CrystalVersionConflictError } from "@centient/sdk";

async function updateWithRetry(
  client: EngramClient,
  id: string,
  mutate: (crystal: KnowledgeCrystal) => UpdateKnowledgeCrystalParams,
  maxAttempts = 3,
): Promise<KnowledgeCrystal> {
  let attempt = 0;
  while (true) {
    const current = await client.crystals.get(id);
    const patch = mutate(current);
    try {
      return await client.crystals.update(id, {
        ...patch,
        expectedVersion: current.version,
      });
    } catch (err) {
      if (err instanceof CrystalVersionConflictError && attempt < maxAttempts - 1) {
        attempt++;
        continue; // re-read, re-merge, retry
      }
      throw err;
    }
  }
}
```

For high-contention writes, add exponential backoff between attempts — start at 100 ms, double each retry, cap at 3–5 attempts.

## When to use CAS vs. a locker

Application-layer locking (a central lock service, a redis-backed mutex, or process-level serialization) can substitute for CAS in some cases. Prefer CAS when:

- The critical section is a **single crystal write** (the common case).
- Two writers may **both believe they hold the lock** — e.g., lock takeover after a TTL lapse, or split-brain between instances. CAS at the storage layer is the only primitive that guarantees one of them will fail cleanly.
- You want to **tolerate races** (last-write-wins is acceptable after merge) rather than serialize.

Prefer a locker when the critical section spans **multiple resources** or non-crystal side effects (external API calls, file writes), since CAS only protects the single atomic write.

## Server requirements

Requires **engram-server >= 0.30.0** (CAS shipped in engram-server#60). Older servers silently ignore the `expectedVersion` field — the update proceeds unconditionally, effectively the pre-CAS behavior. Callers that *rely* on CAS semantics should verify server compatibility at startup via `client.checkCompatibility()` and refuse to run on too-old servers.

## Not supported (yet)

- **CAS on non-crystal routes** (notes, edges, items, collections). Only `PATCH /crystals/:id` supports `expectedVersion` in this release. File follow-up issues if you need CAS elsewhere.
- **Multi-crystal transactions.** CAS is a single-record primitive. Use an application-layer coordinator if you need atomicity across multiple crystals.
- **Server-side merge / three-way diff.** The server rejects on mismatch; clients decide how to merge. The `currentVersion` on the error lets you re-fetch and apply a custom merge without a second round trip.

## References

- Issue: centient-labs/centient-sdk#29 (SDK)
- Issue: centient-labs/engram-server#60 (server)
- ADR-017 (maintainer) — engram as primary state store, OQ#1
- ADR-014 (maintainer) — internal merge queue (consumer)
- ADR-019 (maintainer) — intra-repo review parallelism (consumer)
