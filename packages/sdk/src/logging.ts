/**
 * Client-side observability plumbing for the Engram SDK.
 *
 * The SDK has zero runtime dependencies by design, so the logger contract is
 * a minimal STRUCTURAL interface rather than an import from @centient/logger.
 * A real `@centient/logger` `Logger` satisfies {@link ClientLogger} directly
 * (its context-first `debug`/`warn` overloads match the shape), but any object
 * with the same two methods works.
 *
 * Sanitization contract: every value the client logs is routed through the
 * helpers in this module. The client never logs headers, request bodies, or
 * full URLs — only the HTTP method and the sanitized pathname (query strings
 * and fragments are stripped, since they can carry search text, identifiers,
 * or credential material).
 */

/**
 * Minimal structural logger accepted by {@link EngramClientConfig.logger}.
 *
 * Shape-compatible with `@centient/logger`'s `Logger` (context object first,
 * message second), without making `@centient/logger` a runtime dependency of
 * the SDK. The client emits:
 *
 * - `debug` — one entry per retry (attempt number, delay, error class,
 *   method + sanitized path).
 * - `warn` — retries exhausted, and request timeouts.
 *
 * When no logger is injected the client is completely silent (no console
 * fallback).
 */
export interface ClientLogger {
  /** Per-retry diagnostics. */
  debug(context: Record<string, unknown>, message: string): void;
  /** Retries exhausted / request timed out. */
  warn(context: Record<string, unknown>, message: string): void;
}

/**
 * Default logger: discards everything. Guarantees zero logging (and zero
 * console output) when the consumer does not inject a logger.
 * @internal
 */
export const NOOP_CLIENT_LOGGER: ClientLogger = {
  debug: () => {},
  warn: () => {},
};

/**
 * Sanitize a request path for logging: keep the pathname only, dropping the
 * query string and fragment. Query strings can carry search text, identifiers,
 * or credential material and must never reach a log line.
 * @internal
 */
export function sanitizeRequestPath(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * Reduce an unknown thrown value to its error class name for logging. Error
 * messages are deliberately NOT logged — they can embed URLs (including query
 * strings) or response fragments.
 * @internal
 */
export function sanitizeErrorClass(error: unknown): string {
  if (error instanceof Error) {
    return error.name || error.constructor.name;
  }
  // Non-Error throwables reduce to their typeof on purpose: stringifying the
  // value (or its toString) could leak embedded content into a log line. The
  // one refinement is `null`, whose typeof is the misleading "object".
  return error === null ? "null" : typeof error;
}
