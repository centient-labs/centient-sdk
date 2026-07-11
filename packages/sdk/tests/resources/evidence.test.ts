/**
 * Evidence Resource Tests
 *
 * Covers the five `/v1/evidence` endpoints (ADR-042 D3 / engram-server #1035):
 * dedup-aware append (201 new / 200 converged / 409 conflict), fetch-by-id
 * (404 → NotFoundError), and the three paginated reads. The append/read
 * payloads ride the standard `{ success, data, meta.pagination }` envelope;
 * the 409 dedup conflict is asserted to throw the typed
 * `EvidenceDedupConflictError` with its `error.details` digests lifted onto
 * typed fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import {
  EngramError,
  NotFoundError,
  ResponseShapeError,
  EvidenceDedupConflictError,
} from "../../src/errors.js";
import type {
  EvidenceRecord,
  ListEvidenceByDescriptorParams,
} from "../../src/types/evidence.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data) ?? ""),
  });
}

const RECORD_ID = "33333333-3333-4333-8333-333333333333";

const mockRecord: EvidenceRecord = {
  id: RECORD_ID,
  seriesKind: "persona-trait",
  seriesKey: "compiled-hash-abc",
  versionAxis: 1,
  entity: "persona:soma-pilot",
  manifestVersion: 2,
  descriptorHash: "descriptor-xyz",
  dedupKey: "measurement-key-1",
  bodyDigest: "digest-aaa",
  // `seq` is a decimal STRING on the wire (BIGSERIAL — not number).
  seq: "42",
  payload: { score: 0.9 },
  recordedBy: "agent-1",
  recordedAt: "2026-07-11T10:00:00.000Z",
  createdAt: "2026-07-11T10:00:00.000Z",
};

function paginatedEnvelope(records: EvidenceRecord[], total = records.length, hasMore = false) {
  return {
    success: true,
    data: records,
    meta: { pagination: { total, limit: 500, offset: 0, hasMore } },
  };
}

describe("EvidenceResource", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      retries: 1,
    });
    mockFetch = mockFetchResponse({});
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // evidence.append()
  // ==========================================================================

  describe("evidence.append", () => {
    it("POSTs the camelCase body to /v1/evidence/append and returns the created record", async () => {
      mockFetch = mockFetchResponse(
        { success: true, data: { record: mockRecord, isDuplicate: false, priorSeq: null } },
        201,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.evidence.append({
        seriesKind: "persona-trait",
        seriesKey: "compiled-hash-abc",
        versionAxis: 1,
        dedupKey: "measurement-key-1",
        bodyDigest: "digest-aaa",
        payload: { score: 0.9 },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/append",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            seriesKind: "persona-trait",
            seriesKey: "compiled-hash-abc",
            versionAxis: 1,
            dedupKey: "measurement-key-1",
            bodyDigest: "digest-aaa",
            payload: { score: 0.9 },
          }),
        }),
      );
      expect(result.isDuplicate).toBe(false);
      expect(result.priorSeq).toBeNull();
      expect(result.record.id).toBe(RECORD_ID);
      // seq stays a string.
      expect(result.record.seq).toBe("42");
    });

    it("returns the PRIOR record with priorSeq on a 200 convergence", async () => {
      mockFetch = mockFetchResponse(
        { success: true, data: { record: mockRecord, isDuplicate: true, priorSeq: "42" } },
        200,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.evidence.append({
        seriesKind: "persona-trait",
        seriesKey: "compiled-hash-abc",
        versionAxis: 1,
        dedupKey: "measurement-key-1",
        bodyDigest: "digest-aaa",
        payload: { score: 0.9 },
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.priorSeq).toBe("42");
      expect(result.record.id).toBe(RECORD_ID);
    });

    it("throws EvidenceDedupConflictError with parsed details on 409", async () => {
      mockFetch = mockFetchResponse(
        {
          success: false,
          error: {
            code: "EVIDENCE_DEDUP_CONFLICT",
            message: "same dedup_key, differing body_digest",
            details: {
              priorRecordId: RECORD_ID,
              priorBodyDigest: "digest-aaa",
              newBodyDigest: "digest-bbb",
              seriesKind: "persona-trait",
              seriesKey: "compiled-hash-abc",
              versionAxis: 1,
              dedupKey: "measurement-key-1",
            },
          },
        },
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const promise = client.evidence.append({
        seriesKind: "persona-trait",
        seriesKey: "compiled-hash-abc",
        versionAxis: 1,
        dedupKey: "measurement-key-1",
        bodyDigest: "digest-bbb",
        payload: { score: 0.1 },
      });

      await expect(promise).rejects.toBeInstanceOf(EvidenceDedupConflictError);
      const err = await promise.catch((e) => e as EvidenceDedupConflictError);
      expect(err.code).toBe("EVIDENCE_DEDUP_CONFLICT");
      expect(err.statusCode).toBe(409);
      expect(err.priorRecordId).toBe(RECORD_ID);
      expect(err.priorBodyDigest).toBe("digest-aaa");
      expect(err.newBodyDigest).toBe("digest-bbb");
    });

    it("nulls conflict digests the server omitted (still a typed error)", async () => {
      mockFetch = mockFetchResponse(
        {
          success: false,
          error: {
            code: "EVIDENCE_DEDUP_CONFLICT",
            message: "conflict",
            details: { priorRecordId: RECORD_ID },
          },
        },
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.evidence
        .append({
          seriesKind: "k",
          seriesKey: "s",
          versionAxis: 1,
          dedupKey: "d",
          bodyDigest: "b",
          payload: {},
        })
        .catch((e) => e as EvidenceDedupConflictError);

      expect(err).toBeInstanceOf(EvidenceDedupConflictError);
      expect(err.priorRecordId).toBe(RECORD_ID);
      expect(err.priorBodyDigest).toBeNull();
      expect(err.newBodyDigest).toBeNull();
    });

    it("throws on contract drift (missing isDuplicate)", async () => {
      mockFetch = mockFetchResponse(
        { success: true, data: { record: mockRecord, priorSeq: null } },
        201,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.evidence.append({
          seriesKind: "k",
          seriesKey: "s",
          versionAxis: 1,
          bodyDigest: "b",
          payload: {},
        }),
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("rejects a numeric seq in the returned record (BIGSERIAL must be a string)", async () => {
      mockFetch = mockFetchResponse(
        {
          success: true,
          data: {
            record: { ...mockRecord, seq: 42 },
            isDuplicate: false,
            priorSeq: null,
          },
        },
        201,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.evidence.append({
          seriesKind: "k",
          seriesKey: "s",
          versionAxis: 1,
          bodyDigest: "b",
          payload: {},
        }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("rejects a non-object payload in the returned record", async () => {
      mockFetch = mockFetchResponse(
        {
          success: true,
          data: {
            record: { ...mockRecord, payload: "not-an-object" },
            isDuplicate: false,
            priorSeq: null,
          },
        },
        201,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.evidence.append({
          seriesKind: "k",
          seriesKey: "s",
          versionAxis: 1,
          bodyDigest: "b",
          payload: {},
        }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // evidence.get()
  // ==========================================================================

  describe("evidence.get", () => {
    it("GETs /v1/evidence/records/{id} and unwraps the record", async () => {
      mockFetch = mockFetchResponse({ success: true, data: mockRecord });
      vi.stubGlobal("fetch", mockFetch);

      const record = await client.evidence.get(RECORD_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/evidence/records/${RECORD_ID}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(record.id).toBe(RECORD_ID);
      expect(record.seq).toBe("42");
    });

    it("throws NotFoundError on 404", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "RES_NOT_FOUND", message: "not found" } },
        404,
      );
      vi.stubGlobal("fetch", mockFetch);

      const promise = client.evidence.get(RECORD_ID);
      await expect(promise).rejects.toBeInstanceOf(NotFoundError);
      // The server's original code is preserved on the typed 404.
      const err = await promise.catch((e) => e as NotFoundError);
      expect(err.code).toBe("RES_NOT_FOUND");
    });

    it("rejects a numeric seq on the fetched record (contract drift)", async () => {
      mockFetch = mockFetchResponse({ success: true, data: { ...mockRecord, seq: 42 } });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.evidence.get(RECORD_ID)).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("encodes the id path segment", async () => {
      mockFetch = mockFetchResponse({ success: true, data: mockRecord });
      vi.stubGlobal("fetch", mockFetch);

      await client.evidence.get("weird/id with space");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/records/weird%2Fid%20with%20space",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ==========================================================================
  // evidence.listBySeries()
  // ==========================================================================

  describe("evidence.listBySeries", () => {
    it("GETs the series-range path and returns records/total/hasMore", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([mockRecord], 1, false));
      vi.stubGlobal("fetch", mockFetch);

      const page = await client.evidence.listBySeries("persona-trait", "compiled-hash-abc", 1, {
        limit: 500,
        offset: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/persona-trait/compiled-hash-abc/1?limit=500&offset=0",
        expect.objectContaining({ method: "GET" }),
      );
      expect(page.records).toHaveLength(1);
      expect(page.total).toBe(1);
      expect(page.hasMore).toBe(false);
    });

    it("omits the query string when no pagination is passed and encodes segments", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.evidence.listBySeries("kind/one", "key one", 3);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/kind%2Fone/key%20one/3",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("falls back to data.length / false when the server omits pagination meta", async () => {
      mockFetch = mockFetchResponse({ success: true, data: [mockRecord] });
      vi.stubGlobal("fetch", mockFetch);

      const page = await client.evidence.listBySeries("k", "s", 1);
      expect(page.total).toBe(1);
      expect(page.hasMore).toBe(false);
    });

    it("rejects a drifted record inside the page (numeric seq)", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([{ ...mockRecord, seq: 42 } as unknown as EvidenceRecord]));
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.evidence.listBySeries("k", "s", 1)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // evidence.listByEntity()
  // ==========================================================================

  describe("evidence.listByEntity", () => {
    it("requires entity and forwards manifestVersion + paging", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([mockRecord], 1, true));
      vi.stubGlobal("fetch", mockFetch);

      const page = await client.evidence.listByEntity({
        entity: "persona:soma-pilot",
        manifestVersion: 2,
        limit: 50,
        offset: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/by-entity?entity=persona%3Asoma-pilot&manifestVersion=2&limit=50&offset=10",
        expect.objectContaining({ method: "GET" }),
      );
      expect(page.records).toHaveLength(1);
      expect(page.hasMore).toBe(true);
    });

    it("omits manifestVersion when not provided", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.evidence.listByEntity({ entity: "e" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/by-entity?entity=e",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ==========================================================================
  // evidence.listByDescriptor()
  // ==========================================================================

  describe("evidence.listByDescriptor", () => {
    it("forwards descriptorHash + entity", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([mockRecord]));
      vi.stubGlobal("fetch", mockFetch);

      await client.evidence.listByDescriptor({
        descriptorHash: "descriptor-xyz",
        entity: "persona:soma-pilot",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/by-descriptor?descriptorHash=descriptor-xyz&entity=persona%3Asoma-pilot",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("forwards descriptorHash + seriesKey (the other exclusive arm)", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.evidence.listByDescriptor({
        descriptorHash: "descriptor-xyz",
        seriesKey: "compiled-hash-abc",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/by-descriptor?descriptorHash=descriptor-xyz&seriesKey=compiled-hash-abc",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("rejects entity + seriesKey together (mutually exclusive) before any request", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([]));
      vi.stubGlobal("fetch", mockFetch);

      // The union type makes passing both a COMPILE error; a plain-JS caller can
      // still do it, so the runtime guard is exercised via an unknown-cast arg.
      const bothArg = {
        descriptorHash: "descriptor-xyz",
        entity: "e",
        seriesKey: "s",
      } as unknown as ListEvidenceByDescriptorParams;

      await expect(client.evidence.listByDescriptor(bothArg)).rejects.toMatchObject({
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("allows descriptorHash alone (neither narrowing)", async () => {
      mockFetch = mockFetchResponse(paginatedEnvelope([mockRecord]));
      vi.stubGlobal("fetch", mockFetch);

      const page = await client.evidence.listByDescriptor({ descriptorHash: "descriptor-xyz" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/evidence/by-descriptor?descriptorHash=descriptor-xyz",
        expect.objectContaining({ method: "GET" }),
      );
      expect(page.records).toHaveLength(1);
    });
  });
});
