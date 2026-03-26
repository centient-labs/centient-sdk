/**
 * Base Resource Class
 *
 * Abstract base class for all SDK resources.
 * Provides access to the client's request method.
 */

import type { EngramClient } from "../client.js";

export abstract class BaseResource {
  constructor(protected client: EngramClient) {}

  /**
   * Make an HTTP request through the client.
   */
  protected request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    return this.client._request<T>(method, path, body);
  }
}
