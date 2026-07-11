/**
 * Evidence Resource
 *
 * Typed access to engram-server's append-only evidence series
 * (`/v1/evidence`, ADR-042 D3 / engram-server #1035; migrations 078/079).
 * Five endpoints:
 *
 *   append          → POST /v1/evidence/append
 *   get             → GET  /v1/evidence/records/{id}
 *   listBySeries    → GET  /v1/evidence/{seriesKind}/{seriesKey}/{versionAxis}
 *   listByEntity    → GET  /v1/evidence/by-entity
 *   listByDescriptor→ GET  /v1/evidence/by-descriptor
 *
 * Append-only: there is no update or delete endpoint. `payload` is opaque
 * consumer-owned JSONB; `seq` is a decimal string (see the type module note).
 */

import { EngramError } from "../errors.js";
import {
  unwrapData,
  unwrapDataObject,
  requireObject,
  requireArray,
  requireField,
  isString,
  isNumber,
  isBoolean,
  isNullableString,
  isNullableNumber,
} from "../validate.js";
import { BaseResource } from "./base.js";
import type {
  EvidenceRecord,
  AppendEvidenceParams,
  AppendEvidenceResult,
  ListEvidenceParams,
  ListEvidenceByEntityParams,
  ListEvidenceByDescriptorParams,
  EvidenceListPage,
} from "../types/evidence.js";

const RESOURCE = "evidence";

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

/** True for a non-null, non-array object (the `payload` field / a wire record). */
function isRecordObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate one wire record into an {@link EvidenceRecord}, failing loudly
 * (`ResponseShapeError`, the house no-silent-degradation convention) on any
 * contract drift rather than returning a mistyped record a downstream reader
 * would trip over. Every documented field is shape-checked at the HTTP edge:
 *
 *  - `seq` MUST be a string — a numeric `seq` (a server that forgot the
 *    BIGSERIAL→text cast) is rejected here, not silently handed back as a
 *    number that violates the declared type.
 *  - the non-nullable string fields (`id`, `seriesKind`, `seriesKey`,
 *    `bodyDigest`, `recordedAt`, `createdAt`) must be strings; `versionAxis` a
 *    number; `payload` a non-null object; and the nullable fields must be a
 *    string/number or explicit null.
 */
function validateEvidenceRecord(value: unknown, route: string): EvidenceRecord {
  const obj = requireObject(value, route, RESOURCE);
  requireField(obj, "id", isString, route, RESOURCE);
  requireField(obj, "seriesKind", isString, route, RESOURCE);
  requireField(obj, "seriesKey", isString, route, RESOURCE);
  requireField(obj, "versionAxis", isNumber, route, RESOURCE);
  requireField(obj, "entity", isNullableString, route, RESOURCE);
  requireField(obj, "manifestVersion", isNullableNumber, route, RESOURCE);
  requireField(obj, "descriptorHash", isNullableString, route, RESOURCE);
  requireField(obj, "dedupKey", isNullableString, route, RESOURCE);
  requireField(obj, "bodyDigest", isString, route, RESOURCE);
  requireField(obj, "payload", isRecordObject, route, RESOURCE);
  // BIGSERIAL carried as a decimal string — a numeric seq is contract drift.
  requireField(obj, "seq", isString, route, RESOURCE);
  requireField(obj, "recordedBy", isNullableString, route, RESOURCE);
  requireField(obj, "recordedAt", isString, route, RESOURCE);
  requireField(obj, "createdAt", isString, route, RESOURCE);
  return obj as unknown as EvidenceRecord;
}

/**
 * Evidence Resource — append-only evidence series reads and appends.
 *
 * @example
 * ```typescript
 * // Append (dedup-aware). A repeat with the same dedupKey + bodyDigest
 * // converges silently; a differing bodyDigest throws EvidenceDedupConflictError.
 * const { record, isDuplicate } = await client.evidence.append({
 *   seriesKind: "persona-trait",
 *   seriesKey: compiledHash,
 *   versionAxis: 1,
 *   dedupKey: measurementKey,
 *   bodyDigest,
 *   payload: { ... },
 * });
 *
 * // Range-read one series, in seq order (paginated).
 * const { records, hasMore } = await client.evidence.listBySeries(
 *   "persona-trait", compiledHash, 1, { limit: 500 }
 * );
 * ```
 */
export class EvidenceResource extends BaseResource {
  /**
   * Append an evidence record (dedup-aware).
   *
   * Returns the created record (`isDuplicate: false`) or, on silent
   * convergence, the PRIOR record (`isDuplicate: true`) — the SDK does not
   * distinguish the 201 and 200 status codes at the call site; branch on
   * `isDuplicate` / `priorSeq` instead.
   *
   * @throws {import("../errors.js").EvidenceDedupConflictError} (409
   *   `EVIDENCE_DEDUP_CONFLICT`) when the same `dedupKey` already exists in the
   *   series with a DIFFERING `bodyDigest`. Never auto-resolved, never
   *   last-write-wins — `err.priorRecordId` / `err.priorBodyDigest` /
   *   `err.newBodyDigest` carry the conflict.
   */
  async append(params: AppendEvidenceParams): Promise<AppendEvidenceResult> {
    // ADR-018: JSON bodies are camelCase — no field remapping needed.
    const route = "POST /v1/evidence/append";
    const response = await this.request<ApiSuccessResponse<AppendEvidenceResult>>(
      "POST",
      "/v1/evidence/append",
      params,
    );
    // The append-specific envelope fields (isDuplicate, priorSeq) are validated
    // so a contract drift fails loudly instead of surfacing a downstream
    // TypeError; `record`'s own field shapes are trusted after the object check
    // (same altitude as crystals.get — validate at the HTTP edge, not per field).
    const data = unwrapDataObject(response, route, RESOURCE);
    requireField(data, "isDuplicate", isBoolean, route, RESOURCE);
    requireField(data, "priorSeq", isNullableString, route, RESOURCE);
    // Deep-validate the record itself (a numeric seq / non-object payload is
    // contract drift, not a mistyped record handed back to the caller).
    const record = validateEvidenceRecord(data.record, route);
    return {
      record,
      isDuplicate: data.isDuplicate as boolean,
      priorSeq: (data.priorSeq ?? null) as string | null,
    };
  }

  /**
   * Fetch one evidence record by id.
   *
   * @throws {import("../errors.js").NotFoundError} (404 `RES_NOT_FOUND`) when
   *   no record with that id exists.
   */
  async get(id: string): Promise<EvidenceRecord> {
    const path = `/v1/evidence/records/${encodeURIComponent(id)}`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<EvidenceRecord>>("GET", path);
    return validateEvidenceRecord(unwrapData(response, route, RESOURCE), route);
  }

  /**
   * Range-read one series identity `(seriesKind, seriesKey, versionAxis)`,
   * ordered by `seq` ascending. Paginated.
   */
  async listBySeries(
    seriesKind: string,
    seriesKey: string,
    versionAxis: number,
    params?: ListEvidenceParams,
  ): Promise<EvidenceListPage> {
    const base = `/v1/evidence/${encodeURIComponent(seriesKind)}/${encodeURIComponent(
      seriesKey,
    )}/${encodeURIComponent(String(versionAxis))}`;
    const path = base + paginationQuery(params);
    return this.readPage(path);
  }

  /**
   * All evidence for an `entity`, optionally narrowed to one `manifestVersion`.
   * Ordered by manifestVersion then seq. Paginated.
   */
  async listByEntity(params: ListEvidenceByEntityParams): Promise<EvidenceListPage> {
    const query = new URLSearchParams();
    query.set("entity", params.entity);
    if (params.manifestVersion !== undefined) {
      query.set("manifestVersion", String(params.manifestVersion));
    }
    appendPagination(query, params);
    const path = `/v1/evidence/by-entity?${query.toString()}`;
    return this.readPage(path);
  }

  /**
   * Evidence matching `descriptorHash`, optionally narrowed to `entity`
   * (index-backed) OR `seriesKey` (filter-only). Paginated.
   *
   * `entity` and `seriesKey` are mutually exclusive (ADR-042 D3 answer e). The
   * {@link ListEvidenceByDescriptorParams} union already makes passing both a
   * COMPILE error; this runtime guard is the backstop for plain-JS callers that
   * bypass the types. The server would otherwise silently AND both filters, so
   * an ambiguous both-provided call surfaces as a typed error rather than a
   * quietly over-restricted result set (P2 — no silent degradation).
   *
   * @throws {EngramError} (`VALIDATION_INPUT_INVALID`) when both `entity` and
   *   `seriesKey` are supplied.
   */
  async listByDescriptor(params: ListEvidenceByDescriptorParams): Promise<EvidenceListPage> {
    if (params.entity !== undefined && params.seriesKey !== undefined) {
      throw new EngramError(
        "evidence.listByDescriptor: `entity` and `seriesKey` are mutually " +
          "exclusive (ADR-042 D3 answer e) — pass at most one. Omit both to " +
          "match on descriptorHash alone.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    const query = new URLSearchParams();
    query.set("descriptorHash", params.descriptorHash);
    if (params.entity !== undefined) query.set("entity", params.entity);
    if (params.seriesKey !== undefined) query.set("seriesKey", params.seriesKey);
    appendPagination(query, params);
    const path = `/v1/evidence/by-descriptor?${query.toString()}`;
    return this.readPage(path);
  }

  /**
   * Issue a paginated GET and unwrap it into an {@link EvidenceListPage}. The
   * envelope + array-ness are validated at the HTTP edge; `total`/`hasMore`
   * fall back to the page length / `false` only when the server omitted the
   * (required) pagination block.
   */
  private async readPage(path: string): Promise<EvidenceListPage> {
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<EvidenceRecord[]>>("GET", path);
    const rows = requireArray<unknown>(unwrapData(response, route, RESOURCE), route, RESOURCE);
    // Deep-validate each element so a drifted record in the page fails loudly
    // rather than surfacing as a mistyped row downstream.
    const records = rows.map((row) => validateEvidenceRecord(row, route));
    return {
      records,
      total: response.meta?.pagination?.total ?? records.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }
}

/** Append `limit`/`offset` to an existing query builder when present. */
function appendPagination(query: URLSearchParams, params?: ListEvidenceParams): void {
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
}

/** Build a `?limit=&offset=` suffix for path-param endpoints (empty when none set). */
function paginationQuery(params?: ListEvidenceParams): string {
  const query = new URLSearchParams();
  appendPagination(query, params);
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}
