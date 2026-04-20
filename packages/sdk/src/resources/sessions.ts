/**
 * Sessions Resource
 *
 * Resource-based SDK interface for session and note management.
 * Designed for engram Knowledge API.
 */

import type { EngramClient } from "../client.js";
import { BaseResource } from "./base.js";
import {
  SessionConstraintsResource,
  SessionDecisionPointsResource,
  SessionBranchesResource,
  SessionNoteEdgesResource,
  SessionStuckDetectionsResource,
} from "./session-coordination.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Session entity from engram
 */
export interface LocalSession {
  id: string;
  externalId: string | null;
  projectPath: string;
  status: "active" | "finalized" | "abandoned";
  startedAt: string;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lifecycle status of a session note, tracking its progression from creation to archival.
 *
 * Notes move through lifecycle stages that control their visibility and
 * eligibility for promotion to permanent knowledge.
 *
 * - `"draft"` - Initial state on creation; note is not yet confirmed or searchable by default
 * - `"active"` - Note is confirmed and actively used in the current session context
 * - `"finalized"` - Note has been reviewed and locked during session finalization
 * - `"archived"` - Note is retained for history but no longer actively surfaced
 * - `"superseded"` - Note has been replaced by a newer version or contradicted by later findings
 */
export type LifecycleStatus =
  | "draft"
  | "active"
  | "finalized"
  | "archived"
  | "superseded"
  | "merged";

/**
 * Embedding synchronization status for a session note's vector representation.
 *
 * Tracks whether the note's content has been successfully embedded into the
 * vector index for semantic search. Notes with non-synced status may not
 * appear in similarity-based search results.
 *
 * - `"pending"` - Note was created or updated but embedding has not yet been generated
 * - `"synced"` - Embedding is up to date and matches the current note content
 * - `"failed"` - Embedding generation failed (e.g., embedding service unavailable)
 * - `"stale"` - Note content was updated after the last successful embedding
 */
export type NoteEmbeddingStatus = "pending" | "synced" | "failed" | "stale";

export interface LocalSessionNote {
  id: string;
  sessionId: string;
  type: string;
  content: string;
  embeddingStatus: NoteEmbeddingStatus;
  embeddingUpdatedAt: string | null;
  lifecycleStatus: LifecycleStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Search result with similarity score
 */
export interface LocalSearchResult extends LocalSessionNote {
  score: number;
}

/**
 * Session scratch entity from engram (ADR-029)
 * Ephemeral notes that can be promoted to knowledge items
 */
export interface SessionScratch {
  id: string;
  sessionId: string;
  type: string;
  content: string;
  suggestedType: string | null;
  promotionScore: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Parameters for creating a session
 */
export interface CreateLocalSessionParams {
  externalId?: string;
  projectPath: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a session
 */
export interface UpdateLocalSessionParams {
  status?: "active" | "finalized" | "abandoned";
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing sessions
 */
export interface ListLocalSessionsParams {
  projectPath?: string;
  status?: "active" | "finalized" | "abandoned";
  limit?: number;
  offset?: number;
}

/**
 * Parameters for creating a note
 */
export interface CreateLocalNoteParams {
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  /**
   * Coherence enforcement mode for this write (P09).
   * - "blocking" (default): throws on contradiction before INSERT
   * - "advisory": proceeds even on contradiction, attaches result to response
   * - "bypass": skips the coherence check entirely
   */
  coherenceMode?: "blocking" | "advisory" | "bypass";
}

/**
 * Parameters for updating a note
 */
export interface UpdateLocalNoteParams {
  type?: string;
  content?: string;
  lifecycleStatus?: LifecycleStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing notes
 */
export interface ListLocalNotesParams {
  type?: string;
  limit?: number;
  offset?: number;
}

/**
 * Parameters for searching notes
 */
export interface SearchLocalNotesParams {
  query: string;
  limit?: number;
  includeDrafts?: boolean;
  includeMetadata?: ("lifecycle")[];
  /** Search mode: 'semantic' (default, vector), 'fulltext' (FTS), or 'hybrid' (RRF merge of vector + FTS) */
  mode?: "semantic" | "fulltext" | "hybrid";
}

/**
 * Parameters for creating a scratch note
 */
export interface CreateScratchParams {
  type: string;
  content: string;
  suggestedType?: string;
  promotionScore?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a scratch note
 */
export interface UpdateScratchParams {
  type?: string;
  content?: string;
  suggestedType?: string;
  promotionScore?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing scratch notes
 */
export interface ListScratchParams {
  type?: string;
  limit?: number;
  offset?: number;
}

import type { KnowledgeCrystal } from "../types/knowledge-crystal.js";

/**
 * Options for finalizing a session
 */
export interface FinalizeSessionOptions {
  /** Name for the crystal artifact */
  crystalName?: string;
  /** Description for the crystal artifact */
  crystalDescription?: string;
  /** Tags for categorizing the crystal */
  tags?: string[];
}

/**
 * Result of session finalization
 */
export interface FinalizeSessionResult {
  /** The finalized session */
  session: LocalSession;
  /** The artifact crystal created from the session */
  crystal: KnowledgeCrystal;
  /** Count of items promoted from scratch to knowledge */
  promotedItems: number;
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
// Session Notes Resource
// ============================================================================

/**
 * Session Notes Resource - scoped to a specific session
 */
export class SessionNotesResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a note in the session
   */
  async create(params: CreateLocalNoteParams): Promise<LocalSessionNote> {
    const response = await this.request<ApiSuccessResponse<LocalSessionNote>>(
      "POST",
      `/v1/sessions/${this.sessionId}/notes`,
      params
    );
    return response.data;
  }

  /**
   * List notes in the session
   */
  async list(params?: ListLocalNotesParams): Promise<{
    notes: LocalSessionNote[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.type) query.set("type", params.type);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/notes${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<LocalSessionNote[]>>(
      "GET",
      path
    );

    return {
      notes: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Semantic search within the session
   */
  async search(params: SearchLocalNotesParams): Promise<LocalSearchResult[]> {
    const response = await this.request<ApiSuccessResponse<LocalSearchResult[]>>(
      "POST",
      `/v1/sessions/${this.sessionId}/notes/search`,
      params
    );
    return response.data;
  }

  /**
   * Pre-flight coherence check for a proposed note (P09).
   * Does NOT write anything — pure read-only validation.
   *
   * In Phase 1/Phase 3, the check uses a zero-vector stub so
   * `warningCode` will be "NO_EMBEDDING_CANDIDATES" when no real
   * embeddings are available. Phase 2 wires real embeddings.
   */
  async checkCoherence(params: {
    type: string;
    content: string;
    includeDebugMetadata?: boolean;
  }): Promise<{
    wouldPass: boolean;
    coherenceResult: import("../types.js").CoherenceResult;
    warningCode?: string;
    recommendation?: string;
  }> {
    const response = await this.request<
      ApiSuccessResponse<{
        wouldPass: boolean;
        coherenceResult: import("../types.js").CoherenceResult;
        warningCode?: string;
        recommendation?: string;
      }>
    >("POST", `/v1/sessions/${this.sessionId}/notes/coherence-check`, params);
    return response.data;
  }

  /**
   * List coherence conflicts for this session (P09).
   */
  async listConflicts(params?: {
    status?: "open" | "resolved" | "escalated" | "all";
    limit?: number;
  }): Promise<{
    conflicts: import("../types.js").CoherenceConflictRecord[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    const path = `/v1/sessions/${this.sessionId}/coherence-conflicts${qs ? `?${qs}` : ""}`;
    const response = await this.request<
      ApiSuccessResponse<{
        conflicts: import("../types.js").CoherenceConflictRecord[];
        total: number;
      }>
    >("GET", path);
    return response.data;
  }

  /**
   * Resolve a coherence conflict for this session (P09).
   */
  async resolveConflict(
    conflictId: string,
    params: {
      resolution: "accepted" | "rejected" | "merged" | "escalated";
      rationale?: string;
      mergedNoteId?: string;
    }
  ): Promise<{
    conflictId: string;
    resolution: string;
    resolvedAt: string;
    auditEntryId: string;
  }> {
    const response = await this.request<
      ApiSuccessResponse<{
        conflictId: string;
        resolution: string;
        resolvedAt: string;
        auditEntryId: string;
      }>
    >(
      "PATCH",
      `/v1/sessions/${this.sessionId}/coherence-conflicts/${conflictId}/resolve`,
      params
    );
    return response.data;
  }
}

// ============================================================================
// Session Scratch Resource
// ============================================================================

/**
 * Session Scratch Resource - scoped to a specific session
 * Ephemeral scratch notes that can be promoted to knowledge items (ADR-029)
 */
export class SessionScratchResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Get a scratch note by ID
   */
  async get(scratchId: string): Promise<SessionScratch> {
    const response = await this.request<ApiSuccessResponse<SessionScratch>>(
      "GET",
      `/v1/sessions/${this.sessionId}/scratch/${scratchId}`
    );
    return response.data;
  }

  /**
   * Create a scratch note in the session
   */
  async create(params: CreateScratchParams): Promise<SessionScratch> {
    const response = await this.request<ApiSuccessResponse<SessionScratch>>(
      "POST",
      `/v1/sessions/${this.sessionId}/scratch`,
      params
    );
    return response.data;
  }

  /**
   * List scratch notes in the session
   */
  async list(params?: ListScratchParams): Promise<{
    scratches: SessionScratch[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.type) query.set("type", params.type);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/scratch${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SessionScratch[]>>(
      "GET",
      path
    );

    return {
      scratches: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Update a scratch note
   */
  async update(scratchId: string, params: UpdateScratchParams): Promise<SessionScratch> {
    const response = await this.request<ApiSuccessResponse<SessionScratch>>(
      "PATCH",
      `/v1/sessions/${this.sessionId}/scratch/${scratchId}`,
      params
    );
    return response.data;
  }

  /**
   * Delete a scratch note (hard delete - scratch is ephemeral)
   */
  async delete(scratchId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/sessions/${this.sessionId}/scratch/${scratchId}`
    );
  }
}

// ============================================================================
// Notes Resource (global operations)
// ============================================================================

/**
 * Notes Resource - for operations on individual notes
 */
export class NotesResource extends BaseResource {
  /**
   * Get a note by ID
   */
  async get(id: string): Promise<LocalSessionNote> {
    const response = await this.request<ApiSuccessResponse<LocalSessionNote>>(
      "GET",
      `/v1/notes/${id}`
    );
    return response.data;
  }

  /**
   * Update a note
   */
  async update(id: string, params: UpdateLocalNoteParams): Promise<LocalSessionNote> {
    const response = await this.request<ApiSuccessResponse<LocalSessionNote>>(
      "PATCH",
      `/v1/notes/${id}`,
      params
    );
    return response.data;
  }

  /**
   * Delete a note (soft delete)
   */
  async delete(id: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/notes/${id}`);
  }

  /**
   * Global semantic search across all notes
   */
  async search(params: SearchLocalNotesParams): Promise<LocalSearchResult[]> {
    const response = await this.request<ApiSuccessResponse<LocalSearchResult[]>>(
      "POST",
      "/v1/notes/search",
      params
    );
    return response.data;
  }
}

// ============================================================================
// Sessions Resource
// ============================================================================

/**
 * Sessions Resource
 */
export class SessionsResource extends BaseResource {
  /**
   * Create a new session
   */
  async create(params: CreateLocalSessionParams): Promise<LocalSession> {
    const response = await this.request<ApiSuccessResponse<LocalSession>>(
      "POST",
      "/v1/sessions",
      params
    );
    return response.data;
  }

  /**
   * Get a session by ID or external ID
   */
  async get(id: string): Promise<LocalSession> {
    const response = await this.request<ApiSuccessResponse<LocalSession>>(
      "GET",
      `/v1/sessions/${id}`
    );
    return response.data;
  }

  /**
   * List sessions
   */
  async list(params?: ListLocalSessionsParams): Promise<{
    sessions: LocalSession[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.projectPath) query.set("projectPath", params.projectPath);
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<LocalSession[]>>(
      "GET",
      path
    );

    return {
      sessions: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Update a session
   */
  async update(id: string, params: UpdateLocalSessionParams): Promise<LocalSession> {
    const response = await this.request<ApiSuccessResponse<LocalSession>>(
      "PATCH",
      `/v1/sessions/${id}`,
      params
    );
    return response.data;
  }

  /**
   * Delete a session (soft delete)
   */
  async delete(id: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/sessions/${id}`);
  }

  /**
   * Get a scoped notes resource for a specific session
   */
  notes(sessionId: string): SessionNotesResource {
    return new SessionNotesResource(this.client, sessionId);
  }

  /**
   * Get a scoped scratch resource for a specific session
   */
  scratch(sessionId: string): SessionScratchResource {
    return new SessionScratchResource(this.client, sessionId);
  }

  /**
   * Get a scoped constraints resource for a specific session
   */
  constraints(sessionId: string): SessionConstraintsResource {
    return new SessionConstraintsResource(this.client, sessionId);
  }

  /**
   * Get a scoped decision points resource for a specific session
   */
  decisionPoints(sessionId: string): SessionDecisionPointsResource {
    return new SessionDecisionPointsResource(this.client, sessionId);
  }

  /**
   * Get a scoped branches resource for a specific session
   */
  branches(sessionId: string): SessionBranchesResource {
    return new SessionBranchesResource(this.client, sessionId);
  }

  /**
   * Get a scoped note edges resource for a specific session
   */
  noteEdges(sessionId: string): SessionNoteEdgesResource {
    return new SessionNoteEdgesResource(this.client, sessionId);
  }

  /**
   * Get a scoped stuck detections resource for a specific session
   */
  stuckDetections(sessionId: string): SessionStuckDetectionsResource {
    return new SessionStuckDetectionsResource(this.client, sessionId);
  }

  /**
   * Finalize a session, creating a crystal artifact and promoting scratch items.
   *
   * This marks the session as finalized, creates a compressed knowledge artifact (crystal),
   * and promotes eligible scratch items to permanent knowledge items.
   *
   * @param sessionId - The session ID to finalize
   * @param options - Optional finalization options (crystal name, description, tags)
   * @returns The finalized session, created crystal, and count of promoted items
   */
  async finalize(
    sessionId: string,
    options?: FinalizeSessionOptions
  ): Promise<FinalizeSessionResult> {
    const response = await this.request<ApiSuccessResponse<FinalizeSessionResult>>(
      "POST",
      `/v1/sessions/${sessionId}/finalize`,
      options
    );
    return response.data;
  }

  /**
   * Get lifecycle-status counts across all sessions.
   *
   * Returns a histogram keyed by `LifecycleStatus`: how many sessions are
   * currently in each lifecycle state. The `sessionId` parameter is
   * accepted for API symmetry with the other resource methods but does not
   * scope the result — the server-side endpoint aggregates globally.
   *
   * Example response: `{ draft: 0, active: 5, finalized: 2, archived: 0,
   * superseded: 0, merged: 0 }`.
   */
  async getLifecycleStats(
    sessionId: string,
  ): Promise<Record<LifecycleStatus, number>> {
    const response = await this.request<
      ApiSuccessResponse<Record<LifecycleStatus, number>>
    >(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/lifecycle-stats`,
    );
    return response.data;
  }
}
