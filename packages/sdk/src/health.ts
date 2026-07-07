/**
 * Runtime guards for the health-route discriminated unions (engram-server
 * 0.50.0 — server #1175, SDK #145).
 *
 * The three health routes (`GET /v1/health`, `/v1/health/detailed`,
 * `/v1/health/ready`) return `oneOf` unions discriminated on `status` /
 * `ready`, and BOTH the 200 and the 503 response carry the same typed body.
 * These guards validate the discriminant plus each variant's required fields
 * (and shape-guard the nested `postgres` / `recovery` objects) before casting,
 * so a TS-bypassing caller — or a drifted server — fails loudly with
 * {@link ResponseShapeError} instead of TypeError-ing downstream
 * (P-no-silent-degradation; same style as `resources/consolidation.ts`).
 *
 * @internal Not part of the public API surface — stripped from the published
 *   `.d.ts` by `stripInternal`. The public symbols are the union types
 *   themselves (`HealthResponse`, `DetailedHealthResponse`, `ReadyResponse`).
 */

import { ResponseShapeError } from "./errors.js";
import {
  isBoolean,
  isNullableString,
  isNumber,
  isString,
  requireField,
  requireObject,
  type JsonObject,
} from "./validate.js";
import type {
  DetailedHealthResponse,
  HealthResponse,
  ReadyResponse,
} from "./types.js";

const RESOURCE = "health";

/**
 * Shape-guard a nested `recovery` object (`PostgresRecovery`): all five fields
 * are required on the wire, three of them nullable strings.
 */
function requireRecovery(value: unknown, route: string): void {
  const recovery = requireObject(value, route, RESOURCE);
  requireField(recovery, "active", isBoolean, route, RESOURCE);
  requireField(recovery, "attempts", isNumber, route, RESOURCE);
  requireField(recovery, "nextRetryAtIso", isNullableString, route, RESOURCE);
  requireField(recovery, "lastError", isNullableString, route, RESOURCE);
  requireField(recovery, "disarmedReason", isNullableString, route, RESOURCE);
}

/** A `status` outside the union is contract drift — name the field, not the value. */
function unknownDiscriminant(
  route: string,
  field: string,
  expected: string,
): ResponseShapeError {
  return new ResponseShapeError(
    `Unexpected ${route} response shape (field "${field}" is not one of ${expected})`,
    route,
    RESOURCE,
  );
}

/**
 * Validate a `GET /v1/health` body against the 0.50.0 `HealthResponse` union
 * (`HealthOkResponse | HealthDegradedResponse | HealthUnhealthyResponse`).
 * All three variants require `status` + `version`; the degraded variant
 * additionally requires `error` + `errorCode` and may carry `recovery`.
 */
export function parseHealthResponse(
  body: unknown,
  route: string,
): HealthResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "status", isString, route, RESOURCE);
  requireField(obj, "version", isString, route, RESOURCE);
  switch (obj.status) {
    case "ok":
    case "unhealthy":
      return obj as unknown as HealthResponse;
    case "degraded":
      requireField(obj, "error", isString, route, RESOURCE);
      requireField(obj, "errorCode", isString, route, RESOURCE);
      if (obj.recovery !== undefined) requireRecovery(obj.recovery, route);
      return obj as unknown as HealthResponse;
    default:
      throw unknownDiscriminant(route, "status", '"ok"|"degraded"|"unhealthy"');
  }
}

/**
 * Validate a `GET /v1/health/detailed` body against the 0.50.0
 * `DetailedHealthResponse` union (`DetailedHealthOkResponse |
 * DetailedHealthDegradedResponse`; the server maps `status: "unhealthy"` to
 * the degraded variant). Both variants require `status` + `version` + a
 * `postgres` object (whose own `status` discriminant is guarded); `uptime`,
 * when present, must be a STRING (it was a number before 0.50.0 — guarding
 * the type here surfaces a pre-0.50.0 server as drift instead of silently
 * returning a mistyped field).
 */
export function parseDetailedHealthResponse(
  body: unknown,
  route: string,
): DetailedHealthResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "status", isString, route, RESOURCE);
  requireField(obj, "version", isString, route, RESOURCE);
  const postgres = requireObject(obj.postgres, route, RESOURCE);
  requireField(postgres, "status", isString, route, RESOURCE);
  if (obj.uptime !== undefined) {
    requireField(obj, "uptime", isString, route, RESOURCE);
  }
  switch (obj.status) {
    case "ok":
      return obj as unknown as DetailedHealthResponse;
    case "degraded":
    case "unhealthy":
      if (obj.recovery !== undefined) requireRecovery(obj.recovery, route);
      return obj as unknown as DetailedHealthResponse;
    default:
      throw unknownDiscriminant(route, "status", '"ok"|"degraded"|"unhealthy"');
  }
}

/**
 * Validate a `GET /v1/health/ready` body against the 0.50.0 `ReadyResponse`
 * union (`ReadyTrueResponse | ReadyFalseResponse`), discriminated on the
 * boolean `ready`. The true variant requires `version`/`latencyMs`/
 * `embedding`; the false variant requires only `reason`.
 */
export function parseReadyResponse(body: unknown, route: string): ReadyResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "ready", isBoolean, route, RESOURCE);
  if (obj.ready === true) {
    requireField(obj, "version", isString, route, RESOURCE);
    requireField(obj, "latencyMs", isNumber, route, RESOURCE);
    requireField(obj, "embedding", isString, route, RESOURCE);
  } else {
    requireField(obj, "reason", isString, route, RESOURCE);
  }
  return obj as unknown as ReadyResponse;
}

/**
 * Leniently read `version` from a health body for the compatibility check —
 * every 0.50.0 variant requires `version`, but `checkCompatibility()` reports
 * `"unknown"` (compatible: false) rather than throwing when a server omits
 * it, preserving its historical never-throw-on-shape contract.
 */
export function readHealthVersion(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as JsonObject).version === "string"
  ) {
    return (body as JsonObject).version as string;
  }
  return "unknown";
}
