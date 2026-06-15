/**
 * Shimmer Types (engram `/v1/shimmers`, ADR-027 / engram-server #931, #933)
 *
 * A *shimmer* is node-local, TTL-backed operational state — what engram is
 * *doing right now* (in contrast to a crystal, what it *remembers*). Three
 * record types, each with its own write semantic:
 *
 *  - **lock** — CAS acquire / hold / renew + TTL lease; the `ownerToken` is the
 *    holder's release/renew capability.
 *  - **heartbeat** — last-writer-wins overwrite + TTL liveness window; NEVER CAS.
 *  - **ipc** — write-once + atomic exactly-once delete-on-consume + TTL backstop.
 *
 * **Security (engram-server #933 P1):** a lock's `ownerToken` is REDACTED to
 * `null` on every response a non-owner can observe — reads (`get`) and 409
 * CAS-conflict bodies. The token is echoed back ONLY on a successful
 * acquire/renew, and only the value the caller itself supplied. The read shape
 * ({@link ShimmerRead}) therefore carries no owner token by construction.
 */

/**
 * The three shimmer record types.
 *  - `lock`: CAS acquire/hold/renew/release + TTL lease.
 *  - `heartbeat`: overwrite / last-writer-wins + TTL liveness window (never CAS).
 *  - `ipc`: write-once + atomic exactly-once delete-on-consume + TTL backstop.
 */
export type ShimmerRecordType = "lock" | "heartbeat" | "ipc";

/**
 * A shimmer record as returned by an acquire/renew success — the only response
 * that may carry an `ownerToken` (the caller's own, echoed back). For lock
 * acquire/renew the token is non-null; for heartbeat/ipc it is always null.
 */
export interface Shimmer {
  recordType: ShimmerRecordType;
  recordKey: string;
  /** Opaque JSON payload stored verbatim (defaults to `{}` server-side). */
  value: unknown;
  /**
   * A lock's owner token — its release/renew capability. Non-null ONLY on a
   * successful lock acquire/renew (echoing the token the caller supplied).
   * Always null for heartbeat/ipc.
   */
  ownerToken: string | null;
  /** Monotonic revision; CAS guard for lock renew. */
  revision: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
  /** ISO 8601 TTL fade time. */
  fadesAt: string;
}

/**
 * A shimmer as returned by a TTL-filtered read ({@link Shimmers.get}). Identical
 * to {@link Shimmer} except the `ownerToken` is ALWAYS `null` — a reader never
 * learns another client's lock token (engram-server #933 P1). Typed as a
 * literal `null` so callers cannot accidentally depend on a token on a read.
 */
export interface ShimmerRead extends Omit<Shimmer, "ownerToken"> {
  /** Always `null` on a read — a lock's owner token is never echoed to a reader. */
  ownerToken: null;
}

/**
 * Result of a DELETE — lock release or ipc consume.
 *  - lock release: `released` is true iff an owner-matched live lock was deleted;
 *    `consumed` is always null.
 *  - ipc consume: `consumed` is the exactly-once consumed record (with its
 *    `ownerToken` redacted to null), or null when no live message existed;
 *    `released` mirrors `consumed !== null`.
 */
export interface ShimmerDeleteResult {
  released: boolean;
  consumed: ShimmerRead | null;
}

/** Options shared by every TTL-bearing write. */
export interface ShimmerTtlOptions {
  /** TTL in seconds (1..86400). */
  ttlSeconds: number;
  /** Opaque JSON payload; defaults to `{}` server-side when omitted. */
  value?: unknown;
}

/** Options for acquiring or renewing a lock. */
export interface AcquireLockParams extends ShimmerTtlOptions {
  /** Holder identity / release-renew capability. Required for locks. */
  ownerToken: string;
}

/** Options for renewing a held lock (CAS). */
export interface RenewLockParams extends AcquireLockParams {
  /** The revision the caller believes it holds; a mismatch is a 409 conflict. */
  expectedRevision: number;
}

/** Options for releasing a lock (owner-guarded). */
export interface ReleaseLockParams {
  /** Must match the live holder; a non-holder gets `released:false`, not an error. */
  ownerToken: string;
}
