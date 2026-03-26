/**
 * Events Resource (P19 — Real-Time Event Streaming)
 *
 * Provides a typed SSE client for the engram GET /events endpoint.
 *
 * @example
 * ```typescript
 * const sub = client.events.subscribeWithFetch(
 *   ["crystal.created", "note.created"],
 *   (event) => { console.log(event.type, event.entity_id); }
 * );
 *
 * // Later — close the connection
 * sub.close();
 * ```
 */

import type { EngramClient } from "../client.js";
import { BaseResource } from "./base.js";

// ============================================================================
// Types (mirrors engram/src/types/events.ts)
// ============================================================================

export type EngramEventType =
  | "crystal.created"
  | "crystal.updated"
  | "crystal.deleted"
  | "note.created"
  | "note.updated"
  | "note.deleted"
  | "session.started"
  | "session.ended"
  | "coherence.contradiction_detected";

export interface BaseEngramStreamEvent {
  id: string;
  type: EngramEventType;
  timestamp: string;
  entity_type: "crystal" | "note" | "session" | "coherence";
  entity_id: string;
  summary: string;
  data: Record<string, unknown>;
}

export type EngramStreamEventCallback = (event: BaseEngramStreamEvent) => void;

/**
 * An active SSE subscription. Call `.close()` to disconnect.
 */
export interface EventSubscription {
  /** Close the SSE connection and clean up resources. */
  close(): void;
}

// ============================================================================
// Resource
// ============================================================================

export class EventsResource extends BaseResource {
  constructor(client: EngramClient) {
    super(client);
  }

  /**
   * Subscribe to a real-time SSE stream from the engram server.
   *
   * **WARNING:** This method uses the browser/Node `EventSource` API which does
   * NOT support custom headers. The API key is computed but never sent to the
   * server, so authentication will silently fail. This method only works with
   * unauthenticated endpoints.
   *
   * Use {@link subscribeWithFetch} instead — it sends auth headers correctly.
   *
   * @deprecated Use {@link subscribeWithFetch} which correctly sends authentication headers.
   * @param types - Event types to filter for. Pass empty array or omit to receive all events.
   * @param onEvent - Callback invoked for each received event.
   * @param onError - Optional callback invoked on connection errors.
   * @returns An `EventSubscription` with a `.close()` method.
   */
  subscribe(
    types: EngramEventType[] | undefined,
    onEvent: EngramStreamEventCallback,
    onError?: (err: Error) => void
  ): EventSubscription {
    const baseUrl = this.client.baseUrl.replace(/\/$/, "");
    const query = types && types.length > 0 ? `?types=${types.join(",")}` : "";
    const url = `${baseUrl}/events${query}`;

    const apiKey = this.client.apiKey;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const source = new EventSource(url);
    let closed = false;

    source.onmessage = (ev) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(ev.data) as BaseEngramStreamEvent;
        onEvent(parsed);
      } catch (parseErr) {
        onError?.(
          new Error(
            `Malformed SSE frame: failed to parse event data as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          )
        );
      }
    };

    source.onerror = (ev) => {
      if (closed) return;
      onError?.(new Error(`SSE connection error: ${JSON.stringify(ev)}`));
    };

    return {
      close() {
        closed = true;
        source.close();
      },
    };
  }

  /**
   * Subscribe to a real-time SSE stream using the Fetch API.
   *
   * This is the **recommended** method for subscribing to events. Unlike
   * {@link subscribe}, this method correctly sends authentication headers
   * (`X-API-Key`) and works in both browser and Node.js environments.
   *
   * @param types - Event types to filter for. Pass empty array or omit to receive all events.
   * @param onEvent - Callback invoked for each received event.
   * @param onError - Optional callback invoked on errors.
   * @returns An `EventSubscription` with a `.close()` method.
   */
  subscribeWithFetch(
    types: EngramEventType[] | undefined,
    onEvent: EngramStreamEventCallback,
    onError?: (err: Error) => void
  ): EventSubscription {
    const baseUrl = this.client.baseUrl.replace(/\/$/, "");
    const query = types && types.length > 0 ? `?types=${types.join(",")}` : "";
    const url = `${baseUrl}/events${query}`;

    const apiKey = this.client.apiKey;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const controller = new AbortController();
    let closed = false;

    const run = async () => {
      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE fetch failed: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;
              try {
                const event = JSON.parse(jsonStr) as BaseEngramStreamEvent;
                onEvent(event);
              } catch (parseErr) {
                onError?.(
                  new Error(
                    `Malformed SSE frame: failed to parse event data as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
                  )
                );
              }
            }
          }
        }
      } catch (err) {
        if (closed) return; // Normal close
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void run();

    return {
      close() {
        closed = true;
        controller.abort();
      },
    };
  }
}
