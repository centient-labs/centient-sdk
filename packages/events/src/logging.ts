/**
 * Logger injection for @centient/events.
 *
 * The stream and JSONL paths emit internal diagnostics (backpressure drops,
 * write errors, malformed-line skips). By default these route to a
 * `@centient/logger` component logger so existing consumers see zero change.
 * Consumers who want event-internal logging on their own logger instance can
 * inject any object satisfying {@link EventsLogger} via the factory options.
 *
 * The structural interface mirrors `@centient/logger`'s `Logger` shape
 * (context-object-first overload plus message-only overload), so a real
 * `@centient/logger` `Logger` — or the SDK's own injected logger — satisfies
 * it directly. `@centient/logger` remains the default implementation, so it
 * stays a runtime dependency; injecting consumers simply bypass it.
 */

import { createComponentLogger } from "@centient/logger";

/**
 * Minimal structural logger accepted by the events factory options.
 *
 * Shape-compatible with `@centient/logger`'s `Logger`: each level accepts
 * either `(context, message)` or `(message)`. The events internals use all
 * four levels — `debug` (lifecycle), `info` (subscriber/reader created),
 * `warn` (backpressure, malformed lines, closed-stream calls), and `error`
 * (write/serialization failures).
 */
export interface EventsLogger {
  debug(context: Record<string, unknown>, message: string): void;
  debug(message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  info(message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  error(context: Record<string, unknown>, message: string): void;
  error(message: string): void;
}

/**
 * Default component name used when a code path does not specify one. The
 * stream factory logs under `centient:events`; the JSONL and replay paths
 * pass their own sub-component (`events:jsonl`, `events:replay`) so the
 * default-path log output is byte-for-byte what it was before injection.
 * @internal
 */
export const DEFAULT_LOGGER_COMPONENT = "events";

/**
 * Lazily-constructed default loggers, keyed by component name. Each
 * `@centient/logger` component logger is built at most once, on first access,
 * and only when no logger was injected — so importing the package never
 * eagerly constructs a logger and the default behavior is identical to before
 * logger injection existed.
 *
 * This is the SINGLE `createComponentLogger` construction site for the events
 * package; every other module resolves its logger through {@link resolveLogger}.
 * @internal
 */
const cachedDefaults = new Map<string, EventsLogger>();

/**
 * Resolve the logger for an events code path: the injected logger if the
 * consumer supplied one, otherwise the lazily-built `@centient/logger`
 * default for the given component. Constructing the default is deferred until
 * first use so the zero-injection path stays a no-op at import time.
 * @internal
 */
export function resolveLogger(
  injected?: EventsLogger,
  component: string = DEFAULT_LOGGER_COMPONENT,
): EventsLogger {
  if (injected) return injected;
  let cached = cachedDefaults.get(component);
  if (!cached) {
    // Lazy default construction: keep @centient/logger as the default impl
    // (P5 — identical behavior to today). The module is statically imported,
    // but the component logger is built only on first use, so neither
    // importing the package nor injecting a custom logger constructs it.
    cached = createComponentLogger("centient", component);
    cachedDefaults.set(component, cached);
  }
  return cached;
}
