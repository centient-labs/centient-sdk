/**
 * Sync Resource
 *
 * Resource-based SDK interface for multi-node synchronization.
 * Provides push/pull replication, conflict resolution, and peer management.
 */

import type { EngramClient } from "../client.js";
import { NetworkError, ResponseShapeError } from "../errors.js";
import {
  isNullableString,
  isNumber,
  isString,
  requireArray,
  requireField,
  requireObject,
  unwrapData,
  unwrapDataObject,
} from "../validate.js";
import { BaseResource } from "./base.js";

/** The four entity types the server always reports counts for. */
const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  "knowledge_crystals",
  "knowledge_crystal_edges",
  "sessions",
  "session_notes",
];

const RESOURCE = "sync";

/**
 * Unwrap the standard `{ data }` envelope for a sync route, narrowing `data` to
 * a non-null object via the shared validator. Thin wrapper that fixes the
 * resource name so each call site reads cleanly.
 */
function requireData<T>(body: unknown, route: string): T {
  return unwrapData<T>(body, route, RESOURCE);
}

/**
 * Narrow a bare `{ peer }` peers response, throwing a structured error when the
 * server returns `{ peer: null }`, `{}`, or another unexpected shape.
 */
function requirePeer(response: unknown, route: string): SyncPeer {
  const obj = requireObject(response, route, RESOURCE);
  if (!obj.peer || typeof obj.peer !== "object") {
    throw new ResponseShapeError(
      `Unexpected ${route} response shape (expected { peer })`,
      route,
      RESOURCE,
    );
  }
  return obj.peer as SyncPeer;
}

/**
 * Validate that a push/push-to response carries counts for all four entity
 * types (the documented contract). A partial object — e.g. from a server
 * schema drift — fails loudly here instead of surfacing as a `TypeError` when
 * a caller reads `counts.knowledge_crystal_edges.inserted`.
 */
function assertFullCounts(counts: SyncCounts | null | undefined, route: string): void {
  const record = requireObject(counts, route, RESOURCE);
  for (const key of SYNC_ENTITY_TYPES) {
    const entry = record[key];
    if (!entry || typeof entry !== "object") {
      throw new ResponseShapeError(
        `Unexpected ${route} response: counts missing entity type "${key}"`,
        route,
        RESOURCE,
      );
    }
    const counts = entry as Record<string, unknown>;
    if (
      typeof counts.inserted !== "number" ||
      typeof counts.updated !== "number" ||
      typeof counts.skipped !== "number"
    ) {
      throw new ResponseShapeError(
        `Unexpected ${route} response: counts.${key} missing numeric inserted/updated/skipped`,
        route,
        RESOURCE,
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
    const obj = requireObject(response, "GET /v1/sync/peers", RESOURCE);
    return requireArray<SyncPeer>(obj.peers, "GET /v1/sync/peers", RESOURCE);
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
    const data = requireData<SyncPushResult>(response, "POST /v1/sync/push");
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
    const route = "GET /v1/sync/status";
    const data = unwrapData<SyncStatus>(response, route, RESOURCE);
    const obj = requireObject(data, route, RESOURCE);
    requireField(obj, "instanceId", isString, route, RESOURCE);
    requireField(obj, "schemaVersion", isString, route, RESOURCE);
    requireField(obj, "peersCount", isNumber, route, RESOURCE);
    requireField(obj, "activeLinksCount", isNumber, route, RESOURCE);
    requireField(obj, "changelogSize", isNumber, route, RESOURCE);
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
    const data = requireData<SyncPushResult>(response, "POST /v1/sync/push-to");
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
    const route = "POST /v1/sync/pull-from";
    const data = unwrapData<SyncPullResult>(response, route, RESOURCE);
    const obj = requireObject(data, route, RESOURCE);
    // Required numeric fields must be present; maxSeq is optional/nullable —
    // only reject it when present with a non-string value (an absent or null
    // maxSeq is a valid "no entries" response and must not be rejected).
    requireField(obj, "entriesStreamed", isNumber, route, RESOURCE);
    requireField(obj, "duration", isNumber, route, RESOURCE);
    requireField(obj, "maxSeq", isNullableString, route, RESOURCE);
    // Normalize an absent maxSeq to `null` so the return matches the declared
    // `string | null` type (never `undefined`).
    return { ...data, maxSeq: data.maxSeq ?? null };
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
    const route = "GET /v1/sync/conflicts";
    const obj = unwrapDataObject(response, route, RESOURCE);
    const conflicts = requireArray<SyncConflict>(obj.conflicts, route, RESOURCE);
    requireField(obj, "total", isNumber, route, RESOURCE);
    return { conflicts, total: obj.total as number };
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
    const route = "POST /v1/sync/conflicts/{id}/resolve";
    const data = unwrapData<SyncConflict>(response, route, RESOURCE);
    const obj = requireObject(data, route, RESOURCE);
    // Validate the required identifying string fields (winner / resolution as
    // plain strings so a future server-side enum value isn't rejected). The
    // nullable timestamps are validated only when present with a non-string,
    // non-null value — an absent key is a legitimate wire variant of `null` and
    // must not be rejected. localValue / remoteValue are `unknown`, so they're
    // not validated here.
    requireField(obj, "id", isString, route, RESOURCE);
    requireField(obj, "entityType", isString, route, RESOURCE);
    requireField(obj, "entityId", isString, route, RESOURCE);
    requireField(obj, "fieldName", isString, route, RESOURCE);
    requireField(obj, "winner", isString, route, RESOURCE);
    requireField(obj, "resolution", isString, route, RESOURCE);
    requireField(obj, "createdAt", isString, route, RESOURCE);
    requireField(obj, "localUpdatedAt", isNullableString, route, RESOURCE);
    requireField(obj, "remoteUpdatedAt", isNullableString, route, RESOURCE);
    requireField(obj, "resolvedAt", isNullableString, route, RESOURCE);
    // Normalize absent nullable timestamps to `null` so the return matches the
    // declared `string | null` types (never `undefined`).
    return {
      ...data,
      localUpdatedAt: data.localUpdatedAt ?? null,
      remoteUpdatedAt: data.remoteUpdatedAt ?? null,
      resolvedAt: data.resolvedAt ?? null,
    };
  }
}
