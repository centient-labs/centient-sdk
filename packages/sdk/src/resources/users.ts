/**
 * Users Resource
 *
 * Resource-based SDK interface for user management.
 * Provides access to user creation, listing, lookup, and deletion
 * with associated API key provisioning.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  name: string;
  displayName: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  value: string;
}

export interface CreateUserParams {
  name: string;
  displayName?: string;
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
// Users Resource
// ============================================================================

/**
 * Users Resource — manages user accounts and API key provisioning.
 *
 * @example
 * ```typescript
 * // Create a new user (returns user + initial API key)
 * const { user, key } = await client.users.create({ name: "alice" });
 *
 * // List all users
 * const users = await client.users.list();
 *
 * // Get a user by ID or name
 * const user = await client.users.get("alice");
 *
 * // Delete a user and revoke their keys
 * const result = await client.users.delete("alice", { revokeKeys: true });
 * ```
 */
export class UsersResource extends BaseResource {
  /**
   * Create a new user. Returns the user and an initial API key.
   */
  async create(params: CreateUserParams): Promise<{ user: User; key: ApiKey }> {
    const response = await this.request<
      ApiSuccessResponse<{ user: User; key: ApiKey }>
    >("POST", "/v1/users", params);
    return response.data;
  }

  /**
   * List all users.
   */
  async list(params?: { limit?: number; offset?: number }): Promise<User[]> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const path = `/v1/users${qs ? `?${qs}` : ""}`;
    const response = await this.request<
      ApiSuccessResponse<{ users: User[] }>
    >("GET", path);
    return response.data.users;
  }

  /**
   * Get a user by ID or name.
   */
  async get(idOrName: string): Promise<User> {
    const response = await this.request<
      ApiSuccessResponse<{ user: User }>
    >("GET", `/v1/users/${encodeURIComponent(idOrName)}`);
    return response.data.user;
  }

  /**
   * Delete a user by ID or name, optionally revoking all their API keys.
   */
  async delete(
    idOrName: string,
    options?: { revokeKeys?: boolean }
  ): Promise<{ deleted: true; revokedKeys: number }> {
    const query = new URLSearchParams();
    if (options?.revokeKeys) query.set("revokeKeys", "true");

    const queryString = query.toString();
    const path = `/v1/users/${encodeURIComponent(idOrName)}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<
      ApiSuccessResponse<{ deleted: true; revokedKeys: number }>
    >("DELETE", path);
    return response.data;
  }
}
