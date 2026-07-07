/**
 * Runtime guards for the health-route discriminated unions (engram-server
 * 0.50.0 — server #1175, SDK #145).
 *
 * The three health routes (`GET /v1/health`, `/v1/health/detailed`,
 * `/v1/health/ready`) return `oneOf` unions discriminated on `status` /
 * `ready`, and BOTH the 200 and the 503 response carry the same typed body.
 * These guards validate the discriminant plus each variant's required fields,
 * shape-guard the nested objects (`postgres`, `recovery`, `migrations`,
 * `idleInTransaction`), and check every enum-typed field against the EXACT
 * union values the exported types advertise — the runtime guard is never
 * weaker than the type contract (mbot #146 R2). A TS-bypassing caller — or a
 * drifted server — fails loudly with {@link ResponseShapeError} instead of
 * TypeError-ing downstream (P-no-silent-degradation; same style as
 * `resources/consolidation.ts`).
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
  EmbeddingSubsystemState,
  HealthResponse,
  MigrationHealth,
  PostgresConnectionType,
  ReadyResponse,
} from "./types.js";

const RESOURCE = "health";

// ---------------------------------------------------------------------------
// Enum predicates — one list per exported string union, pinned to the type's
// members via `satisfies` so the runtime check and the advertised contract
// cannot drift apart independently.
// ---------------------------------------------------------------------------

/** Build a requireField predicate accepting exactly the given string values. */
function isOneOf(values: readonly string[]): (v: unknown) => boolean {
  return (v: unknown) => typeof v === "string" && values.includes(v);
}

const EMBEDDING_STATES = [
  "warming",
  "ready",
  "degraded",
] as const satisfies readonly EmbeddingSubsystemState[];
const isEmbeddingState = isOneOf(EMBEDDING_STATES);

const POSTGRES_CONNECTION_TYPES = [
  "external",
  "system",
  "embedded",
  "unavailable",
] as const satisfies readonly PostgresConnectionType[];
const isPostgresConnectionType = isOneOf(POSTGRES_CONNECTION_TYPES);

const MIGRATION_ERROR_CODES = [
  "lock_held",
  "statement_timeout",
  "lock_timeout",
  "migration_error",
] as const satisfies readonly NonNullable<MigrationHealth["lastErrorCode"]>[];
const isMigrationErrorCode = isOneOf(MIGRATION_ERROR_CODES);
/** `lastErrorCode` is required but nullable. */
const isNullableMigrationErrorCode = (v: unknown): boolean =>
  v === null || isMigrationErrorCode(v);

// ---------------------------------------------------------------------------
// Nested-object guards
// ---------------------------------------------------------------------------

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

/**
 * Shape-guard the required `postgres` block of a detailed-health variant.
 * `allowedStatuses` couples the nested discriminant to the parent variant,
 * exactly as the exported types do (`DetailedHealthOkResponse.postgres` is
 * `PostgresHealthOk` with `status: "ok"`; the degraded variant's block allows
 * `"degraded" | "unhealthy"`) — a nested `status` outside the parent's set is
 * contract drift, not a passable string (mbot #146 R2 MEDIUM).
 */
function requirePostgres(
  value: unknown,
  route: string,
  allowedStatuses: readonly string[],
): void {
  const postgres = requireObject(value, route, RESOURCE);
  requireField(postgres, "status", isOneOf(allowedStatuses), route, RESOURCE);
  if (postgres.type !== undefined) {
    requireField(postgres, "type", isPostgresConnectionType, route, RESOURCE);
  }
  if (postgres.latencyMs !== undefined) {
    requireField(postgres, "latencyMs", isNumber, route, RESOURCE);
  }
  if (postgres.idleInTransaction !== undefined) {
    const idle = requireObject(postgres.idleInTransaction, route, RESOURCE);
    requireField(idle, "count", isNumber, route, RESOURCE);
    requireField(idle, "oldestMs", isNumber, route, RESOURCE);
  }
}

/**
 * Shape-guard an optional `migrations` object (`MigrationHealth`): every field
 * is required on the wire when the object is present; `lastErrorCode` is a
 * bounded nullable enum.
 */
function requireMigrations(value: unknown, route: string): void {
  const migrations = requireObject(value, route, RESOURCE);
  requireField(migrations, "consecutiveFailures", isNumber, route, RESOURCE);
  requireField(migrations, "escalated", isBoolean, route, RESOURCE);
  requireField(migrations, "firstFailedAt", isNullableString, route, RESOURCE);
  requireField(migrations, "lastFailedAt", isNullableString, route, RESOURCE);
  requireField(
    migrations,
    "lastErrorCode",
    isNullableMigrationErrorCode,
    route,
    RESOURCE,
  );
  requireField(migrations, "message", isString, route, RESOURCE);
  requireField(migrations, "pendingIds", Array.isArray, route, RESOURCE);
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

// ---------------------------------------------------------------------------
// Route parsers
// ---------------------------------------------------------------------------

/**
 * Validate a `GET /v1/health` body against the 0.50.0 `HealthResponse` union
 * (`HealthOkResponse | HealthDegradedResponse | HealthUnhealthyResponse`).
 * All three variants require `status` + `version`; the degraded variant
 * additionally requires `error` + `errorCode` and may carry `recovery`.
 * Optional fields are type-checked when present.
 */
export function parseHealthResponse(
  body: unknown,
  route: string,
): HealthResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "status", isString, route, RESOURCE);
  requireField(obj, "version", isString, route, RESOURCE);
  // Optionals shared by every variant.
  if (obj.clusterId !== undefined) {
    requireField(obj, "clusterId", isNullableString, route, RESOURCE);
  }
  for (const key of ["dataDirPresent", "extensionsOk", "pgChildAlive"]) {
    if (obj[key] !== undefined) {
      requireField(obj, key, isBoolean, route, RESOURCE);
    }
  }
  switch (obj.status) {
    case "ok":
      return obj as unknown as HealthResponse;
    case "unhealthy":
      if (obj.error !== undefined) {
        requireField(obj, "error", isString, route, RESOURCE);
      }
      return obj as unknown as HealthResponse;
    case "degraded":
      requireField(obj, "error", isString, route, RESOURCE);
      requireField(obj, "errorCode", isString, route, RESOURCE);
      if (obj.recoveryHint !== undefined) {
        requireField(obj, "recoveryHint", isString, route, RESOURCE);
      }
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
 * `postgres` object, whose nested `status` discriminant must match the parent
 * variant's exact union values (`"ok"` under ok; `"degraded"|"unhealthy"`
 * under degraded — mbot #146 R2). `uptime`, when present, must be a STRING
 * (it was a number before 0.50.0 — guarding the type here surfaces a
 * pre-0.50.0 server as drift instead of silently returning a mistyped field);
 * `embedding` and `migrations.lastErrorCode` are checked against their exact
 * enum values.
 */
export function parseDetailedHealthResponse(
  body: unknown,
  route: string,
): DetailedHealthResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "status", isString, route, RESOURCE);
  requireField(obj, "version", isString, route, RESOURCE);
  if (obj.uptime !== undefined) {
    requireField(obj, "uptime", isString, route, RESOURCE);
  }
  if (obj.embedding !== undefined) {
    requireField(obj, "embedding", isEmbeddingState, route, RESOURCE);
  }
  if (obj.migrations !== undefined) requireMigrations(obj.migrations, route);
  switch (obj.status) {
    case "ok":
      requirePostgres(obj.postgres, route, ["ok"]);
      return obj as unknown as DetailedHealthResponse;
    case "degraded":
    case "unhealthy":
      requirePostgres(obj.postgres, route, ["degraded", "unhealthy"]);
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
 * `embedding`; the false variant requires only `reason`. `embedding` (on
 * either variant) must be one of the exact `EmbeddingSubsystemState` values;
 * the false variant's optional fields are type-checked when present.
 */
export function parseReadyResponse(body: unknown, route: string): ReadyResponse {
  const obj: JsonObject = requireObject(body, route, RESOURCE);
  requireField(obj, "ready", isBoolean, route, RESOURCE);
  if (obj.ready === true) {
    requireField(obj, "version", isString, route, RESOURCE);
    requireField(obj, "latencyMs", isNumber, route, RESOURCE);
    requireField(obj, "embedding", isEmbeddingState, route, RESOURCE);
  } else {
    requireField(obj, "reason", isString, route, RESOURCE);
    if (obj.version !== undefined) {
      requireField(obj, "version", isString, route, RESOURCE);
    }
    if (obj.latencyMs !== undefined) {
      requireField(obj, "latencyMs", isNumber, route, RESOURCE);
    }
    if (obj.embedding !== undefined) {
      requireField(obj, "embedding", isEmbeddingState, route, RESOURCE);
    }
    if (obj.error !== undefined) {
      requireField(obj, "error", isString, route, RESOURCE);
    }
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
