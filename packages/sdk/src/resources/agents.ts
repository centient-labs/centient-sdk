/**
 * Agents Resource
 *
 * Resource-based SDK interface for agent identity management.
 * Provides CRUD operations on agent records with idempotent upsert on creation.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentIdentity {
  agentId: string;
  externalId: string;
  displayName: string;
  role: string;
  permissions: string[];
  ownerUserId: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface CreateAgentParams {
  externalId: string;
  displayName: string;
  role?: string;
  permissions?: string[];
  ownerUserId?: string | null;
}

export interface UpdateAgentParams {
  displayName?: string;
  permissions?: string[];
}

export interface ListAgentsParams {
  ownerUserId?: string;
}

// ============================================================================
// Resource
// ============================================================================

export class AgentsResource extends BaseResource {
  /**
   * Create or idempotently upsert an agent.
   *
   * Returns 200 (not 201) because this is an idempotent upsert operation.
   * If an agent with the given externalId already exists (including soft-deleted),
   * it is updated/resurrected rather than duplicated.
   */
  async create(params: CreateAgentParams): Promise<AgentIdentity> {
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("POST", "/v1/agents", params);
    return response.data.agent;
  }

  /**
   * List all non-deleted agents.
   * Optionally filter by ownerUserId.
   */
  async list(params?: ListAgentsParams): Promise<AgentIdentity[]> {
    const searchParams = new URLSearchParams();
    if (params?.ownerUserId)
      searchParams.set("ownerUserId", params.ownerUserId);

    const query = searchParams.toString();
    const path = query ? `/v1/agents?${query}` : "/v1/agents";

    const response = await this.request<{
      data: { agents: AgentIdentity[] };
    }>("GET", path);
    return response.data.agents;
  }

  /**
   * Get a single agent by its internal UUID.
   */
  async get(agentId: string): Promise<AgentIdentity> {
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("GET", `/v1/agents/${agentId}`);
    return response.data.agent;
  }

  /**
   * Update an agent's display name and/or permissions.
   */
  async update(
    agentId: string,
    params: UpdateAgentParams
  ): Promise<AgentIdentity> {
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("PUT", `/v1/agents/${agentId}`, params);
    return response.data.agent;
  }

  /**
   * Soft-delete an agent and clean up associated ACL rows.
   */
  async delete(agentId: string): Promise<{ deleted: true }> {
    const response = await this.request<{
      data: { deleted: true };
    }>("DELETE", `/v1/agents/${agentId}`);
    return response.data;
  }
}
