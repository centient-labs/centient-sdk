/**
 * Session Coordination Resources
 *
 * SDK resources for session coordination features (ADR-028 Stage 3):
 * - Constraints
 * - Decision Points
 * - Branches
 * - Note Edges
 * - Stuck Detections
 */

import type { EngramClient } from "../client.js";
import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Constraint entity from engram
 */
export interface SessionConstraint {
  id: string;
  sessionId: string;
  content: string;
  keywords: string[];
  scope: "session" | "task" | "file";
  active: boolean;
  detectedFrom: "auto" | "explicit";
  liftedAt: string | null;
  liftReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Constraint violation
 */
export interface ConstraintViolation {
  constraintId: string;
  content: string;
  matchedKeywords: string[];
  severity: "high" | "medium" | "low";
}

/**
 * Decision point entity from engram
 */
export interface DecisionPoint {
  id: string;
  sessionId: string;
  description: string;
  category: "architecture" | "implementation" | "tooling" | "refactoring" | "exploration" | "integration";
  alternatives: string[];
  rationale: string | null;
  surpriseScore: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  chosenBranchId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decision point with branches included
 */
export interface DecisionPointWithBranches extends DecisionPoint {
  branches: ExplorationBranch[];
}

/**
 * Exploration branch entity from engram
 */
export interface ExplorationBranch {
  id: string;
  sessionId: string;
  decisionPointId: string;
  label: string;
  status: "active" | "merged" | "rejected" | "abandoned";
  reasonExplored: string | null;
  closedReason: string | null;
  insights: string[];
  adoptedFully: boolean;
  closedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Branch tree node for visualization
 */
export interface BranchTreeNode {
  decisionPointId: string;
  description: string;
  branches: {
    id: string;
    label: string;
    status: string;
    isActive: boolean;
    isChosen: boolean;
  }[];
}

/**
 * Note edge (temporal graph relationship) from engram
 */
export interface SessionNoteEdge {
  id: string;
  sessionId: string;
  sourceNoteId: string;
  targetNoteId: string;
  relationship: "preceded_by" | "caused_by" | "validated_by" | "superseded_by" | "related_to" | "supports" | "contradicts" | "extends";
  evidence: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Note traversal result
 */
export interface NoteTraversalResult {
  noteId: string;
  depth: number;
  path: string[];
}

/**
 * Stuck detection entity from engram
 */
export interface StuckDetection {
  id: string;
  sessionId: string;
  patternType: "repeated_blocker" | "no_progress" | "error_loop";
  confidence: number;
  description: string;
  evidence: string[];
  resolved: boolean;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  cooldownUntil: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session link entity from engram
 */
export interface SessionLink {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  relationship: "builds_on" | "extends" | "supersedes" | "resolves_blockers_from";
  evidence: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ============================================================================
// Params Types
// ============================================================================

export interface CreateConstraintParams {
  content: string;
  keywords?: string[];
  scope?: "session" | "task" | "file";
  detectedFrom?: "auto" | "explicit";
  metadata?: Record<string, unknown>;
}

export interface UpdateConstraintParams {
  content?: string;
  keywords?: string[];
  scope?: "session" | "task" | "file";
  metadata?: Record<string, unknown>;
}

export interface ListConstraintsParams {
  active?: boolean;
  scope?: "session" | "task" | "file";
  limit?: number;
  offset?: number;
}

export interface CreateDecisionPointParams {
  description: string;
  category?: "architecture" | "implementation" | "tooling" | "refactoring" | "exploration" | "integration";
  alternatives?: string[];
  rationale?: string;
  surpriseScore?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateDecisionPointParams {
  description?: string;
  category?: "architecture" | "implementation" | "tooling" | "refactoring" | "exploration" | "integration";
  alternatives?: string[];
  rationale?: string;
  surpriseScore?: number;
  metadata?: Record<string, unknown>;
}

export interface ListDecisionPointsParams {
  category?: "architecture" | "implementation" | "tooling" | "refactoring" | "exploration" | "integration";
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateBranchParams {
  decisionPointId: string;
  label: string;
  reasonExplored?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateBranchParams {
  label?: string;
  reasonExplored?: string;
  metadata?: Record<string, unknown>;
}

export interface CloseBranchParams {
  action: "merge" | "reject" | "abandon";
  reason?: string;
  insights?: string[];
  adoptFully?: boolean;
}

export interface ListBranchesParams {
  decisionPointId?: string;
  status?: "active" | "merged" | "rejected" | "abandoned";
  limit?: number;
  offset?: number;
}

export interface CreateNoteEdgeParams {
  sourceNoteId: string;
  targetNoteId: string;
  relationship: "preceded_by" | "caused_by" | "validated_by" | "superseded_by" | "related_to" | "supports" | "contradicts" | "extends";
  evidence?: string;
  metadata?: Record<string, unknown>;
}

export interface ListNoteEdgesParams {
  sourceNoteId?: string;
  targetNoteId?: string;
  relationship?: "preceded_by" | "caused_by" | "validated_by" | "superseded_by" | "related_to" | "supports" | "contradicts" | "extends";
  limit?: number;
  offset?: number;
}

export interface TraverseNotesParams {
  startNoteId: string;
  relationship?: "preceded_by" | "caused_by" | "validated_by" | "superseded_by" | "related_to" | "supports" | "contradicts" | "extends";
  maxDepth?: number;
}

export interface CreateStuckDetectionParams {
  patternType: "repeated_blocker" | "no_progress" | "error_loop";
  confidence: number;
  description: string;
  evidence?: string[];
  cooldownMinutes?: number;
}

export interface ResolveStuckDetectionParams {
  resolutionNotes?: string;
}

export interface ListStuckDetectionsParams {
  patternType?: "repeated_blocker" | "no_progress" | "error_loop";
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateSessionLinkParams {
  sourceSessionId: string;
  targetSessionId: string;
  relationship: "builds_on" | "extends" | "supersedes" | "resolves_blockers_from";
  evidence?: string;
  metadata?: Record<string, unknown>;
}

export interface ListSessionLinksParams {
  relationship?: "builds_on" | "extends" | "supersedes" | "resolves_blockers_from";
  limit?: number;
  offset?: number;
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
// Constraints Resource
// ============================================================================

/**
 * Session Constraints Resource - scoped to a specific session
 */
export class SessionConstraintsResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a constraint
   */
  async create(params: CreateConstraintParams): Promise<SessionConstraint> {
    const response = await this.request<ApiSuccessResponse<SessionConstraint>>(
      "POST",
      `/v1/sessions/${this.sessionId}/constraints`,
      params
    );
    return response.data;
  }

  /**
   * Get a constraint by ID
   */
  async get(id: string): Promise<SessionConstraint> {
    const response = await this.request<ApiSuccessResponse<SessionConstraint>>(
      "GET",
      `/v1/sessions/${this.sessionId}/constraints/${id}`
    );
    return response.data;
  }

  /**
   * List constraints
   */
  async list(params?: ListConstraintsParams): Promise<{
    constraints: SessionConstraint[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set("active", String(params.active));
    if (params?.scope) query.set("scope", params.scope);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/constraints${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SessionConstraint[]>>(
      "GET",
      path
    );

    return {
      constraints: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get active constraints
   */
  async getActive(): Promise<SessionConstraint[]> {
    const response = await this.request<ApiSuccessResponse<SessionConstraint[]>>(
      "GET",
      `/v1/sessions/${this.sessionId}/constraints/active`
    );
    return response.data;
  }

  /**
   * Update a constraint
   */
  async update(id: string, params: UpdateConstraintParams): Promise<SessionConstraint> {
    const response = await this.request<ApiSuccessResponse<SessionConstraint>>(
      "PATCH",
      `/v1/sessions/${this.sessionId}/constraints/${id}`,
      params
    );
    return response.data;
  }

  /**
   * Lift (deactivate) a constraint
   */
  async lift(id: string, reason?: string): Promise<SessionConstraint> {
    const response = await this.request<ApiSuccessResponse<SessionConstraint>>(
      "POST",
      `/v1/sessions/${this.sessionId}/constraints/${id}/lift`,
      { reason }
    );
    return response.data;
  }

  /**
   * Check if text violates any active constraints
   */
  async checkViolations(text: string): Promise<{
    violations: ConstraintViolation[];
    hasViolations: boolean;
  }> {
    const response = await this.request<ApiSuccessResponse<{
      violations: ConstraintViolation[];
      hasViolations: boolean;
    }>>(
      "POST",
      `/v1/sessions/${this.sessionId}/constraints/check`,
      { text }
    );
    return response.data;
  }
}

// ============================================================================
// Decision Points Resource
// ============================================================================

/**
 * Session Decision Points Resource - scoped to a specific session
 */
export class SessionDecisionPointsResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a decision point
   */
  async create(params: CreateDecisionPointParams): Promise<DecisionPoint> {
    const response = await this.request<ApiSuccessResponse<DecisionPoint>>(
      "POST",
      `/v1/sessions/${this.sessionId}/decision-points`,
      params
    );
    return response.data;
  }

  /**
   * Get a decision point by ID
   */
  async get(id: string, options?: { includeBranches?: boolean }): Promise<DecisionPoint | DecisionPointWithBranches> {
    const query = new URLSearchParams();
    if (options?.includeBranches) query.set("includeBranches", "true");

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/decision-points/${id}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<DecisionPoint | DecisionPointWithBranches>>(
      "GET",
      path
    );
    return response.data;
  }

  /**
   * List decision points
   */
  async list(params?: ListDecisionPointsParams): Promise<{
    decisionPoints: DecisionPoint[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.resolved !== undefined) query.set("resolved", String(params.resolved));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/decision-points${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<DecisionPoint[]>>(
      "GET",
      path
    );

    return {
      decisionPoints: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Update a decision point
   */
  async update(id: string, params: UpdateDecisionPointParams): Promise<DecisionPoint> {
    const response = await this.request<ApiSuccessResponse<DecisionPoint>>(
      "PATCH",
      `/v1/sessions/${this.sessionId}/decision-points/${id}`,
      params
    );
    return response.data;
  }

  /**
   * Resolve a decision point
   */
  async resolve(id: string, chosenBranchId?: string): Promise<DecisionPoint> {
    const response = await this.request<ApiSuccessResponse<DecisionPoint>>(
      "POST",
      `/v1/sessions/${this.sessionId}/decision-points/${id}/resolve`,
      { chosenBranchId }
    );
    return response.data;
  }
}

// ============================================================================
// Branches Resource
// ============================================================================

/**
 * Session Branches Resource - scoped to a specific session
 */
export class SessionBranchesResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a branch
   */
  async create(params: CreateBranchParams): Promise<ExplorationBranch> {
    const response = await this.request<ApiSuccessResponse<ExplorationBranch>>(
      "POST",
      `/v1/sessions/${this.sessionId}/branches`,
      params
    );
    return response.data;
  }

  /**
   * Get a branch by ID
   */
  async get(id: string): Promise<ExplorationBranch> {
    const response = await this.request<ApiSuccessResponse<ExplorationBranch>>(
      "GET",
      `/v1/sessions/${this.sessionId}/branches/${id}`
    );
    return response.data;
  }

  /**
   * List branches
   */
  async list(params?: ListBranchesParams): Promise<{
    branches: ExplorationBranch[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.decisionPointId) query.set("decisionPointId", params.decisionPointId);
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/branches${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<ExplorationBranch[]>>(
      "GET",
      path
    );

    return {
      branches: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get branch tree visualization
   */
  async getTree(): Promise<BranchTreeNode[]> {
    const response = await this.request<ApiSuccessResponse<BranchTreeNode[]>>(
      "GET",
      `/v1/sessions/${this.sessionId}/branches/tree`
    );
    return response.data;
  }

  /**
   * Get active branch
   */
  async getActive(): Promise<ExplorationBranch | null> {
    const response = await this.request<ApiSuccessResponse<ExplorationBranch | null>>(
      "GET",
      `/v1/sessions/${this.sessionId}/branches/active`
    );
    return response.data;
  }

  /**
   * Switch active branch
   */
  async switch(branchId: string | null): Promise<{ switched: boolean; branchId: string | null }> {
    const response = await this.request<ApiSuccessResponse<{ switched: boolean; branchId: string | null }>>(
      "POST",
      `/v1/sessions/${this.sessionId}/branches/switch`,
      { branchId }
    );
    return response.data;
  }

  /**
   * Update a branch
   */
  async update(id: string, params: UpdateBranchParams): Promise<ExplorationBranch> {
    const response = await this.request<ApiSuccessResponse<ExplorationBranch>>(
      "PATCH",
      `/v1/sessions/${this.sessionId}/branches/${id}`,
      params
    );
    return response.data;
  }

  /**
   * Close a branch
   */
  async close(id: string, params: CloseBranchParams): Promise<ExplorationBranch> {
    const response = await this.request<ApiSuccessResponse<ExplorationBranch>>(
      "POST",
      `/v1/sessions/${this.sessionId}/branches/${id}/close`,
      params
    );
    return response.data;
  }
}

// ============================================================================
// Note Edges Resource
// ============================================================================

/**
 * Session Note Edges Resource - scoped to a specific session
 */
export class SessionNoteEdgesResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a note edge
   */
  async create(params: CreateNoteEdgeParams): Promise<SessionNoteEdge> {
    const response = await this.request<ApiSuccessResponse<SessionNoteEdge>>(
      "POST",
      `/v1/sessions/${this.sessionId}/note-edges`,
      params
    );
    return response.data;
  }

  /**
   * Get a note edge by ID
   */
  async get(id: string): Promise<SessionNoteEdge> {
    const response = await this.request<ApiSuccessResponse<SessionNoteEdge>>(
      "GET",
      `/v1/sessions/${this.sessionId}/note-edges/${id}`
    );
    return response.data;
  }

  /**
   * List note edges
   */
  async list(params?: ListNoteEdgesParams): Promise<{
    edges: SessionNoteEdge[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.sourceNoteId) query.set("sourceNoteId", params.sourceNoteId);
    if (params?.targetNoteId) query.set("targetNoteId", params.targetNoteId);
    if (params?.relationship) query.set("relationship", params.relationship);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/note-edges${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SessionNoteEdge[]>>(
      "GET",
      path
    );

    return {
      edges: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Traverse the note graph from a starting note
   */
  async traverse(params: TraverseNotesParams): Promise<NoteTraversalResult[]> {
    const response = await this.request<ApiSuccessResponse<NoteTraversalResult[]>>(
      "POST",
      `/v1/sessions/${this.sessionId}/note-edges/traverse`,
      params
    );
    return response.data;
  }

  /**
   * Delete a note edge
   */
  async delete(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/sessions/${this.sessionId}/note-edges/${id}`
    );
  }
}

// ============================================================================
// Stuck Detections Resource
// ============================================================================

/**
 * Session Stuck Detections Resource - scoped to a specific session
 */
export class SessionStuckDetectionsResource extends BaseResource {
  constructor(
    client: EngramClient,
    private sessionId: string
  ) {
    super(client);
  }

  /**
   * Create a stuck detection
   */
  async create(params: CreateStuckDetectionParams): Promise<StuckDetection> {
    const response = await this.request<ApiSuccessResponse<StuckDetection>>(
      "POST",
      `/v1/sessions/${this.sessionId}/stuck-detections`,
      params
    );
    return response.data;
  }

  /**
   * Get a stuck detection by ID
   */
  async get(id: string): Promise<StuckDetection> {
    const response = await this.request<ApiSuccessResponse<StuckDetection>>(
      "GET",
      `/v1/sessions/${this.sessionId}/stuck-detections/${id}`
    );
    return response.data;
  }

  /**
   * List stuck detections
   */
  async list(params?: ListStuckDetectionsParams): Promise<{
    detections: StuckDetection[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.patternType) query.set("patternType", params.patternType);
    if (params?.resolved !== undefined) query.set("resolved", String(params.resolved));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/stuck-detections${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<StuckDetection[]>>(
      "GET",
      path
    );

    return {
      detections: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get active stuck detections
   */
  async getActive(): Promise<StuckDetection[]> {
    const response = await this.request<ApiSuccessResponse<StuckDetection[]>>(
      "GET",
      `/v1/sessions/${this.sessionId}/stuck-detections/active`
    );
    return response.data;
  }

  /**
   * Get most recent stuck detection
   */
  async getRecent(patternType?: "repeated_blocker" | "no_progress" | "error_loop"): Promise<StuckDetection | null> {
    const query = new URLSearchParams();
    if (patternType) query.set("patternType", patternType);

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/stuck-detections/recent${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<StuckDetection | null>>(
      "GET",
      path
    );
    return response.data;
  }

  /**
   * Check cooldown status
   */
  async checkCooldown(patternType?: "repeated_blocker" | "no_progress" | "error_loop"): Promise<{ inCooldown: boolean }> {
    const query = new URLSearchParams();
    if (patternType) query.set("patternType", patternType);

    const queryString = query.toString();
    const path = `/v1/sessions/${this.sessionId}/stuck-detections/cooldown${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<{ inCooldown: boolean }>>(
      "GET",
      path
    );
    return response.data;
  }

  /**
   * Resolve a stuck detection
   */
  async resolve(id: string, params?: ResolveStuckDetectionParams): Promise<StuckDetection> {
    const response = await this.request<ApiSuccessResponse<StuckDetection>>(
      "POST",
      `/v1/sessions/${this.sessionId}/stuck-detections/${id}/resolve`,
      params ?? {}
    );
    return response.data;
  }
}

// ============================================================================
// Session Links Resource (non-session-scoped)
// ============================================================================

/**
 * Session Links Resource - for linking sessions together
 */
export class SessionLinksResource extends BaseResource {
  /**
   * Create a session link
   */
  async create(params: CreateSessionLinkParams): Promise<SessionLink> {
    const response = await this.request<ApiSuccessResponse<SessionLink>>(
      "POST",
      "/v1/session-links",
      params
    );
    return response.data;
  }

  /**
   * Get a session link by ID
   */
  async get(id: string): Promise<SessionLink> {
    const response = await this.request<ApiSuccessResponse<SessionLink>>(
      "GET",
      `/v1/session-links/${id}`
    );
    return response.data;
  }

  /**
   * Delete a session link
   */
  async delete(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/session-links/${id}`
    );
  }

  /**
   * List outgoing links from a session
   */
  async listOutgoing(sessionId: string, params?: ListSessionLinksParams): Promise<{
    links: SessionLink[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.relationship) query.set("relationship", params.relationship);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/session-links/outgoing/${sessionId}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SessionLink[]>>(
      "GET",
      path
    );

    return {
      links: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * List incoming links to a session
   */
  async listIncoming(sessionId: string, params?: ListSessionLinksParams): Promise<{
    links: SessionLink[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.relationship) query.set("relationship", params.relationship);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/session-links/incoming/${sessionId}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<SessionLink[]>>(
      "GET",
      path
    );

    return {
      links: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }
}
