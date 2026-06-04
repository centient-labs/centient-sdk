/**
 * Maintenance Resource
 *
 * Resource-based SDK interface for server maintenance operations.
 * Provides access to tombstone cleanup and changelog compaction
 * with dry-run support.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export interface MaintenanceParams {
  days?: number;
  dryRun?: boolean;
}

export interface TombstoneCleanupResult {
  deleted: number;
  warnings: string[];
  dryRun: boolean;
}

export interface ChangelogCompactResult {
  deleted: number;
  belowSeq: string | null;
  dryRun: boolean;
  reason?: string;
}

export interface VacuumParams {
  /**
   * When `true`, run `VACUUM (FULL, ANALYZE)` — rewrites each tombstone table
   * and shrinks the database on disk, but takes an `ACCESS EXCLUSIVE` lock
   * (blocks all access to that table for the duration). Run it in a
   * maintenance window. Requires an **admin** API key (a plain write key is
   * rejected with 403). When omitted/`false`, runs the non-blocking
   * `VACUUM (ANALYZE)`.
   */
  full?: boolean;
}

export interface VacuumResult {
  /** Names of the tombstone tables that were vacuumed. */
  vacuumed: string[];
  /** Whether the `FULL` variant was run. */
  full: boolean;
}

// ============================================================================
// API Response Types (internal)
// ============================================================================

interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      offset?: number;
      hasMore: boolean;
    };
  };
}

// ============================================================================
// Maintenance Resource
// ============================================================================

/**
 * Maintenance Resource — server maintenance and cleanup operations.
 *
 * @example
 * ```typescript
 * // Dry-run tombstone cleanup
 * const preview = await client.maintenance.tombstoneCleanup({
 *   days: 30,
 *   dryRun: true,
 * });
 *
 * // Run changelog compaction
 * const result = await client.maintenance.changelogCompact({ days: 90 });
 * ```
 */
export class MaintenanceResource extends BaseResource {
  /**
   * Clean up soft-deleted (tombstoned) records older than the specified number of days.
   */
  async tombstoneCleanup(params?: MaintenanceParams): Promise<TombstoneCleanupResult> {
    const response = await this.request<ApiSuccessResponse<TombstoneCleanupResult>>(
      "POST",
      "/v1/maintenance/tombstone-cleanup",
      params
    );
    return response.data;
  }

  /**
   * Compact the changelog by removing entries older than the specified number of days.
   */
  async changelogCompact(params?: MaintenanceParams): Promise<ChangelogCompactResult> {
    const response = await this.request<ApiSuccessResponse<ChangelogCompactResult>>(
      "POST",
      "/v1/maintenance/changelog-compact",
      params
    );
    return response.data;
  }

  /**
   * Reclaim physical space on the tombstone tables after bulk hard-deletes.
   *
   * Pair with {@link tombstoneCleanup}: that hard-deletes rows, this returns
   * the dead-tuple space. Pass `{ full: true }` to run `VACUUM FULL`, which
   * shrinks the database on disk but takes an `ACCESS EXCLUSIVE` lock and
   * **requires an admin API key** (403 otherwise). A `VACUUM FULL` already in
   * progress surfaces as a 409 (`RES_CONFLICT`).
   *
   * Unlike the other maintenance endpoints, the server returns a **bare**
   * object (not wrapped in the standard `{ data }` envelope).
   *
   * Requires engram-server >= 0.34.0 (engram-server#766). Against older
   * servers the route does not exist and the call fails with a 404.
   *
   * @example
   * ```typescript
   * // Reclaim dead-tuple space (non-blocking)
   * const { vacuumed } = await client.maintenance.vacuum();
   *
   * // Full rewrite — admin key required, run in a maintenance window
   * await client.maintenance.vacuum({ full: true });
   * ```
   */
  async vacuum(params?: VacuumParams): Promise<VacuumResult> {
    const query = new URLSearchParams();
    if (params?.full) {
      query.set("full", "true");
    }
    const qs = query.toString();
    const path = `/v1/maintenance/vacuum${qs ? `?${qs}` : ""}`;
    // The vacuum route returns a bare object, NOT the `{ data }` envelope.
    return this.request<VacuumResult>("POST", path);
  }
}
