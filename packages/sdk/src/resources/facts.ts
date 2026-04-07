/**
 * Facts Resource
 *
 * Resource-based SDK interface for bi-temporal fact management.
 * Provides access to versioned facts with point-in-time queries
 * and full version history.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export interface Fact {
  id: string;
  key: string;
  value: Record<string, unknown>;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFactParams {
  key: string;
  value: Record<string, unknown>;
  validAt?: string;
}

export interface UpdateFactParams {
  value: Record<string, unknown>;
  validAt?: string;
}

export interface FactHistoryParams {
  validFrom?: string;
  validTo?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// API Response Types (internal)
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
// Facts Resource
// ============================================================================

/**
 * Facts Resource — manages bi-temporal facts with versioned history.
 *
 * @example
 * ```typescript
 * // Create a new fact
 * const fact = await client.facts.create({
 *   key: "user.preferences.theme",
 *   value: { mode: "dark" },
 * });
 *
 * // Get a fact by key
 * const current = await client.facts.getByKey("user.preferences.theme");
 *
 * // Get a fact as it was at a specific point in time
 * const historical = await client.facts.get(fact.id, {
 *   asOf: "2025-01-15T00:00:00Z",
 * });
 *
 * // Update a fact
 * const updated = await client.facts.update(fact.id, {
 *   value: { mode: "light" },
 * });
 *
 * // Browse version history
 * const history = await client.facts.getHistory(fact.id, { limit: 10 });
 * ```
 */
export class FactsResource extends BaseResource {
  /**
   * Create a new fact.
   */
  async create(params: CreateFactParams): Promise<Fact> {
    const response = await this.request<ApiSuccessResponse<Fact>>(
      "POST",
      "/v1/facts",
      params
    );
    return response.data;
  }

  /**
   * Get a fact by ID, optionally as of a specific point in time.
   */
  async get(id: string, options?: { asOf?: string }): Promise<Fact> {
    const query = new URLSearchParams();
    if (options?.asOf) query.set("asOf", options.asOf);

    const queryString = query.toString();
    const path = `/v1/facts/${encodeURIComponent(id)}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<Fact>>("GET", path);
    return response.data;
  }

  /**
   * Get a fact by its key.
   */
  async getByKey(key: string): Promise<Fact> {
    const query = new URLSearchParams();
    query.set("key", key);

    const path = `/v1/facts?${query.toString()}`;

    const response = await this.request<ApiSuccessResponse<Fact>>("GET", path);
    return response.data;
  }

  /**
   * Update an existing fact.
   */
  async update(id: string, params: UpdateFactParams): Promise<Fact> {
    const response = await this.request<ApiSuccessResponse<Fact>>(
      "PATCH",
      `/v1/facts/${encodeURIComponent(id)}`,
      params
    );
    return response.data;
  }

  /**
   * Get the version history of a fact.
   */
  async getHistory(
    id: string,
    params?: FactHistoryParams
  ): Promise<{ versions: Fact[]; total: number; hasMore: boolean }> {
    const query = new URLSearchParams();
    if (params?.validFrom) query.set("validFrom", params.validFrom);
    if (params?.validTo) query.set("validTo", params.validTo);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));

    const queryString = query.toString();
    const path = `/v1/facts/${encodeURIComponent(id)}/history${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<Fact[]>>(
      "GET",
      path
    );

    return {
      versions: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }
}
