/**
 * Shimmers Resource (engram `/v1/shimmers`, ADR-027 / engram-server #931, #933)
 *
 * Ergonomic, use-case-named wrappers over the per-type shimmer write semantics.
 * A shimmer is node-local, TTL-backed operational state: locks (CAS), heartbeats
 * (overwrite), and ipc (write-once + exactly-once consume).
 *
 * Endpoint mapping:
 *   - `heartbeat(key, ...)`     → POST  /v1/shimmers              (recordType: heartbeat)
 *   - `acquireLock(key, ...)`   → POST  /v1/shimmers              (recordType: lock, fresh acquire)
 *   - `renewLock(key, ...)`     → PUT   /v1/shimmers/:key         (recordType: lock, CAS renew)
 *   - `releaseLock(key, ...)`   → DELETE /v1/shimmers/:key?recordType=lock&ownerToken=…
 *   - `emitIpc(key, ...)`       → POST  /v1/shimmers              (recordType: ipc, write-once)
 *   - `consumeIpc(key)`         → DELETE /v1/shimmers/:key?recordType=ipc  (atomic exactly-once)
 *   - `get(key, recordType)`    → GET   /v1/shimmers/:key?recordType=…     (TTL-filtered read)
 *
 * The ENTIRE surface requires a WRITE-scoped key (shimmer state is operational,
 * not readable knowledge — engram-server #933 P2) and answers 503
 * {@link ShimmerDisabledError} when `ENGRAM_SHIMMER_ENABLED` is off. Lock
 * acquire/renew CAS failures and ipc write-once collisions surface as
 * {@link ShimmerCasConflictError} (409).
 */

import { unwrapData } from "../validate.js";
import type {
  AcquireLockParams,
  ReleaseLockParams,
  RenewLockParams,
  Shimmer,
  ShimmerDeleteResult,
  ShimmerRead,
  ShimmerRecordType,
} from "../types/shimmer.js";
import { BaseResource } from "./base.js";

// Re-export the shimmer types so consumers can import them alongside the
// resource (and so `resources/index.ts` can surface them).
export type {
  AcquireLockParams,
  ReleaseLockParams,
  RenewLockParams,
  Shimmer,
  ShimmerDeleteResult,
  ShimmerRead,
  ShimmerRecordType,
  ShimmerTtlOptions,
} from "../types/shimmer.js";

const RESOURCE = "shimmers";

interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    timing?: { durationMs: number };
  };
}

/**
 * Shimmers Resource — node-local TTL-backed operational state (locks, heartbeats,
 * ipc). Attached as `client.shimmers`.
 */
export class ShimmersResource extends BaseResource {
  /**
   * Emit/refresh a heartbeat: unconditional overwrite + TTL liveness window.
   * Last-writer-wins — a heartbeat NEVER conflicts (the #1338 wedge fix).
   *
   * @param key - the caller-chosen record key
   * @param value - opaque JSON payload (defaults to `{}` server-side)
   * @param options - `{ ttlSeconds }` (1..86400)
   */
  async heartbeat(
    key: string,
    value: unknown,
    options: { ttlSeconds: number },
  ): Promise<Shimmer> {
    const response = await this.request<ApiSuccessResponse<Shimmer>>(
      "POST",
      "/v1/shimmers",
      { recordType: "heartbeat", key, ttlSeconds: options.ttlSeconds, value },
    );
    return unwrapData(response, "POST /v1/shimmers", RESOURCE);
  }

  /**
   * Acquire a lock if it is free (CAS acquire-if-absent). The returned record
   * echoes back the `ownerToken` you supplied — keep it; it is the capability
   * required to renew or release.
   *
   * @throws {ShimmerCasConflictError} 409 — the lock is already held by another
   *   live owner (the holder's token is NOT exposed).
   */
  async acquireLock(key: string, params: AcquireLockParams): Promise<Shimmer> {
    const response = await this.request<ApiSuccessResponse<Shimmer>>(
      "POST",
      "/v1/shimmers",
      {
        recordType: "lock",
        key,
        ownerToken: params.ownerToken,
        ttlSeconds: params.ttlSeconds,
        value: params.value,
      },
    );
    return unwrapData(response, "POST /v1/shimmers", RESOURCE);
  }

  /**
   * Renew a held lock (CAS): the supplied `expectedRevision` and `ownerToken`
   * must match the live holder. On success the lease is extended and the
   * revision advances. The returned record echoes back your own `ownerToken`.
   *
   * @throws {ShimmerCasConflictError} 409 — the revision/owner did not match the
   *   live holder.
   */
  async renewLock(key: string, params: RenewLockParams): Promise<Shimmer> {
    const response = await this.request<ApiSuccessResponse<Shimmer>>(
      "PUT",
      `/v1/shimmers/${encodeURIComponent(key)}`,
      {
        recordType: "lock",
        ownerToken: params.ownerToken,
        expectedRevision: params.expectedRevision,
        ttlSeconds: params.ttlSeconds,
        value: params.value,
      },
    );
    return unwrapData(response, `PUT /v1/shimmers/${key}`, RESOURCE);
  }

  /**
   * Release a lock (owner-guarded). `released` is true iff a live lock held by
   * the supplied owner was deleted; a non-holder gets `released:false` (not an
   * error). `consumed` is always null for a lock release.
   */
  async releaseLock(
    key: string,
    params: ReleaseLockParams,
  ): Promise<ShimmerDeleteResult> {
    const query = new URLSearchParams({
      recordType: "lock",
      ownerToken: params.ownerToken,
    });
    const path = `/v1/shimmers/${encodeURIComponent(key)}?${query.toString()}`;
    const response = await this.request<ApiSuccessResponse<ShimmerDeleteResult>>(
      "DELETE",
      path,
    );
    return unwrapData(response, `DELETE /v1/shimmers/${key}`, RESOURCE);
  }

  /**
   * Post an ipc message (write-once). The key holds at most one live message
   * until it is consumed or fades.
   *
   * @throws {ShimmerCasConflictError} 409 — a live message already occupies the
   *   key.
   */
  async emitIpc(
    key: string,
    value: unknown,
    options: { ttlSeconds: number },
  ): Promise<Shimmer> {
    const response = await this.request<ApiSuccessResponse<Shimmer>>(
      "POST",
      "/v1/shimmers",
      { recordType: "ipc", key, ttlSeconds: options.ttlSeconds, value },
    );
    return unwrapData(response, "POST /v1/shimmers", RESOURCE);
  }

  /**
   * Consume an ipc message (atomic exactly-once `DELETE … RETURNING`). Exactly
   * one concurrent caller receives the record; every other receives `null`.
   * Returns the consumed record (with its `ownerToken` redacted to null), or
   * `null` when no live message existed.
   */
  async consumeIpc(key: string): Promise<ShimmerRead | null> {
    const query = new URLSearchParams({ recordType: "ipc" });
    const path = `/v1/shimmers/${encodeURIComponent(key)}?${query.toString()}`;
    const response = await this.request<ApiSuccessResponse<ShimmerDeleteResult>>(
      "DELETE",
      path,
    );
    const result = unwrapData<ShimmerDeleteResult>(
      response,
      `DELETE /v1/shimmers/${key}`,
      RESOURCE,
    );
    return result.consumed;
  }

  /**
   * Read a live shimmer (TTL-filtered): returns the record for
   * (`recordType`, `key`) when LIVE (fades_at > now). A faded-but-unreaped row
   * reads as absent. The result NEVER carries an `ownerToken` (always null on a
   * read — engram-server #933 P1).
   *
   * @throws {NotFoundError} 404 — no live shimmer for (recordType, key) (absent
   *   or faded).
   */
  async get(key: string, recordType: ShimmerRecordType): Promise<ShimmerRead> {
    const query = new URLSearchParams({ recordType });
    const path = `/v1/shimmers/${encodeURIComponent(key)}?${query.toString()}`;
    const response = await this.request<ApiSuccessResponse<ShimmerRead>>(
      "GET",
      path,
    );
    return unwrapData(response, `GET /v1/shimmers/${key}`, RESOURCE);
  }
}
