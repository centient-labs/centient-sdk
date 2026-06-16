/**
 * Runtime response-shape validation (issue #62).
 *
 * Shared, hand-rolled structural guards for the three response families the
 * Engram server emits after the 0.34.0 envelope realignment:
 *
 *  1. **Standard envelope** — `{ data, meta? }`. Most resources (edges,
 *     entities, terrafirma, gc, session-coordination, and the enveloped
 *     `/v1/sync/*` routes) unwrap `response.data`. {@link unwrapData} narrows
 *     `data` to a non-null object/array before the caller reads its fields.
 *  2. **Sync success envelope** — `{ success, data }`. The server's sync routes
 *     wrap their payload identically to (1) once unwrapped; the `success`
 *     discriminator (when present) is asserted by {@link unwrapData} too.
 *  3. **Bare body** — peers (`{ peer }`, `{ peers }`) and maintenance
 *     (`{ deleted, ... }`, `{ vacuumed, ... }`) return un-enveloped objects.
 *     {@link requireObject} / {@link requireField} guard these directly.
 *
 * Zero runtime dependencies: every guard is a hand-rolled `typeof`/`Array`
 * structural check — no zod. This generalizes the per-resource guards #64
 * added to the sync resource so every read path routes through one boundary
 * (P1 — root cause over per-resource bandaids; P6 — validate at the HTTP edge,
 * trust internal data after).
 *
 * On a contract violation every guard throws {@link ResponseShapeError}, which
 * is non-retryable (a malformed body is deterministic): callers see exactly one
 * `fetch` before the throw. See the error's JSDoc for the recovery contract.
 *
 * @internal Not part of the public API surface — stripped from the published
 *   `.d.ts` by `stripInternal` (same as the request helpers, #63). The only
 *   public symbol this work adds is the `ResponseShapeError` class.
 */

import { ResponseShapeError } from "./errors.js";

/** A JSON value narrowed to a non-null, non-array object. */
export type JsonObject = Record<string, unknown>;

/** True for a non-null, non-array object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Assert that a response body is a non-null object (the precondition for any
 * field read). Throws {@link ResponseShapeError} otherwise. Used for the bare
 * body family and as the first step of envelope unwrapping.
 *
 * @param body - the parsed response body
 * @param path - the request path, for the error message (e.g. `POST /v1/sync/push`)
 * @param resource - the resource family (e.g. `sync`)
 */
export function requireObject(
  body: unknown,
  path: string,
  resource: string,
): JsonObject {
  if (!isObject(body)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (expected a JSON object, got ${describe(body)})`,
      path,
      resource,
    );
  }
  return body;
}

/**
 * Unwrap the standard `{ data, meta? }` / sync `{ success, data }` envelope,
 * narrowing `data` to a non-null object or array. Throws
 * {@link ResponseShapeError} when the envelope is missing, `data` is
 * `null`/`undefined`/a primitive, or (when present) `success === false`.
 *
 * The returned value is the inner payload `T`; the caller validates `T`'s own
 * fields with {@link requireField} / {@link requireArray} as needed.
 *
 * @param body - the parsed response body (the full envelope)
 * @param path - the request path, for the error message
 * @param resource - the resource family
 */
export function unwrapData<T>(
  body: { data: T } | unknown,
  path: string,
  resource: string,
): T;
export function unwrapData<T>(body: unknown, path: string, resource: string): T {
  const envelope = requireObject(body, path, resource);
  // The sync `{ success, data }` envelope: a `success: false` here is a
  // contract violation (server error bodies are routed through parseApiError
  // on the non-2xx path before we ever reach validation), not a payload.
  if ("success" in envelope && envelope.success === false) {
    throw new ResponseShapeError(
      `Unexpected ${path} response: envelope reports success=false on a 2xx body`,
      path,
      resource,
    );
  }
  if (!("data" in envelope)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (missing "data" envelope key)`,
      path,
      resource,
    );
  }
  const data = envelope.data;
  // `data` may legitimately be an array (list endpoints) or an object; reject
  // null/undefined/primitives so a downstream field/element read can't TypeError.
  if (data === null || data === undefined || typeof data !== "object") {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (envelope "data" is ${describe(data)}, expected object or array)`,
      path,
      resource,
    );
  }
  return data as T;
}

/**
 * Like {@link unwrapData}, but for endpoints whose `data` may legitimately be
 * `null` (e.g. "no active branch", "no bridge row"). Validates the envelope
 * shape — the body must be an object with a `data` key and `success !== false`
 * — but returns `data` as-is, allowing `null`. A missing envelope or a
 * `data: undefined` (key absent) is still a contract violation.
 *
 * @param body - the parsed response body (the full envelope)
 * @param path - the request path, for the error message
 * @param resource - the resource family
 */
export function unwrapNullableData<T>(
  body: unknown,
  path: string,
  resource: string,
): T | null {
  const envelope = requireObject(body, path, resource);
  if ("success" in envelope && envelope.success === false) {
    throw new ResponseShapeError(
      `Unexpected ${path} response: envelope reports success=false on a 2xx body`,
      path,
      resource,
    );
  }
  if (!("data" in envelope)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (missing "data" envelope key)`,
      path,
      resource,
    );
  }
  return (envelope.data ?? null) as T | null;
}

/**
 * Like {@link unwrapData}, but for object payloads whose individual fields the
 * caller then validates with {@link requireField}. Returns the inner `data`
 * narrowed to a {@link JsonObject} (rejecting arrays/primitives/null), so the
 * caller can index fields without a `as unknown as` double-cast. The caller
 * applies a single `as T` on the validated object at the `return`.
 *
 * @param body - the parsed response body (the full envelope)
 * @param path - the request path, for the error message
 * @param resource - the resource family
 */
export function unwrapDataObject(
  body: unknown,
  path: string,
  resource: string,
): JsonObject {
  const data = unwrapData<unknown>(body, path, resource);
  if (!isObject(data)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (envelope "data" is ${describe(data)}, expected an object)`,
      path,
      resource,
    );
  }
  return data;
}

/**
 * Assert that `value[key]` exists and passes `check`, returning the validated
 * object narrowed nowhere (the caller keeps its declared type). Throws
 * {@link ResponseShapeError} with the failing `key` named.
 *
 * @example
 * ```typescript
 * const data = unwrapData<SyncStatus>(body, path, "sync");
 * requireField(data, "instanceId", isString, path, "sync");
 * requireField(data, "peersCount", isNumber, path, "sync");
 * ```
 */
export function requireField(
  obj: JsonObject,
  key: string,
  check: (v: unknown) => boolean,
  path: string,
  resource: string,
): void {
  if (!check(obj[key])) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (field "${key}" is ${describe(obj[key])})`,
      path,
      resource,
    );
  }
}

/**
 * Assert that `value` is an array, returning it typed as `T[]`. Throws
 * {@link ResponseShapeError} otherwise. Use after {@link unwrapData} for list
 * endpoints whose `data` is the array itself, or for bare `{ peers: [] }`
 * fields via {@link requireField}.
 */
export function requireArray<T>(
  value: unknown,
  path: string,
  resource: string,
): T[] {
  if (!Array.isArray(value)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (expected an array, got ${describe(value)})`,
      path,
      resource,
    );
  }
  return value as T[];
}

/**
 * Assert that `value` is an array, WITHOUT widening its element type (unlike
 * {@link requireArray}, which returns `T[]`). Use for payloads whose declared
 * type is a union of array types (e.g. `A[] | B[]`) that a widened `(A|B)[]`
 * would not satisfy. Throws {@link ResponseShapeError} when it is not an array.
 */
export function assertArray(
  value: unknown,
  path: string,
  resource: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ResponseShapeError(
      `Unexpected ${path} response shape (expected an array, got ${describe(value)})`,
      path,
      resource,
    );
  }
}

// ---------------------------------------------------------------------------
// Field predicates — reusable typeof guards for use with requireField.
// ---------------------------------------------------------------------------

/** `typeof v === "string"`. */
export function isString(v: unknown): boolean {
  return typeof v === "string";
}

/**
 * `typeof v === "number" && !Number.isNaN(v)` — a finite-or-infinite number that
 * is **not** `NaN`. NaN is rejected because it almost always signals a serialized
 * non-number (e.g. a malformed numeric field) rather than a valid wire value.
 */
export function isNumber(v: unknown): boolean {
  return typeof v === "number" && !Number.isNaN(v);
}

/** `typeof v === "boolean"`. */
export function isBoolean(v: unknown): boolean {
  return typeof v === "boolean";
}

/** A string, or `null`/absent — a nullable string wire field. */
export function isNullableString(v: unknown): boolean {
  return v == null || typeof v === "string";
}

/**
 * A number (per {@link isNumber}, so `NaN` is rejected), or `null`/absent — a
 * nullable numeric wire field (e.g. a similarity `confidence` that is `null`
 * when no match was found).
 */
export function isNullableNumber(v: unknown): boolean {
  return v == null || isNumber(v);
}

/**
 * Render a value's runtime category for an error message without leaking the
 * value itself (a body may carry user content). Returns the type, or the
 * literal `null`/`undefined`, or `array`.
 */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
