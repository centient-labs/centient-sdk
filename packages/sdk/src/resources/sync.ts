/**
 * Sync Resource
 *
 * Resource-based SDK interface for multi-node synchronization.
 * Provides push/pull replication, conflict resolution, and peer management.
 */

import type { EngramClient } from "../client.js";
import { EngramError, NetworkError } from "../errors.js";
import { BaseResource } from "./base.js";

/** The four entity types the server always reports counts for. */
const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  "knowledge_crystals",
  "knowledge_crystal_edges",
  "sessions",
  "session_notes",
];

/**
 * Narrow an enveloped `data` payload to a non-null object, throwing a
 * structured error (rather than a downstream `TypeError`) when the server
 * returns `{ data: null }` or an otherwise unexpected envelope.
 */
function requireData<T>(data: T | null | undefined, route: string): T {
  if (!data || typeof data !== "object") {
    throw new EngramError(
      `Unexpected ${route} response shape (missing or non-object data)`,
      "INTERNAL_ERROR",
    );
  }
  return data;
}

/**
 * Narrow a bare `{ peer }` peers response, throwing a structured error when the
 * server returns `{ peer: null }`, `{}`, or another unexpected shape.
 */
function requirePeer(response: { peer: SyncPeer } | null | undefined, route: string): SyncPeer {
  if (!response || !response.peer || typeof response.peer !== "object") {
    throw new EngramError(
      `Unexpected ${route} response shape (expected { peer })`,
      "INTERNAL_ERROR",
    );
  }
  return response.peer;
}

/**
 * Validate that a push/push-to response carries counts for all four entity
 * types (the documented contract). A partial object — e.g. from a server
 * schema drift — fails loudly here instead of surfacing as a `TypeError` when
 * a caller reads `counts.knowledge_crystal_edges.inserted`.
 */
function assertFullCounts(counts: SyncCounts | null | undefined, route: string): void {
  if (!counts || typeof counts !== "object") {
    throw new EngramError(
      `Unexpected ${route} response: missing counts`,
      "INTERNAL_ERROR",
    );
  }
  const record = counts as Record<string, unknown>;
  for (const key of SYNC_ENTITY_TYPES) {
    const entry = record[key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") {
      throw new EngramError(
        `Unexpected ${route} response: counts missing entity type "${key}"`,
        "INTERNAL_ERROR",
      );
    }
    if (
      typeof entry.inserted !== "number" ||
      typeof entry.updated !== "number" ||
      typeof entry.skipped !== "number"
    ) {
      throw new EngramError(
        `Unexpected ${route} response: counts.${key} missing numeric inserted/updated/skipped`,
        "INTERNAL_ERROR",
      );
    }
  }
}

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
  /** This instance's stable sync identity. */
  instanceId: string;
  /** Sync wire schema version this instance speaks. */
  schemaVersion: string;
  /** Number of registered sync peers. */
  peersCount: number;
  /** Number of peers with an active background link. */
  activeLinksCount: number;
  /** Number of entries in the local sync changelog. */
  changelogSize: number;
}

export interface CreatePeerParams {
  name: string;
  url: string;
  apiKey?: string;
}

/**
 * Entity types tracked in the sync changelog. Matches the server's
 * `SyncEntityType` enum.
 */
export type SyncEntityType =
  | "knowledge_crystals"
  | "knowledge_crystal_edges"
  | "sessions"
  | "session_notes";

export interface SyncPullParams {
  /**
   * Pull changelog entries with `seq` strictly greater than this value. Pass
   * `null` to pull from the beginning of the changelog. Required by the
   * server (`POST /v1/sync/pull` rejects a missing `sinceSeq` with a 400).
   */
  sinceSeq: string | null;
  /** Restrict the pull to these entity types (omit for all types). */
  entityTypes?: SyncEntityType[];
}

/**
 * Per-entity-type apply counts returned by push operations. The server always
 * populates all four entity-type keys.
 */
export type SyncCounts = Record<
  SyncEntityType,
  { inserted: number; updated: number; skipped: number }
>;

/** Result of applying a batch of changes (`push` / `pushTo`). */
export interface SyncPushResult {
  counts: SyncCounts;
  conflicts: number;
  duration: number;
}

/** Result of triggering a daemon-side pull from a named peer (`pullFrom`). */
export interface SyncPullResult {
  entriesStreamed: number;
  maxSeq: string | null;
  duration: number;
}

export interface ListConflictsParams {
  unresolved?: boolean;
}

/**
 * A single change record in the sync changelog — one NDJSON line in the
 * `push` body and the `pull` response stream. Matches the server's
 * serialized `SyncChangelogEntry` wire shape.
 */
export interface SyncChange {
  /** Monotonic changelog sequence number (stringified bigint). */
  seq: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: "insert" | "update" | "delete";
  /** Changed-field map for the operation (null for deletes). */
  changedFields: Record<string, unknown> | null;
  /** Prior values of the changed fields (null when not tracked). */
  previousValues: Record<string, unknown> | null;
  /** ISO 8601 timestamp of when the change was recorded. */
  createdAt: string;
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
   *
   * The peers routes (`/v1/sync/peers/*`) use BARE response shapes
   * (`{ peer }`, `{ peers }`, `{ removed, name }`) — they are NOT wrapped in
   * the standard `{ success, data }` envelope that the rest of `/v1/sync` uses.
   */
  async create(params: CreatePeerParams): Promise<SyncPeer> {
    const response = await this.request<{ peer: SyncPeer }>(
      "POST",
      "/v1/sync/peers",
      params
    );
    return requirePeer(response, "POST /v1/sync/peers");
  }

  /**
   * List all registered sync peers.
   */
  async list(): Promise<SyncPeer[]> {
    const response = await this.request<{ peers: SyncPeer[] }>(
      "GET",
      "/v1/sync/peers"
    );
    if (!response || !Array.isArray(response.peers)) {
      throw new EngramError(
        "Unexpected GET /v1/sync/peers response shape (expected { peers: [] })",
        "INTERNAL_ERROR",
      );
    }
    return response.peers;
  }

  /**
   * Get a sync peer by name.
   */
  async get(name: string): Promise<SyncPeer> {
    const response = await this.request<{ peer: SyncPeer }>(
      "GET",
      `/v1/sync/peers/${encodeURIComponent(name)}`
    );
    return requirePeer(response, "GET /v1/sync/peers/{name}");
  }

  /**
   * Delete a sync peer by name.
   */
  async delete(name: string): Promise<{ removed: true; name: string }> {
    return this.request<{ removed: true; name: string }>(
      "DELETE",
      `/v1/sync/peers/${encodeURIComponent(name)}`
    );
  }

  // link/unlink/pause/resume each return the updated `{ peer }` on the wire.
  // We intentionally discard it and return `void`: these are fire-and-set
  // toggles and callers re-fetch via `get()` when they need the resulting
  // state. The body is still read (and JSON-parsed) by the request layer, so a
  // malformed response surfaces as an error rather than being silently ignored.

  /**
   * Enable automatic sync link for a peer.
   */
  async link(name: string): Promise<void> {
    await this.request<{ peer: SyncPeer }>(
      "POST",
      `/v1/sync/peers/${encodeURIComponent(name)}/link`
    );
  }

  /**
   * Disable automatic sync link for a peer.
   */
  async unlink(name: string): Promise<void> {
    await this.request<{ peer: SyncPeer }>(
      "DELETE",
      `/v1/sync/peers/${encodeURIComponent(name)}/link`
    );
  }

  /**
   * Pause an active sync link for a peer.
   */
  async pause(name: string): Promise<void> {
    await this.request<{ peer: SyncPeer }>(
      "POST",
      `/v1/sync/peers/${encodeURIComponent(name)}/link/pause`
    );
  }

  /**
   * Resume a paused sync link for a peer.
   */
  async resume(name: string): Promise<void> {
    await this.request<{ peer: SyncPeer }>(
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
 *
 * **Low-level peer endpoints.** `push`/`pull` exchange the raw NDJSON
 * changelog wire format directly with a peer and are intended for tooling
 * and tests — routine background replication is driven by the server-side
 * link daemon. A schema-version mismatch (the peer speaks a different sync
 * wire version) surfaces as an `EngramError` with code
 * `SYNC_SCHEMA_VERSION_MISMATCH` (HTTP 409); its `.details` carries
 * `{ peerVersion, ourVersion }`.
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
   *
   * The body is sent as NDJSON (one serialized changelog entry per line),
   * matching the server's `application/x-ndjson` push contract.
   */
  async push(changes: SyncChange[] = []): Promise<SyncPushResult> {
    // NDJSON requires every record to be newline-terminated; the server emits
    // a trailing newline on pull, so push matches it. Empty payload → empty body.
    const ndjson =
      changes.length > 0
        ? changes.map((change) => JSON.stringify(change)).join("\n") + "\n"
        : "";
    const response = await this.client._requestRawBody<ApiSuccessResponse<SyncPushResult>>(
      "POST",
      "/v1/sync/push",
      ndjson,
      "application/x-ndjson"
    );
    const data = requireData(response.data, "POST /v1/sync/push");
    assertFullCounts(data.counts, "POST /v1/sync/push");
    return data;
  }

  /**
   * Pull remote changes from the server.
   *
   * The server streams the result as NDJSON (one changelog entry per line),
   * which this method parses into a `SyncChange[]`. `params.sinceSeq` is
   * required — pass `null` to pull from the beginning of the changelog.
   */
  async pull(params: SyncPullParams): Promise<SyncChange[]> {
    const res = await this.client._requestRaw("POST", "/v1/sync/pull", {
      sinceSeq: params.sinceSeq,
      entityTypes: params.entityTypes,
    });
    const text = await res.text();
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, i) => {
        let entry: SyncChange;
        try {
          entry = JSON.parse(line) as SyncChange;
        } catch {
          // A malformed/truncated NDJSON line is a parse failure, not an HTTP
          // error (_requestRaw already threw for non-2xx). Surface it as a
          // structured NetworkError with the line index + a content excerpt.
          throw new NetworkError(
            `Failed to parse NDJSON line ${i} from /v1/sync/pull: ${line.slice(0, 200)}`,
          );
        }
        // Validate the discriminating fields at the parse boundary so a
        // contract drift surfaces as a structured error here, not a TypeError
        // at the call site. `createdAt` is required by SyncChange too.
        if (
          !entry.seq ||
          !entry.entityType ||
          !entry.entityId ||
          !entry.operation ||
          !entry.createdAt
        ) {
          throw new NetworkError(
            `Malformed SyncChange at NDJSON line ${i} from /v1/sync/pull: missing required field(s)`,
          );
        }
        // The entity type must be a known member of the SyncEntityType union —
        // an unknown type would slip past exhaustive switches at the call site.
        if (!(SYNC_ENTITY_TYPES as readonly string[]).includes(entry.entityType)) {
          throw new NetworkError(
            `Unexpected entityType "${entry.entityType}" at NDJSON line ${i} from /v1/sync/pull`,
          );
        }
        return entry;
      });
  }

  /**
   * Get the current sync status.
   */
  async getStatus(): Promise<SyncStatus> {
    const response = await this.request<ApiSuccessResponse<SyncStatus>>(
      "GET",
      "/v1/sync/status"
    );
    const data = requireData(response.data, "GET /v1/sync/status");
    if (
      typeof data.instanceId !== "string" ||
      typeof data.schemaVersion !== "string" ||
      typeof data.peersCount !== "number" ||
      typeof data.activeLinksCount !== "number" ||
      typeof data.changelogSize !== "number"
    ) {
      throw new EngramError(
        "Unexpected GET /v1/sync/status response shape (expected { instanceId: string, schemaVersion: string, peersCount: number, activeLinksCount: number, changelogSize: number })",
        "INTERNAL_ERROR",
      );
    }
    return data;
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
    const data = requireData(response.data, "POST /v1/sync/push-to");
    assertFullCounts(data.counts, "POST /v1/sync/push-to");
    return data;
  }

  /**
   * Trigger a daemon-side pull from a specific peer.
   *
   * Returns apply counts (`entriesStreamed`, `maxSeq`, `duration`), not the
   * changes themselves — the entries are applied server-side. Use {@link pull}
   * to retrieve raw changelog entries.
   */
  async pullFrom(peer: string): Promise<SyncPullResult> {
    const query = new URLSearchParams();
    query.set("peer", peer);

    const qs = query.toString();
    const path = `/v1/sync/pull-from${qs ? `?${qs}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SyncPullResult>>(
      "POST",
      path
    );
    const data = requireData(response.data, "POST /v1/sync/pull-from");
    if (
      typeof data.entriesStreamed !== "number" ||
      typeof data.duration !== "number" ||
      !(data.maxSeq === null || typeof data.maxSeq === "string")
    ) {
      throw new EngramError(
        "Unexpected POST /v1/sync/pull-from response shape (expected { entriesStreamed: number, maxSeq: string | null, duration: number })",
        "INTERNAL_ERROR",
      );
    }
    return data;
  }

  /**
   * List sync conflicts, optionally filtering to unresolved only.
   *
   * The server returns the list and count together (`data = { conflicts,
   * total }`); there is no pagination on this route.
   */
  async listConflicts(params?: ListConflictsParams): Promise<{
    conflicts: SyncConflict[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params?.unresolved !== undefined) {
      query.set("unresolved", String(params.unresolved));
    }

    const queryString = query.toString();
    const path = `/v1/sync/conflicts${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<
      ApiSuccessResponse<{ conflicts: SyncConflict[]; total: number }>
    >("GET", path);
    const data = requireData(response.data, "GET /v1/sync/conflicts");
    if (!Array.isArray(data.conflicts) || typeof data.total !== "number") {
      throw new EngramError(
        "Unexpected GET /v1/sync/conflicts response shape (expected { conflicts: [], total: number })",
        "INTERNAL_ERROR",
      );
    }
    return { conflicts: data.conflicts, total: data.total };
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
    const data = requireData(response.data, "POST /v1/sync/conflicts/{id}/resolve");
    // Structural validation only (forward-compatible): non-nullable string
    // fields via typeof, and nullable timestamps as `string | null`. `winner`
    // and `resolution` are checked as strings rather than against fixed literal
    // sets so a future server-side enum value isn't rejected. localValue /
    // remoteValue are `unknown`, so presence-only.
    const isStringOrNull = (v: unknown) => v === null || typeof v === "string";
    if (
      typeof data.id !== "string" ||
      typeof data.entityType !== "string" ||
      typeof data.entityId !== "string" ||
      typeof data.fieldName !== "string" ||
      typeof data.winner !== "string" ||
      typeof data.resolution !== "string" ||
      typeof data.createdAt !== "string" ||
      !("localValue" in data) ||
      !("remoteValue" in data) ||
      !isStringOrNull(data.localUpdatedAt) ||
      !isStringOrNull(data.remoteUpdatedAt) ||
      !isStringOrNull(data.resolvedAt)
    ) {
      throw new EngramError(
        "Unexpected POST /v1/sync/conflicts/{id}/resolve response shape (expected a full SyncConflict)",
        "INTERNAL_ERROR",
      );
    }
    return data;
  }
}
