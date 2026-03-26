/**
 * Terrafirma Resource
 *
 * SDK interface for filesystem-to-Engram synchronization (ADR-049).
 * Provides status, file info, migration, and sync methods.
 */

import type { EngramClient } from "../client.js";
import type { NodeType } from "../types/node-type.js";
import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

/** Terrafirma operating mode. */
export type TerrafirmaMode = "steady_state" | "migration" | "initial_scan";

/** Watcher/reconciler process status. */
export type ProcessStatus = "running" | "idle" | "stopped" | "error";

/** 7-state sync status (ADR-049 D1). */
export type SyncStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "fs_dirty"
  | "conflict"
  | "orphaned"
  | "error";

/** Migration run status. */
export type MigrationStatus =
  | "running"
  | "completed"
  | "failed"
  | "not_found";

/** Sync scope for manual sync triggers. */
export type SyncScope = "all" | "errors" | "conflicts";

// --- GET /v1/terrafirma/status ---

export interface TerrafirmaWatcherStatus {
  status: ProcessStatus;
  uptimeSeconds: number;
  eventsProcessed24h: number;
  lastEventAt: string | null;
}

export interface TerrafirmaReconcilerStatus {
  status: ProcessStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Count of stale syncing rows recovered in the last reconciler cycle (ADR-060 Phase 2). */
  lastRecoveryCount: number;
}

export interface TerrafirmaSyncCounts {
  total: number;
  synced: number;
  pending: number;
  syncing: number;
  fsDirty: number;
  conflict: number;
  orphaned: number;
  error: number;
  lastSyncedAt: string | null;
  /** Count of rows stuck in 'syncing' beyond the stale threshold (ADR-060 Phase 2). */
  staleSyncing: number;
}

export interface TerrafirmaSuggestedAction {
  action: string;
  label: string;
  endpoint: string;
  count?: number;
}

export interface TerrafirmaStatus {
  mode: TerrafirmaMode;
  watcher: TerrafirmaWatcherStatus;
  reconciler: TerrafirmaReconcilerStatus;
  sync: TerrafirmaSyncCounts;
  suggestedActions: TerrafirmaSuggestedAction[];
}

// --- GET /v1/terrafirma/files/:filePath ---

export interface CrystalMembershipInfo {
  crystalId: string;
  nodeType: NodeType;
  tags: string[];
  folderPath: string | null;
}

export interface FileConflictInfo {
  detectedAt: string;
  reason: string;
  watcherHash?: string;
  reconcilerHash?: string;
  resolutionAction: string;
  resolutionDescription: string;
}

export interface TerrafirmaFileInfo {
  filePath: string;
  syncStatus: SyncStatus;
  contentHash: string | null;
  lastModified: string | null;
  sizeBytes: number | null;
  entityId: string | null;
  crystalMemberships: CrystalMembershipInfo[];
  engramItemId: string;
  version: number;
  lastSyncedAt: string | null;
  conflict: FileConflictInfo | null;
}

// --- GET /v1/terrafirma/files ---

export interface ListFilesParams {
  limit?: number;
  offset?: number;
  syncStatus?: SyncStatus;
  prefix?: string;
  includeCrystalInfo?: boolean;
}

export interface LinkedCrystalInfo {
  crystalId: string;
  title: string;
  nodeType: NodeType;
}

export interface TerrafirmaFileEntry {
  filePath: string;
  syncStatus: SyncStatus;
  contentHash: string | null;
  engramItemId: string;
  version: number;
  lastSyncedAt: string | null;
  linkedCrystal?: LinkedCrystalInfo;
}

export interface ListFilesResult {
  files: TerrafirmaFileEntry[];
  total: number;
}

// --- POST /v1/terrafirma/migrations ---

export interface StartMigrationOptions {
  dryRun: boolean;
  entityIds?: string[];
}

export interface MigrationStartResult {
  dryRun: boolean;
  [key: string]: unknown;
}

// --- GET /v1/terrafirma/migrations/current ---

export interface MigrationError {
  filePath: string;
  errorCode: string;
  message: string;
  recoverable: boolean;
}

export interface MigrationCurrentStatus {
  status: MigrationStatus;
  migrationId: string;
  filesTotal: number;
  filesProcessed: number;
  filesErrored: number;
  filesRemaining: number;
  currentEntity: string | null;
  entitiesCompleted: string[];
  entitiesRemaining: string[];
  startedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  checkpointId: string;
  errors: MigrationError[];
}

// --- POST /v1/terrafirma/conflicts/:filePath/resolve ---

/**
 * Result of resolving a terrafirma file conflict (ADR-060 Decision 4).
 * Only `filesystem_wins` strategy is supported in Phase 2; `engram_wins` is deferred.
 */
export interface ResolveConflictResult {
  /** The file path whose conflict was resolved. */
  filePath: string;
  /** The strategy applied. */
  strategy: "filesystem_wins";
  /** The new sync status after resolution (always `pending` — reconciler re-syncs next cycle). */
  newStatus: "pending";
}

// --- POST /v1/terrafirma/sync ---

export interface TriggerSyncOptions {
  dryRun: boolean;
  scope?: SyncScope;
  entityId?: string;
  filePaths?: string[];
}

export interface SyncResult {
  dryRun: boolean;
  [key: string]: unknown;
}

// ============================================================================
// API Response Types
// ============================================================================

interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    timing?: { durationMs: number };
  };
}

// ============================================================================
// Terrafirma Migrations Sub-Resource
// ============================================================================

/**
 * Terrafirma Migrations Resource - scoped sub-resource for migration operations.
 *
 * Accessed via `client.terrafirma.migrations`.
 */
export class TerrafirmaMigrationsResource extends BaseResource {
  /**
   * Get current or most recent migration status.
   *
   * GET /v1/terrafirma/migrations/current
   */
  async current(): Promise<MigrationCurrentStatus> {
    const response = await this.request<ApiSuccessResponse<MigrationCurrentStatus>>(
      "GET",
      "/v1/terrafirma/migrations/current"
    );
    return response.data;
  }

  /**
   * Start or dry-run a migration.
   *
   * POST /v1/terrafirma/migrations
   *
   * @param options.dryRun - If true, scan and report without making changes (returns 200).
   *   If false, start the migration (returns 201). 409 if migration already running.
   * @param options.entityIds - Scope migration to specific entities. Omit for all.
   */
  async start(options: StartMigrationOptions): Promise<MigrationStartResult> {
    const body: Record<string, unknown> = {
      dry_run: options.dryRun,
    };
    if (options.entityIds !== undefined) {
      body.entity_ids = options.entityIds;
    }

    const response = await this.request<ApiSuccessResponse<MigrationStartResult>>(
      "POST",
      "/v1/terrafirma/migrations",
      body
    );
    return response.data;
  }
}

// ============================================================================
// Terrafirma Resource
// ============================================================================

/**
 * Terrafirma Resource - filesystem-to-Engram synchronization.
 *
 * Accessed via `client.terrafirma`.
 */
export class TerrafirmaResource extends BaseResource {
  /**
   * Sub-resource for migration operations.
   *
   * Usage: `client.terrafirma.migrations.current()` or
   *        `client.terrafirma.migrations.start({ dryRun: true })`
   */
  public readonly migrations: TerrafirmaMigrationsResource;

  constructor(client: EngramClient) {
    super(client);
    this.migrations = new TerrafirmaMigrationsResource(client);
  }

  /**
   * Get sync status overview.
   *
   * GET /v1/terrafirma/status
   *
   * Returns watcher/reconciler health, 7-state file counts, and suggested actions.
   */
  async status(): Promise<TerrafirmaStatus> {
    const response = await this.request<ApiSuccessResponse<TerrafirmaStatus>>(
      "GET",
      "/v1/terrafirma/status"
    );
    return response.data;
  }

  /**
   * Get detailed sync state for a specific file.
   *
   * GET /v1/terrafirma/files/:filePath
   *
   * @param filePath - Relative file path (will be URL-encoded automatically).
   * @returns File info or null if no bridge row exists.
   */
  async fileInfo(filePath: string): Promise<TerrafirmaFileInfo | null> {
    try {
      const encoded = encodeURIComponent(filePath);
      const response = await this.request<ApiSuccessResponse<TerrafirmaFileInfo>>(
        "GET",
        `/v1/terrafirma/files/${encoded}`
      );
      return response.data;
    } catch (err: unknown) {
      if (
        err !== null &&
        err !== undefined &&
        typeof err === "object" &&
        "statusCode" in err &&
        (err as { statusCode: number }).statusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * List all tracked files with optional filtering.
   *
   * GET /v1/terrafirma/files
   *
   * @param params.limit - Maximum files to return (default: 100, max: 1000)
   * @param params.offset - Number to skip for pagination
   * @param params.syncStatus - Filter by sync status
   * @param params.prefix - Filter by path prefix
   * @param params.includeCrystalInfo - Include linked crystal details
   */
  async listFiles(params?: ListFilesParams): Promise<ListFilesResult> {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }
    if (params?.syncStatus) {
      searchParams.set("sync_status", params.syncStatus);
    }
    if (params?.prefix) {
      searchParams.set("prefix", params.prefix);
    }
    if (params?.includeCrystalInfo) {
      searchParams.set("include_crystal_info", "true");
    }

    const qs = searchParams.toString();
    const path = `/v1/terrafirma/files${qs ? `?${qs}` : ""}`;
    const response = await this.request<ApiSuccessResponse<ListFilesResult>>(
      "GET",
      path
    );
    return response.data;
  }

  /**
   * Resolve a file conflict via the specified strategy.
   *
   * POST /v1/terrafirma/conflicts/:filePath/resolve
   *
   * Only `filesystem_wins` is accepted. Passing `engram_wins` is a TypeScript
   * compile-time error (ADR-060 Decision 3: engram_wins deferred to Phase 3).
   *
   * @param filePath - Relative file path (will be URL-encoded automatically).
   * @param strategy - Resolution strategy. Only `'filesystem_wins'` is valid.
   * @returns Resolution result including the file path and new status.
   */
  async resolveConflict(
    filePath: string,
    strategy: "filesystem_wins"
  ): Promise<ResolveConflictResult> {
    const encoded = encodeURIComponent(filePath);
    const response = await this.request<ApiSuccessResponse<ResolveConflictResult>>(
      "POST",
      `/v1/terrafirma/conflicts/${encoded}/resolve`,
      { strategy }
    );
    return response.data;
  }

  /**
   * Trigger a manual sync cycle.
   *
   * POST /v1/terrafirma/sync
   *
   * @param options.dryRun - If true, report what would be synced (returns 200).
   *   If false, execute the sync (returns 201).
   * @param options.scope - What to sync: "all", "errors", "conflicts". Defaults to "all".
   * @param options.entityId - Scope to a specific entity.
   * @param options.filePaths - Scope to specific files.
   */
  async sync(options: TriggerSyncOptions): Promise<SyncResult> {
    const body: Record<string, unknown> = {
      dry_run: options.dryRun,
    };
    if (options.scope !== undefined) {
      body.scope = options.scope;
    }
    if (options.entityId !== undefined) {
      body.entity_id = options.entityId;
    }
    if (options.filePaths !== undefined) {
      body.file_paths = options.filePaths;
    }

    const response = await this.request<ApiSuccessResponse<SyncResult>>(
      "POST",
      "/v1/terrafirma/sync",
      body
    );
    return response.data;
  }
}
