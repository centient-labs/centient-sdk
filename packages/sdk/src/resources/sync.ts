/**
 * Sync Resource
 *
 * Resource-based SDK interface for multi-node synchronization.
 * Provides push/pull replication, conflict resolution, and peer management.
 */

import type { EngramClient } from "../client.js";
import { BaseResource } from "./base.js";

// ============================================================================
// API Response Types
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
// Types
// ============================================================================

export interface SyncPeer {
  id: string;
  name: string;
  url: string;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastPushSeq: string | null;
  lastPullSeq: string | null;
  linkEnabled: boolean;
  linkIntervalSeconds: number;
  linkLastSyncAt: string | null;
  linkLastError: string | null;
  linkPaused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  localValue: unknown;
  remoteValue: unknown;
  localUpdatedAt: string | null;
  remoteUpdatedAt: string | null;
  winner: "local" | "remote";
  resolution: "auto_lww" | "manual";
  resolvedAt: string | null;
  createdAt: string;
}

export interface SyncStatus {
  schemaVersion: string;
  lastPushSeq: string | null;
  lastPullSeq: string | null;
  pendingChanges: number;
  conflictCount: number;
}

export interface CreatePeerParams {
  name: string;
  url: string;
  apiKey?: string;
}

export interface SyncPullParams {
  sinceSeq?: string;
  entityTypes?: string[];
}

export interface SyncPushResult {
  success: boolean;
  counts: Record<string, number>;
  conflicts: number;
  duration: number;
}

export interface ListConflictsParams {
  unresolved?: boolean;
}

/**
 * A single change record in the sync changelog.
 * Represents an operation on an entity that should be replicated.
 */
export interface SyncChange {
  entityType: string;
  entityId: string;
  operation: "insert" | "update" | "delete";
  seq?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

// ============================================================================
// Sync Peers Resource (Sub-resource)
// ============================================================================

/**
 * Sync Peers Resource - manages peer connections for replication.
 */
export class SyncPeersResource extends BaseResource {
  /**
   * Register a new sync peer.
   */
  async create(params: CreatePeerParams): Promise<SyncPeer> {
    const response = await this.request<ApiSuccessResponse<SyncPeer>>(
      "POST",
      "/v1/sync/peers",
      params
    );
    return response.data;
  }

  /**
   * List all registered sync peers.
   */
  async list(): Promise<SyncPeer[]> {
    const response = await this.request<ApiSuccessResponse<SyncPeer[]>>(
      "GET",
      "/v1/sync/peers"
    );
    return response.data;
  }

  /**
   * Get a sync peer by name.
   */
  async get(name: string): Promise<SyncPeer> {
    const response = await this.request<ApiSuccessResponse<SyncPeer>>(
      "GET",
      `/v1/sync/peers/${encodeURIComponent(name)}`
    );
    return response.data;
  }

  /**
   * Delete a sync peer by name.
   */
  async delete(name: string): Promise<{ deleted: true }> {
    const response = await this.request<ApiSuccessResponse<{ deleted: true }>>(
      "DELETE",
      `/v1/sync/peers/${encodeURIComponent(name)}`
    );
    return response.data;
  }

  /**
   * Enable automatic sync link for a peer.
   */
  async link(name: string): Promise<void> {
    await this.request<ApiSuccessResponse<void>>(
      "POST",
      `/v1/sync/peers/${encodeURIComponent(name)}/link`
    );
  }

  /**
   * Disable automatic sync link for a peer.
   */
  async unlink(name: string): Promise<void> {
    await this.request<ApiSuccessResponse<void>>(
      "DELETE",
      `/v1/sync/peers/${encodeURIComponent(name)}/link`
    );
  }

  /**
   * Pause an active sync link for a peer.
   */
  async pause(name: string): Promise<void> {
    await this.request<ApiSuccessResponse<void>>(
      "POST",
      `/v1/sync/peers/${encodeURIComponent(name)}/link/pause`
    );
  }

  /**
   * Resume a paused sync link for a peer.
   */
  async resume(name: string): Promise<void> {
    await this.request<ApiSuccessResponse<void>>(
      "POST",
      `/v1/sync/peers/${encodeURIComponent(name)}/link/resume`
    );
  }
}

// ============================================================================
// Sync Resource
// ============================================================================

/**
 * Sync Resource - manages data synchronization between Engram nodes.
 *
 * Provides push/pull replication, conflict detection and resolution,
 * and peer-to-peer sync orchestration.
 */
export class SyncResource extends BaseResource {
  private _peers: SyncPeersResource;

  constructor(client: EngramClient) {
    super(client);
    this._peers = new SyncPeersResource(client);
  }

  /**
   * Access the peers sub-resource for managing sync peers.
   */
  get peers(): SyncPeersResource {
    return this._peers;
  }

  /**
   * Push local changes to the server.
   */
  async push(changes?: SyncChange[]): Promise<SyncPushResult> {
    const response = await this.request<ApiSuccessResponse<SyncPushResult>>(
      "POST",
      "/v1/sync/push",
      changes
    );
    return response.data;
  }

  /**
   * Pull remote changes from the server.
   */
  async pull(params?: SyncPullParams): Promise<SyncChange[]> {
    const response = await this.request<ApiSuccessResponse<SyncChange[]>>(
      "POST",
      "/v1/sync/pull",
      params
    );
    return response.data;
  }

  /**
   * Get the current sync status.
   */
  async getStatus(): Promise<SyncStatus> {
    const response = await this.request<ApiSuccessResponse<SyncStatus>>(
      "GET",
      "/v1/sync/status"
    );
    return response.data;
  }

  /**
   * Push local changes to a specific peer.
   */
  async pushTo(peer: string): Promise<SyncPushResult> {
    const query = new URLSearchParams();
    query.set("peer", peer);

    const qs = query.toString();
    const path = `/v1/sync/push-to${qs ? `?${qs}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SyncPushResult>>(
      "POST",
      path
    );
    return response.data;
  }

  /**
   * Pull changes from a specific peer.
   */
  async pullFrom(peer: string): Promise<SyncChange[]> {
    const query = new URLSearchParams();
    query.set("peer", peer);

    const qs = query.toString();
    const path = `/v1/sync/pull-from${qs ? `?${qs}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SyncChange[]>>(
      "POST",
      path
    );
    return response.data;
  }

  /**
   * List sync conflicts, optionally filtering to unresolved only.
   */
  async listConflicts(params?: ListConflictsParams): Promise<{
    conflicts: SyncConflict[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.unresolved !== undefined) {
      query.set("unresolved", String(params.unresolved));
    }

    const queryString = query.toString();
    const path = `/v1/sync/conflicts${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SyncConflict[]>>(
      "GET",
      path
    );
    return {
      conflicts: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Resolve a sync conflict by ID.
   */
  async resolveConflict(
    id: string,
    params?: { resolution?: "local" | "remote"; rationale?: string }
  ): Promise<SyncConflict> {
    const response = await this.request<ApiSuccessResponse<SyncConflict>>(
      "POST",
      `/v1/sync/conflicts/${encodeURIComponent(id)}/resolve`,
      params
    );
    return response.data;
  }
}
