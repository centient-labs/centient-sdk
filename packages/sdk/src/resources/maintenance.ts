/**
 * Maintenance Resource
 *
 * Resource-based SDK interface for server maintenance operations.
 * Provides access to tombstone cleanup and changelog compaction
 * with dry-run support.
 */

import { EngramError } from "../errors.js";
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
    // Maintenance success responses are BARE objects, not the `{ data }`
    // envelope (engram-server 0.34 / ADR-022 migration).
    return this.request<TombstoneCleanupResult>(
      "POST",
      "/v1/maintenance/tombstone-cleanup",
      params
    );
  }

  /**
   * Compact the changelog by removing entries older than the specified number of days.
   */
  async changelogCompact(params?: MaintenanceParams): Promise<ChangelogCompactResult> {
    // Bare object response (see tombstoneCleanup).
    return this.request<ChangelogCompactResult>(
      "POST",
      "/v1/maintenance/changelog-compact",
      params
    );
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
    // The vacuum route returns a BARE object, NOT the standard `{ data }`
    // envelope (engram-server#766) — consistent with tombstoneCleanup and
    // changelogCompact. Validate the shape so a contract drift fails loudly
    // instead of returning `undefined` fields.
    const result = await this.request<VacuumResult>("POST", path);
    if (
      !result ||
      !Array.isArray(result.vacuumed) ||
      typeof result.full !== "boolean"
    ) {
      throw new EngramError(
        "Unexpected POST /v1/maintenance/vacuum response shape (expected { vacuumed: string[], full: boolean })",
        "INTERNAL_ERROR",
      );
    }
    return result;
  }
}
