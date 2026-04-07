/**
 * Audit Resource
 *
 * Resource-based SDK interface for audit event ingestion, querying, and management.
 * Designed for engram Knowledge API.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export type AuditLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type AuditOutcome = "success" | "failure" | "partial";
export type AuditEventType =
  | "pattern_search"
  | "pattern_load"
  | "pattern_find"
  | "pattern_sign"
  | "skill_execute"
  | "pattern_index"
  | "pattern_version_create"
  | "pattern_version_deprecate"
  | "artifact_search"
  | "artifact_load"
  | "artifact_code_extract"
  | "session_start"
  | "session_note"
  | "session_search"
  | "session_finalize"
  | "research_plan"
  | "consultation"
  | "branch_create"
  | "branch_close"
  | "tool_call";

export interface AuditEvent {
  id: string;
  timestamp: string;
  level: AuditLevel;
  component: string;
  message: string;
  service?: string;
  version?: string;
  pid?: number;
  hostname?: string;
  eventType?: AuditEventType;
  tool?: string;
  outcome?: AuditOutcome;
  durationMs?: number;
  projectPath?: string;
  sessionId?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IngestEventParams {
  timestamp?: string;
  level: AuditLevel;
  component: string;
  message: string;
  service?: string;
  version?: string;
  pid?: number;
  hostname?: string;
  eventType?: AuditEventType;
  tool?: string;
  outcome?: AuditOutcome;
  durationMs?: number;
  projectPath?: string;
  sessionId?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ListAuditEventsParams {
  level?: AuditLevel | AuditLevel[];
  component?: string;
  eventType?: AuditEventType | AuditEventType[];
  tool?: string;
  outcome?: AuditOutcome;
  projectPath?: string;
  sessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByLevel: Record<string, number>;
  recentActivity: Array<{ date: string; count: number }>;
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
// Audit Resource
// ============================================================================

/**
 * Audit Resource - ingestion, querying, and management of audit events
 */
export class AuditResource extends BaseResource {
  /**
   * Ingest a single audit event
   */
  async ingest(event: IngestEventParams): Promise<{ accepted: true }> {
    const response = await this.request<ApiSuccessResponse<{ accepted: true }>>(
      "POST",
      "/v1/audit/ingest",
      event
    );
    return response.data;
  }

  /**
   * Ingest a batch of audit events
   */
  async ingestBatch(events: IngestEventParams[]): Promise<{ accepted: number }> {
    const response = await this.request<ApiSuccessResponse<{ accepted: number }>>(
      "POST",
      "/v1/audit/ingest/batch",
      { events }
    );
    return response.data;
  }

  /**
   * Flush buffered audit events to persistent storage
   */
  async flush(): Promise<{ flushed: true }> {
    const response = await this.request<ApiSuccessResponse<{ flushed: true }>>(
      "POST",
      "/v1/audit/flush"
    );
    return response.data;
  }

  /**
   * List audit events with optional filters
   */
  async listEvents(params?: ListAuditEventsParams): Promise<{
    events: AuditEvent[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.level) {
      const levels = Array.isArray(params.level)
        ? params.level.join(",")
        : params.level;
      query.set("level", levels);
    }
    if (params?.component) query.set("component", params.component);
    if (params?.eventType) {
      const eventTypes = Array.isArray(params.eventType)
        ? params.eventType.join(",")
        : params.eventType;
      query.set("eventType", eventTypes);
    }
    if (params?.tool) query.set("tool", params.tool);
    if (params?.outcome) query.set("outcome", params.outcome);
    if (params?.projectPath) query.set("projectPath", params.projectPath);
    if (params?.sessionId) query.set("sessionId", params.sessionId);
    if (params?.since) query.set("since", params.since);
    if (params?.until) query.set("until", params.until);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/audit/events${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<AuditEvent[]>>(
      "GET",
      path
    );

    return {
      events: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get a single audit event by ID
   */
  async getEvent(id: string): Promise<AuditEvent> {
    const response = await this.request<ApiSuccessResponse<AuditEvent>>(
      "GET",
      `/v1/audit/events/${encodeURIComponent(id)}`
    );
    return response.data;
  }

  /**
   * Get aggregate audit statistics
   */
  async getStats(params?: { since?: string; until?: string }): Promise<AuditStats> {
    const query = new URLSearchParams();

    if (params?.since) query.set("since", params.since);
    if (params?.until) query.set("until", params.until);

    const queryString = query.toString();
    const path = `/v1/audit/stats${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<AuditStats>>(
      "GET",
      path
    );
    return response.data;
  }

  /**
   * Prune audit events older than the specified number of days
   */
  async prune(olderThanDays: number): Promise<{ deleted: number }> {
    const query = new URLSearchParams();
    query.set("olderThanDays", String(olderThanDays));

    const qs = query.toString();
    const path = `/v1/audit/prune${qs ? `?${qs}` : ""}`;

    const response = await this.request<ApiSuccessResponse<{ deleted: number }>>(
      "DELETE",
      path
    );
    return response.data;
  }
}
