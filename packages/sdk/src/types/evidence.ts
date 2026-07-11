/**
 * Evidence Series Types (engram `/v1/evidence`, ADR-042 D3 / engram-server
 * #1035; migrations 078/079).
 *
 * An *evidence series* is an APPEND-ONLY, never-pruned log of records under a
 * caller-supplied series identity `(seriesKind, seriesKey, versionAxis)`.
 * engram does not interpret series identity or `payload` — it validates the
 * envelope (series identity, `dedupKey`, and the queryable attributes:
 * `entity`, `manifestVersion`, `descriptorHash`) and stores `payload` as
 * opaque, consumer-owned JSONB (#1035 answer a). There is no update or delete
 * endpoint for evidence records.
 *
 * Two typing invariants the wire enforces:
 *  - **`seq` is a decimal STRING**, not a number. It is a BIGSERIAL ordering
 *    key — monotonic within a series but not safe-integer-bounded, so it is
 *    carried as a decimal string (the same house convention as `commit_seq`).
 *    Gapless numbering is NOT contracted.
 *  - **`payload` is `Record<string, unknown>`** — opaque JSONB validated as an
 *    object only, never inspected. Any persona-level `schemaVersion` inside it
 *    is a consumer concern.
 */

/**
 * A single evidence record as returned over the wire. Timestamps are ISO-8601
 * strings; `seq` is a decimal string (see the module note).
 */
export interface EvidenceRecord {
  /** Server-assigned UUID. */
  id: string;
  /** Caller-supplied series kind (engram does not interpret it). */
  seriesKind: string;
  /** Caller-supplied series key (the persona-sdk keys by compiledHash). */
  seriesKey: string;
  /** Integer version axis within the series. */
  versionAxis: number;
  /** Roll-up key (`by-entity` query), or null. */
  entity: string | null;
  /** Manifest version narrowing (`by-entity` query), or null. */
  manifestVersion: number | null;
  /** Descriptor hash for baseline/floor comparability (`by-descriptor` query), or null. */
  descriptorHash: string | null;
  /**
   * Dedup contract axis, or null for "no dedup contract" (always inserts).
   * When set, a repeat append with an identical `bodyDigest` converges
   * (200, `isDuplicate: true`); a differing `bodyDigest` is a 409 conflict.
   */
  dedupKey: string | null;
  /** Content digest of `payload`, used for convergence/conflict comparison. */
  bodyDigest: string;
  /** Opaque consumer-owned JSONB — engram validates the envelope only. */
  payload: Record<string, unknown>;
  /**
   * BIGSERIAL ordering within the series, as a decimal STRING (never a JS
   * number — not safe-integer-bounded). Monotonic; gapless numbering is NOT
   * contracted.
   */
  seq: string;
  /** Client-asserted recording principal, or null. */
  recordedBy: string | null;
  /** ISO-8601 measurement/record instant. */
  recordedAt: string;
  /** ISO-8601 row creation timestamp. */
  createdAt: string;
}

/**
 * Request body for {@link import("../resources/evidence.js").EvidenceResource.append}.
 * Sent camelCase (ADR-018 — no field remapping). Optional envelope fields may
 * be omitted or sent as explicit `null`.
 */
export interface AppendEvidenceParams {
  seriesKind: string;
  seriesKey: string;
  versionAxis: number;
  /** Roll-up key, or null/omitted. */
  entity?: string | null;
  /** Manifest version, or null/omitted. */
  manifestVersion?: number | null;
  /** Descriptor hash, or null/omitted. */
  descriptorHash?: string | null;
  /**
   * Dedup contract axis. Omit or send null for no dedup contract (always
   * inserts). When set, a repeat with an identical `bodyDigest` is a
   * success-no-op returning the PRIOR record (200); a differing `bodyDigest`
   * is a 409 `EVIDENCE_DEDUP_CONFLICT` (never last-write-wins).
   */
  dedupKey?: string | null;
  /** Content digest of `payload`. Required. */
  bodyDigest: string;
  /**
   * Opaque consumer-owned JSONB — validated as an object only, never
   * inspected. Size is bounded by the server's global 50MB request-body limit;
   * payloads near that bound belong in `content_blobs` with a blob reference
   * carried here instead (the dedup axis stays `dedupKey` either way).
   */
  payload: Record<string, unknown>;
  /** Recording principal, or null/omitted. */
  recordedBy?: string | null;
  /** ISO-8601 override for the record instant; defaults to server time. */
  recordedAt?: string;
}

/**
 * Result of {@link import("../resources/evidence.js").EvidenceResource.append}.
 *
 * `record` is the newly-created record (HTTP 201) OR — when `isDuplicate` is
 * true (HTTP 200, silent convergence) — the PRIOR record the append converged
 * to. `priorSeq` is the prior record's `seq` when `isDuplicate` is true (it
 * echoes `record.seq` in that case) and null otherwise, so callers never have
 * to branch on `isDuplicate` just to read the matched seq.
 *
 * A same-`dedupKey`, differing-`bodyDigest` append does NOT land here — it
 * throws {@link import("../errors.js").EvidenceDedupConflictError} (409).
 */
export interface AppendEvidenceResult {
  record: EvidenceRecord;
  isDuplicate: boolean;
  priorSeq: string | null;
}

/** Pagination options shared by the evidence list reads (limit default 50, max 500). */
export interface ListEvidenceParams {
  /** Page size — server default 50, max 500. */
  limit?: number;
  /** Row offset — server default 0. */
  offset?: number;
}

/** Filters for {@link import("../resources/evidence.js").EvidenceResource.listByEntity}. */
export interface ListEvidenceByEntityParams extends ListEvidenceParams {
  /** Required roll-up key (index-backed). */
  entity: string;
  /** Optional narrowing to one manifest version. */
  manifestVersion?: number;
}

/**
 * The `entity` XOR `seriesKey` narrowing on a by-descriptor read, modelled so
 * that supplying BOTH is a compile error: each arm forbids the other key with
 * `?: never`. All three shapes are still allowed — `entity` alone, `seriesKey`
 * alone, or neither (match on `descriptorHash` only). The resource keeps a
 * runtime guard as well, for plain-JS callers that bypass these types.
 */
export type EvidenceDescriptorScope =
  | { entity?: string; seriesKey?: never }
  | { entity?: never; seriesKey?: string };

/**
 * Filters for {@link import("../resources/evidence.js").EvidenceResource.listByDescriptor}.
 * `entity` and `seriesKey` are MUTUALLY EXCLUSIVE (ADR-042 D3 answer e) — the
 * {@link EvidenceDescriptorScope} union makes passing both a compile error.
 */
export type ListEvidenceByDescriptorParams = ListEvidenceParams & {
  /** Required descriptor hash. */
  descriptorHash: string;
} & EvidenceDescriptorScope;

/** A single page of evidence records with its pagination totals. */
export interface EvidenceListPage {
  records: EvidenceRecord[];
  /** Full matched-set count (server contract field). */
  total: number;
  /** Whether more rows exist beyond this page. */
  hasMore: boolean;
}
