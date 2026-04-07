/**
 * GC (Garbage Collection) Resource
 *
 * Resource-based SDK interface for knowledge garbage collection operations.
 * Designed for engram Knowledge API.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export interface GcCandidate {
  id: string;
  title: string;
  nodeType: string;
  relevanceScore: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  verified: boolean;
  lifecycleStatus: string;
}

export interface GcAuditEntry {
  id: string;
  runAt: string;
  decayCurve: string;
  threshold: number;
  scannedCrystals: number;
  archivedCrystals: number;
  scannedNotes: number;
  archivedNotes: number;
  dryRun: boolean;
  details: Record<string, unknown>;
}

export interface GcRunResult {
  scannedCrystals: number;
  archivedCrystals: number;
  scannedNotes: number;
  archivedNotes: number;
  dryRun: boolean;
}

export interface ListGcCandidatesParams {
  threshold?: number;
  limit?: number;
  offset?: number;
}

export interface ListGcAuditParams {
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
// GC Resource
// ============================================================================

/** GC Resource — garbage collection candidates, audit log, and manual run trigger. */
export class GcResource extends BaseResource {
  /**
   * List garbage collection candidates ranked by relevance score
   */
  async getCandidates(params?: ListGcCandidatesParams): Promise<{
    candidates: GcCandidate[];
    threshold: number;
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.threshold !== undefined) query.set("threshold", String(params.threshold));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/gc/candidates${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<{
      candidates: GcCandidate[];
      threshold: number;
      total: number;
    }>>(
      "GET",
      path
    );
    return {
      ...response.data,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get the GC audit log of previous runs
   */
  async getAuditLog(params?: ListGcAuditParams): Promise<{
    entries: GcAuditEntry[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/gc/audit${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<{
      entries: GcAuditEntry[];
      total: number;
    }>>(
      "GET",
      path
    );
    return {
      ...response.data,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Run garbage collection, optionally as a dry run
   */
  async run(options?: { dryRun?: boolean }): Promise<GcRunResult> {
    const response = await this.request<ApiSuccessResponse<GcRunResult>>(
      "POST",
      "/v1/gc/run",
      options
    );
    return response.data;
  }
}
