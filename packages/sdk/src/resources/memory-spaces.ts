/**
 * Memory Spaces Resource
 *
 * Resource-based SDK interface for shared memory space management.
 * Memory spaces allow agents to collaborate within shared knowledge containers.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export type MemorySpacePermission = "read" | "write" | "admin";

export interface MemorySpace {
  id: string;
  title: string;
  description: string | null;
  visibility: "private" | "shared";
  nodeType: "memory_space";
  createdAt: string;
  updatedAt: string;
}

export interface MemorySpaceWithMembers extends MemorySpace {
  members: MemorySpaceMember[];
}

export interface MemorySpaceMember {
  agentId: string;
  permission: MemorySpacePermission;
  joinedAt: string;
}

export interface CreateMemorySpaceParams {
  title: string;
  description?: string;
  visibility?: "private" | "shared";
  initialMembers?: Array<{ agentId: string; permission: MemorySpacePermission }>;
}

export interface ListMemorySpacesParams {
  agentId?: string;
}

export interface JoinMemorySpaceParams {
  agentId: string;
  permission: MemorySpacePermission;
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
// Memory Spaces Resource
// ============================================================================

/**
 * Memory Spaces Resource - manages shared memory spaces for multi-agent collaboration.
 */
export class MemorySpacesResource extends BaseResource {
  /**
   * List memory spaces, optionally filtered by agent membership.
   */
  async list(params?: ListMemorySpacesParams): Promise<MemorySpace[]> {
    const query = new URLSearchParams();
    if (params?.agentId) {
      query.set("agentId", params.agentId);
    }

    const queryString = query.toString();
    const path = `/v1/memory-spaces${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<{ spaces: MemorySpace[] }>>(
      "GET",
      path
    );
    return response.data.spaces;
  }

  /**
   * Create a new memory space.
   */
  async create(params: CreateMemorySpaceParams): Promise<MemorySpace> {
    const response = await this.request<ApiSuccessResponse<{ space: MemorySpace }>>(
      "POST",
      "/v1/memory-spaces",
      params
    );
    return response.data.space;
  }

  /**
   * Get a memory space by ID, including its members.
   */
  async get(spaceId: string): Promise<MemorySpaceWithMembers> {
    const response = await this.request<ApiSuccessResponse<{ space: MemorySpaceWithMembers }>>(
      "GET",
      `/v1/memory-spaces/${encodeURIComponent(spaceId)}`
    );
    return response.data.space;
  }

  /**
   * Join a memory space as an agent with a given permission level.
   */
  async join(spaceId: string, params: JoinMemorySpaceParams): Promise<MemorySpaceMember> {
    const response = await this.request<ApiSuccessResponse<{ member: MemorySpaceMember }>>(
      "POST",
      `/v1/memory-spaces/${encodeURIComponent(spaceId)}/join`,
      params
    );
    return response.data.member;
  }

  /**
   * Leave a memory space (remove an agent from the space).
   */
  async leave(spaceId: string, agentId: string): Promise<{ removed: true }> {
    const query = new URLSearchParams();
    query.set("agentId", agentId);
    const qs = query.toString();
    const response = await this.request<ApiSuccessResponse<{ removed: true }>>(
      "DELETE",
      `/v1/memory-spaces/${encodeURIComponent(spaceId)}/leave${qs ? `?${qs}` : ""}`
    );
    return response.data;
  }
}
