/**
 * Agents Resource
 *
 * Resource-based SDK interface for agent identity management.
 * Provides CRUD operations on agent records with idempotent upsert on creation.
 */

import { ResponseShapeError } from "../errors.js";
import { unwrapDataObject, requireArray, type JsonObject } from "../validate.js";
import { BaseResource } from "./base.js";

const RESOURCE = "agents";

/**
 * Narrow the `{ agent }` field of an unwrapped agents envelope to an
 * `AgentIdentity`, throwing a structured {@link ResponseShapeError} when the
 * server omits it or returns a non-object.
 */
function requireAgent(data: JsonObject, route: string): AgentIdentity {
  const agent = data.agent;
  if (!agent || typeof agent !== "object") {
    throw new ResponseShapeError(
      `Unexpected ${route} response shape (expected { data: { agent } })`,
      route,
      RESOURCE,
    );
  }
  return agent as AgentIdentity;
}

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
    const route = "POST /v1/agents";
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("POST", "/v1/agents", params);
    return requireAgent(unwrapDataObject(response, route, RESOURCE), route);
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

    const route = `GET ${path}`;
    const response = await this.request<{
      data: { agents: AgentIdentity[] };
    }>("GET", path);
    return requireArray<AgentIdentity>(
      unwrapDataObject(response, route, RESOURCE).agents,
      route,
      RESOURCE,
    );
  }

  /**
   * Get a single agent by its internal UUID.
   */
  async get(agentId: string): Promise<AgentIdentity> {
    const route = `GET /v1/agents/${agentId}`;
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("GET", `/v1/agents/${agentId}`);
    return requireAgent(unwrapDataObject(response, route, RESOURCE), route);
  }

  /**
   * Update an agent's display name and/or permissions.
   */
  async update(
    agentId: string,
    params: UpdateAgentParams
  ): Promise<AgentIdentity> {
    const route = `PUT /v1/agents/${agentId}`;
    const response = await this.request<{
      data: { agent: AgentIdentity };
    }>("PUT", `/v1/agents/${agentId}`, params);
    return requireAgent(unwrapDataObject(response, route, RESOURCE), route);
  }

  /**
   * Soft-delete an agent and clean up associated ACL rows.
   */
  async delete(agentId: string): Promise<{ deleted: true }> {
    const route = `DELETE /v1/agents/${agentId}`;
    const response = await this.request<{
      data: { deleted: true };
    }>("DELETE", `/v1/agents/${agentId}`);
    return unwrapDataObject(response, route, RESOURCE) as { deleted: true };
  }
}
