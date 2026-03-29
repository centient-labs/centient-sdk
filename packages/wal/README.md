# @centient/wal

Shared Write-Ahead Log (WAL) for crash recovery across Engram packages. Provides an append-only JSONL log with atomic writes, per-file serialization, idempotent replay, and dead-letter handling.

## Installation

```bash
npm install @centient/wal
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/wal --workspace
```

## WAL Lifecycle

The WAL follows a four-step cycle:

1. **Append** — Before executing an operation, log it (`confirmed: false`)
2. **Execute** — Run the operation
3. **Confirm** — On success, mark the entry confirmed (`confirmed: true`)
4. **Compact** — Periodically remove confirmed entries to keep the file small

On crash or restart, unconfirmed entries are replayed via `replayUnconfirmed`. Each entry carries a UUID `operationId`; executors must be idempotent so replaying the same entry twice produces no duplicate side effects.

## Quick Start

```typescript
import {
  getWalPath,
  appendEntry,
  confirmEntry,
  replayAndCompact,
} from "@centient/wal";

const walDir = "/var/data/wal";
const scopeId = "550e8400-e29b-41d4-a716-446655440000"; // UUID for this scope
const walPath = getWalPath(walDir, scopeId);

// 1. Before executing an operation, append a WAL entry
const append = await appendEntry(walPath, {
  type: "sync_entity",
  scopeId,
  payload: { entityId: "ent-123", action: "upsert" },
});

if (!append.success) {
  throw new Error(append.error);
}

// 2. Execute the operation
await upsertEntity("ent-123");

// 3. Confirm success
await confirmEntry(walPath, append.operationId);

// --- On restart: replay anything that was never confirmed ---
const result = await replayAndCompact(walPath, async (entry) => {
  if (entry.type === "sync_entity") {
    const { entityId, action } = entry.payload as { entityId: string; action: string };
    await upsertEntity(entityId);
    return true; // signal success
  }
  return false;
});

console.log(`Replayed: ${result.replay.replayedCount}, failed: ${result.replay.failedCount}`);
```

## API Reference

All functions are async and return structured result objects with a `success` boolean and an optional `error` string. No function throws on expected error conditions.

### `getWalPath(walDir, scopeId): string`

Build the WAL file path for a scope. Files are stored as `{walDir}/{scopeId}.jsonl`.

```typescript
const walPath = getWalPath("/var/data/wal", "550e8400-e29b-41d4-a716-446655440000");
// "/var/data/wal/550e8400-e29b-41d4-a716-446655440000.jsonl"
```

### `appendEntry(walPath, input, options?): Promise<WALAppendResult>`

Append a new entry to the WAL. Generates a UUID v4 `operationId` and ISO 8601 timestamp automatically. Creates the WAL directory if it does not exist. Uses `appendFile` which is atomic on POSIX systems.

```typescript
const result = await appendEntry(walPath, {
  type: "my_operation",
  scopeId: "550e8400-...",
  stage: "ingest",   // optional
  phase: 1,          // optional
  payload: { key: "value" },
});
// result.operationId — the generated UUID to pass to confirmEntry
// result.autoConfirmed — true if autoConfirm option was used
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `autoConfirm` | `boolean` | Write the entry with `confirmed: true`. Use for fire-and-forget audit trails that do not need replay. |

### `readEntries(walPath): Promise<WALReadResult>`

Read all entries from a WAL file. A missing file returns success with an empty array — no WAL means no prior operations. Malformed or structurally invalid JSON lines are skipped with a warning.

```typescript
const result = await readEntries(walPath);
// result.entries — all WALEntry objects in file order (chronological)
```

### `confirmEntry(walPath, operationId): Promise<WALConfirmResult>`

Mark a WAL entry as confirmed. Reads all entries, sets `confirmed: true` for the matching `operationId`, and rewrites the file atomically. Serialized per-path via an in-process mutex to prevent TOCTOU races from concurrent confirm calls on the same file.

```typescript
const result = await confirmEntry(walPath, append.operationId);
if (!result.success) {
  console.error(result.error);
}
```

### `getUnconfirmedEntries(walPath): Promise<WALReadResult>`

Convenience wrapper around `readEntries` that filters to only entries where `confirmed === false`. Useful for checking pending work without running a full replay.

```typescript
const result = await getUnconfirmedEntries(walPath);
console.log(`${result.entries.length} entries pending`);
```

### `compactWal(walPath): Promise<WALCompactResult>`

Remove all confirmed entries from the WAL file. Reads the file, filters out confirmed entries, and rewrites atomically. Serialized per-path via the same mutex as `confirmEntry`. Safe to call at any time; if the file does not exist, returns success with zero counts.

```typescript
const result = await compactWal(walPath);
// result.removed  — count of confirmed entries removed
// result.remaining — count of unconfirmed entries kept
```

### `replayUnconfirmed(walPath, executor, options?): Promise<ReplayResult>`

Replay all unconfirmed entries in chronological order. For each entry, calls the executor, confirms on success, or increments a retry count on failure. Once an entry reaches `maxRetries` failures it is dead-lettered (see below). A failure on one entry does not abort replay of subsequent entries.

```typescript
const result = await replayUnconfirmed(walPath, async (entry) => {
  // Return true on success, false on failure. Throwing also counts as failure.
  return await processEntry(entry);
}, { maxRetries: 3 });

// result.totalEntries      — all entries in the WAL
// result.unconfirmedCount  — entries that needed replay
// result.replayedCount     — successfully replayed and confirmed
// result.failedCount       — failed this pass (will retry next pass)
// result.deadLetteredCount — moved to dead-letter queue
// result.results           — per-entry ReplayEntryResult[]
```

**Options (`ReplayOptions`):**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `5` | Max attempts before dead-lettering. Clamped to `[1, 100]`. Overrides `WAL_MAX_RETRIES` env var. |

The executor (`WALExecutor`) has the signature:

```typescript
type WALExecutor = (entry: WALEntry) => Promise<boolean>;
```

### `replayAndCompact(walPath, executor, options?): Promise<ReplayAndCompactResult>`

Convenience function combining `replayUnconfirmed` followed by `compactWal`. The returned object contains both result objects:

```typescript
const { replay, compact } = await replayAndCompact(walPath, executor);
```

### `cleanupOrphanedTempFiles(walDir): Promise<void>`

Delete orphaned `.tmp` files left by processes that crashed during an atomic write. Globs `*.jsonl.*.tmp` in `walDir` and removes them. Best-effort: logs warnings on individual failures but does not throw.

Call this once at startup before any replay.

```typescript
await cleanupOrphanedTempFiles("/var/data/wal");
```

### `validateScopeId(scopeId): WALValidationResult`

Validate that a scope ID is safe for use in filesystem paths. Accepts only hex characters and hyphens (`[0-9a-f-]`) — the character set expected for UUIDs. Rejects empty strings, path traversal sequences, and other special characters.

```typescript
const v = validateScopeId("550e8400-e29b-41d4-a716-446655440000");
// v.success === true

const bad = validateScopeId("../etc/passwd");
// bad.success === false, bad.error contains the reason
```

### `isWALEntry(obj): obj is WALEntry`

Runtime type guard for values parsed from JSON. Checks that `operationId`, `type`, and `confirmed` are present with the correct types. Used internally by `readEntries` to skip malformed lines; also available for callers who parse WAL content themselves.

```typescript
import { isWALEntry } from "@centient/wal";

const parsed = JSON.parse(line);
if (isWALEntry(parsed)) {
  // parsed is WALEntry
}
```

### `clearRetryCounts(): void`

**@internal** — Intended for test isolation only.

Clears the module-level retry count map used by `replayUnconfirmed`. Retry counts persist across calls by design (so a per-restart replay loop can accumulate toward `maxRetries`). Call this in `beforeEach` to prevent count bleed between tests.

```typescript
import { clearRetryCounts } from "@centient/wal";

beforeEach(() => {
  clearRetryCounts();
});
```

## Dead-Letter Mechanism

When an entry fails `maxRetries` times across successive `replayUnconfirmed` calls, the WAL automatically:

1. Confirms the original entry (removes it from future replay)
2. Appends a new entry of type `dead_letter` (written with `autoConfirm: true`) containing a `DeadLetterPayload`

Dead-lettered entries appear in `ReplayResult.deadLetteredCount` and are reported as `success: true, skipped: true` in the per-entry results. After compaction, both the original entry and the dead-letter record are removed from the file.

Inspect dead-lettered entries by reading the WAL before compaction:

```typescript
const { entries } = await readEntries(walPath);
const deadLetters = entries.filter((e) => e.type === "dead_letter");
```

### `WAL_MAX_RETRIES` environment variable

Sets the default `maxRetries` for all `replayUnconfirmed` calls that do not pass an explicit `options.maxRetries`. Values are clamped to `[1, 100]`. Explicit `options.maxRetries` always takes precedence.

```bash
WAL_MAX_RETRIES=10 node server.js
```

## Crash Safety

Two mechanisms protect against data corruption:

**Mutex serialization.** `confirmEntry` and `compactWal` both run under a per-path promise-chain mutex. Concurrent calls on the same file are serialized; calls on different files run in parallel.

**Atomic writes.** All file rewrites (confirm, compact) use a write-to-temp-then-rename pattern. `rename(2)` is atomic on the same filesystem, so a crash mid-write leaves the original file intact rather than a truncated one. Orphaned `.tmp` files from prior crashes are cleaned up by `cleanupOrphanedTempFiles`.

`appendEntry` uses `appendFile`, which is atomic for single-line appends on POSIX systems and does not require the mutex.

## Types

```typescript
// Core entry shape stored in the JSONL file
interface WALEntry {
  operationId: string;   // UUID v4, auto-generated
  timestamp: string;     // ISO 8601, auto-generated
  type: WALEntryType;    // Caller-defined string discriminant
  scopeId: string;       // Scope identifier (UUID hex + hyphens)
  stage?: string;        // Optional stage name
  phase?: number;        // Optional phase number
  payload: unknown;      // Operation-specific data (JSON-serializable)
  confirmed: boolean;    // True once successfully executed
}

// Input to appendEntry (auto-generated fields omitted)
type WALEntryInput = Omit<WALEntry, "operationId" | "timestamp" | "confirmed">;

type WALEntryType = string;

// Result types
interface WALAppendResult   { success: boolean; operationId: string; autoConfirmed: boolean; error?: string; }
interface WALConfirmResult  { success: boolean; error?: string; }
interface WALReadResult     { success: boolean; entries: WALEntry[]; error?: string; }
interface WALValidationResult { success: boolean; error?: string; }
interface WALCompactResult  { success: boolean; removed: number; remaining: number; error?: string; }

// Replay
interface ReplayOptions     { maxRetries?: number; }
interface ReplayEntryResult { operationId: string; success: boolean; skipped: boolean; error?: string; }
interface ReplayResult {
  success: boolean;
  totalEntries: number;
  unconfirmedCount: number;
  replayedCount: number;
  failedCount: number;
  deadLetteredCount: number;
  results: ReplayEntryResult[];
  error?: string;
}
interface ReplayAndCompactResult { replay: ReplayResult; compact: WALCompactResult; }
type WALExecutor = (entry: WALEntry) => Promise<boolean>;

// Dead-letter payload (entry.payload when entry.type === "dead_letter")
interface DeadLetterPayload {
  originalOperationId: string;
  originalType: string;
  failureCount: number;
  lastError?: string;
  deadLetteredAt: string;
}
```

## License

MIT
