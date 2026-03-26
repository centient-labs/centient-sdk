/**
 * Edges Resource
 *
 * Resource-based SDK interface for knowledge crystal edge management.
 * Supports all relationship types including 'contains' for hierarchy (ADR-055).
 */

import { BaseResource } from "./base.js";
import type {
  KnowledgeCrystalEdge,
  CreateKnowledgeCrystalEdgeParams,
  UpdateKnowledgeCrystalEdgeParams,
  ListKnowledgeCrystalEdgesParams,
} from "../types/knowledge-crystal-edge.js";

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
// Edges Resource
// ============================================================================

/**
 * Edges Resource - manages edges between knowledge crystal nodes.
 * Supports all relationship types including 'contains' for hierarchy.
 */
export class EdgesResource extends BaseResource {
  /**
   * Create an edge between two knowledge crystal nodes
   */
  async create(params: CreateKnowledgeCrystalEdgeParams): Promise<KnowledgeCrystalEdge> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge>>(
      "POST",
      "/v1/edges",
      params
    );
    return response.data;
  }

  /**
   * Get an edge by ID
   */
  async get(id: string): Promise<KnowledgeCrystalEdge> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge>>(
      "GET",
      `/v1/edges/${encodeURIComponent(id)}`
    );
    return response.data;
  }

  /**
   * List edges with optional filters
   */
  async list(params?: ListKnowledgeCrystalEdgesParams): Promise<{
    edges: KnowledgeCrystalEdge[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.sourceId) {
      query.set("sourceId", params.sourceId);
    }
    if (params?.targetId) {
      query.set("targetId", params.targetId);
    }
    if (params?.relationship) {
      query.set("relationship", params.relationship);
    }
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.offset) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/edges${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge[]>>(
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
   * Update an edge's metadata
   */
  async update(id: string, params: UpdateKnowledgeCrystalEdgeParams): Promise<KnowledgeCrystalEdge> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge>>(
      "PATCH",
      `/v1/edges/${encodeURIComponent(id)}`,
      params
    );
    return response.data;
  }

  /**
   * Delete an edge
   */
  async delete(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/edges/${encodeURIComponent(id)}`
    );
  }
}
