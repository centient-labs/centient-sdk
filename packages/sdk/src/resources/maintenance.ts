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
}
