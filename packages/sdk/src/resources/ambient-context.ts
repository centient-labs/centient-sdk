/**
 * Ambient Context Resource
 *
 * Resource-based SDK interface for role-biased ambient knowledge context.
 * Returns crystals ranked by relevance to the current agent's role.
 */

import { unwrapDataObject, requireArray } from "../validate.js";
import { BaseResource } from "./base.js";

const RESOURCE = "ambient-context";

// ============================================================================
// Types
// ============================================================================

export interface AmbientCrystal {
  id: string;
  title: string;
  description: string | null;
  nodeType: string;
  tags: string[];
  relevanceScore: number;
}

export interface GetAmbientContextParams {
  sessionId: string;
  role?: string;
  limit?: number;
}

// ============================================================================
// Resource
// ============================================================================

export class AmbientContextResource extends BaseResource {
  /**
   * Fetch ambient crystals for a session, optionally biased by agent role.
   *
   * When role is provided, crystals with tags matching the role string
   * are ranked higher. Results are limited to top-N (default 10).
   */
  async get(params: GetAmbientContextParams): Promise<AmbientCrystal[]> {
    const searchParams = new URLSearchParams({
      sessionId: params.sessionId,
    });
    if (params.role) searchParams.set("role", params.role);
    if (params.limit !== undefined)
      searchParams.set("limit", String(params.limit));

    const route = "GET /v1/ambient-context";
    const response = await this.request<{
      data: { ambientCrystals: AmbientCrystal[] };
    }>("GET", `/v1/ambient-context?${searchParams.toString()}`);
    const data = unwrapDataObject(response, route, RESOURCE);
    return requireArray<AmbientCrystal>(data.ambientCrystals, route, RESOURCE);
  }
}
