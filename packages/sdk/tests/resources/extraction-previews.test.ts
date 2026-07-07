/**
 * Extraction Preview Tests (engram-server 0.50.0, #1167/#1174 — issue #143).
 *
 * Covers the two preview modes engram-server 0.50.0 added to
 * `POST /v1/extraction/extract`:
 *
 *   ExtractionResource.bootstrapPreview() — `bootstrap: true` (no sourceId;
 *     optional confirm/since/estimatedCostPerCall) → 200 preview envelope
 *   ExtractionResource.dryRunPreview()    — `dryRun: true` (requires sourceId)
 *     → 200 projection envelope
 *
 * Plus:
 *   - client-side semantic-prerequisite validation (typed
 *     VALIDATION_INPUT_INVALID BEFORE any fetch): bootstrap must not carry a
 *     sourceId, dryRun requires one, the two modes are mutually exclusive,
 *     estimatedCostPerCall must be > 0, and extract() rejects smuggled mode
 *     flags (a preview is a 200 body, not the 201 job extract() is typed as).
 *   - contract-parity: EVERY schema-required field of
 *     ExtractionBootstrapPreview / ExtractionDryRunPreview (nested
 *     sources[] entries and entityCountByClass values included) is asserted
 *     by the runtime guards — omitting any one throws ResponseShapeError.
 *
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError, ResponseShapeError } from "../../src/errors.js";
import type {
  ExtractionBootstrapPreview,
  ExtractionDryRunPreview,
} from "../../src/resources/entities.js";

// ============================================================================
// Helpers
// ============================================================================

function mockJsonResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// ============================================================================
// Fixtures
// ============================================================================

const SOURCE_ID = "00000000-0000-4000-8000-000000000003";

const bootstrapPreviewData: ExtractionBootstrapPreview = {
  unextractedCount: 42,
  estimatedCalls: 42,
  estimatedCostUsd: 0.084,
  sources: [
    { id: SOURCE_ID, type: "session_note", title: "a recent note excerpt" },
  ],
};

const confirmedBootstrapData: ExtractionBootstrapPreview = {
  ...bootstrapPreviewData,
  jobsEnqueued: 40,
};

const dryRunPreviewData: ExtractionDryRunPreview = {
  entityCountByClass: { person: 3, technology: 2 },
  estimatedEntityCount: 5,
  estimatedCostUsd: 0.002,
};

/** The 200 preview envelope (`{ success, data, meta.timing }`). */
function previewEnvelope(data: unknown) {
  return { success: true, data, meta: { timing: { durationMs: 12 } } };
}

// ============================================================================
// Test Setup
// ============================================================================

let client: EngramClient;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new EngramClient({
    baseUrl: "http://localhost:3100",
    apiKey: "test-api-key",
    timeout: 5000,
    retries: 1,
  });
  mockFetch = mockJsonResponse({});
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ============================================================================
// ExtractionResource.bootstrapPreview()
// ============================================================================

describe("client.extraction.bootstrapPreview()", () => {
  it("POSTs /v1/extraction/extract with bootstrap: true and no sourceId", async () => {
    mockFetch = mockJsonResponse(previewEnvelope(bootstrapPreviewData));
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.bootstrapPreview({
      sourceType: "session_note",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/extract",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({ sourceType: "session_note", bootstrap: true });
    // The wire's semantic prerequisites: no sourceId, no dryRun serialized.
    expect(body).not.toHaveProperty("sourceId");
    expect(body).not.toHaveProperty("dryRun");

    expect(result.data.unextractedCount).toBe(42);
    expect(result.data.estimatedCalls).toBe(42);
    expect(result.data.estimatedCostUsd).toBe(0.084);
    expect(result.data.sources).toHaveLength(1);
    expect(result.data.sources[0].title).toBe("a recent note excerpt");
    expect(result.data.jobsEnqueued).toBeUndefined();
  });

  it("serializes confirm, since, and estimatedCostPerCall only when supplied", async () => {
    mockFetch = mockJsonResponse(previewEnvelope(confirmedBootstrapData));
    vi.stubGlobal("fetch", mockFetch);

    await client.extraction.bootstrapPreview({
      sourceType: "knowledge_crystal",
      confirm: true,
      since: "2026-04-01T00:00:00Z",
      estimatedCostPerCall: 0.005,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({
      sourceType: "knowledge_crystal",
      bootstrap: true,
      confirm: true,
      since: "2026-04-01T00:00:00Z",
      estimatedCostPerCall: 0.005,
    });
  });

  it("returns jobsEnqueued on a confirm: true call", async () => {
    mockFetch = mockJsonResponse(previewEnvelope(confirmedBootstrapData));
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.bootstrapPreview({
      sourceType: "session_note",
      confirm: true,
    });

    expect(result.data.jobsEnqueued).toBe(40);
  });

  it("accepts an empty sources sample (unextractedCount stays authoritative)", async () => {
    mockFetch = mockJsonResponse(
      previewEnvelope({ ...bootstrapPreviewData, sources: [] }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.bootstrapPreview({
      sourceType: "session_note",
    });

    expect(result.data.sources).toEqual([]);
    expect(result.data.unextractedCount).toBe(42);
  });

  it("throws VALIDATION_INPUT_INVALID before fetching when a sourceId is smuggled in", async () => {
    await expect(
      client.extraction.bootstrapPreview({
        sourceType: "session_note",
        // Bypass the compile-time type to simulate an untyped JS caller.
        sourceId: SOURCE_ID,
      } as never),
    ).rejects.toMatchObject({
      name: "EngramError",
      code: "VALIDATION_INPUT_INVALID",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws VALIDATION_INPUT_INVALID before fetching when dryRun is smuggled in (mutual exclusion)", async () => {
    await expect(
      client.extraction.bootstrapPreview({
        sourceType: "session_note",
        dryRun: true,
      } as never),
    ).rejects.toMatchObject({
      name: "EngramError",
      code: "VALIDATION_INPUT_INVALID",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  for (const [label, value] of [
    ["zero", 0],
    ["negative", -0.002],
    ["NaN", Number.NaN],
    ["a string", "0.002"],
  ] as Array<[string, unknown]>) {
    it(`throws VALIDATION_INPUT_INVALID before fetching when estimatedCostPerCall is ${label}`, async () => {
      await expect(
        client.extraction.bootstrapPreview({
          sourceType: "session_note",
          estimatedCostPerCall: value as number,
        }),
      ).rejects.toMatchObject({
        name: "EngramError",
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  // Contract-parity: every schema-required field of ExtractionBootstrapPreview
  // (unextractedCount, estimatedCalls, estimatedCostUsd, sources) is asserted
  // by the runtime guard — omitting any one throws ResponseShapeError.
  for (const field of [
    "unextractedCount",
    "estimatedCalls",
    "estimatedCostUsd",
    "sources",
  ] as const) {
    it(`throws ResponseShapeError when required field "${field}" is missing`, async () => {
      const drifted: Record<string, unknown> = { ...bootstrapPreviewData };
      delete drifted[field];
      mockFetch = mockJsonResponse(previewEnvelope(drifted));
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.extraction.bootstrapPreview({ sourceType: "session_note" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  }

  // Contract-parity for the nested sources[] entries: id, type, title.
  for (const field of ["id", "type", "title"] as const) {
    it(`throws ResponseShapeError when a sources[] entry is missing "${field}"`, async () => {
      const entry: Record<string, unknown> = {
        ...bootstrapPreviewData.sources[0],
      };
      delete entry[field];
      mockFetch = mockJsonResponse(
        previewEnvelope({ ...bootstrapPreviewData, sources: [entry] }),
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.extraction.bootstrapPreview({ sourceType: "session_note" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  }

  it("throws ResponseShapeError when sources is not an array", async () => {
    mockFetch = mockJsonResponse(
      previewEnvelope({ ...bootstrapPreviewData, sources: "many" }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.bootstrapPreview({ sourceType: "session_note" }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws ResponseShapeError when jobsEnqueued is missing on a confirm: true call", async () => {
    // On confirm the response contract carries jobsEnqueued — its absence is
    // envelope drift, not an optional (P-no-silent-degradation).
    mockFetch = mockJsonResponse(previewEnvelope(bootstrapPreviewData));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.bootstrapPreview({
        sourceType: "session_note",
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws ResponseShapeError when a present jobsEnqueued is not a number", async () => {
    mockFetch = mockJsonResponse(
      previewEnvelope({ ...bootstrapPreviewData, jobsEnqueued: "40" }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.bootstrapPreview({ sourceType: "session_note" }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws ResponseShapeError when the data envelope is missing", async () => {
    mockFetch = mockJsonResponse({ success: true });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.bootstrapPreview({ sourceType: "session_note" }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws EngramError on a 4xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALID_INVALID_FORMAT", message: "bad since" } },
      400,
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.bootstrapPreview({
        sourceType: "session_note",
        since: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.dryRunPreview()
// ============================================================================

describe("client.extraction.dryRunPreview()", () => {
  it("POSTs /v1/extraction/extract with dryRun: true and the sourceId", async () => {
    mockFetch = mockJsonResponse(previewEnvelope(dryRunPreviewData));
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.dryRunPreview({
      sourceId: SOURCE_ID,
      sourceType: "session_note",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/extract",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({
      sourceId: SOURCE_ID,
      sourceType: "session_note",
      dryRun: true,
    });
    expect(body).not.toHaveProperty("bootstrap");

    expect(result.data.entityCountByClass).toEqual({ person: 3, technology: 2 });
    expect(result.data.estimatedEntityCount).toBe(5);
    expect(result.data.estimatedCostUsd).toBe(0.002);
  });

  it("serializes estimatedCostPerCall when supplied", async () => {
    mockFetch = mockJsonResponse(previewEnvelope(dryRunPreviewData));
    vi.stubGlobal("fetch", mockFetch);

    await client.extraction.dryRunPreview({
      sourceId: SOURCE_ID,
      sourceType: "knowledge_crystal",
      estimatedCostPerCall: 0.01,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.estimatedCostPerCall).toBe(0.01);
  });

  it("accepts an empty entityCountByClass (explicit zero-history signal)", async () => {
    mockFetch = mockJsonResponse(
      previewEnvelope({
        entityCountByClass: {},
        estimatedEntityCount: 0,
        estimatedCostUsd: 0.002,
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.dryRunPreview({
      sourceId: SOURCE_ID,
      sourceType: "session_note",
    });

    expect(result.data.entityCountByClass).toEqual({});
    expect(result.data.estimatedEntityCount).toBe(0);
  });

  for (const [label, value] of [
    ["missing", undefined],
    ["empty", ""],
    ["a number", 42],
  ] as Array<[string, unknown]>) {
    it(`throws VALIDATION_INPUT_INVALID before fetching when sourceId is ${label}`, async () => {
      await expect(
        client.extraction.dryRunPreview({
          sourceId: value as string,
          sourceType: "session_note",
        }),
      ).rejects.toMatchObject({
        name: "EngramError",
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  it("throws VALIDATION_INPUT_INVALID before fetching when bootstrap is smuggled in (mutual exclusion)", async () => {
    await expect(
      client.extraction.dryRunPreview({
        sourceId: SOURCE_ID,
        sourceType: "session_note",
        bootstrap: true,
      } as never),
    ).rejects.toMatchObject({
      name: "EngramError",
      code: "VALIDATION_INPUT_INVALID",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws VALIDATION_INPUT_INVALID before fetching on a non-positive estimatedCostPerCall", async () => {
    await expect(
      client.extraction.dryRunPreview({
        sourceId: SOURCE_ID,
        sourceType: "session_note",
        estimatedCostPerCall: 0,
      }),
    ).rejects.toMatchObject({
      name: "EngramError",
      code: "VALIDATION_INPUT_INVALID",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Contract-parity: every schema-required field of ExtractionDryRunPreview
  // (entityCountByClass, estimatedEntityCount, estimatedCostUsd) is asserted
  // by the runtime guard — omitting any one throws ResponseShapeError.
  for (const field of [
    "entityCountByClass",
    "estimatedEntityCount",
    "estimatedCostUsd",
  ] as const) {
    it(`throws ResponseShapeError when required field "${field}" is missing`, async () => {
      const drifted: Record<string, unknown> = { ...dryRunPreviewData };
      delete drifted[field];
      mockFetch = mockJsonResponse(previewEnvelope(drifted));
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.extraction.dryRunPreview({
          sourceId: SOURCE_ID,
          sourceType: "session_note",
        }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  }

  for (const [label, value] of [
    ["an array", []],
    ["null", null],
    ["a string", "person=3"],
  ] as Array<[string, unknown]>) {
    it(`throws ResponseShapeError when entityCountByClass is ${label}`, async () => {
      mockFetch = mockJsonResponse(
        previewEnvelope({ ...dryRunPreviewData, entityCountByClass: value }),
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.extraction.dryRunPreview({
          sourceId: SOURCE_ID,
          sourceType: "session_note",
        }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  }

  it("throws ResponseShapeError when an entityCountByClass value is not a number", async () => {
    mockFetch = mockJsonResponse(
      previewEnvelope({
        ...dryRunPreviewData,
        entityCountByClass: { person: "three" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.dryRunPreview({
        sourceId: SOURCE_ID,
        sourceType: "session_note",
      }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws EngramError on a 404 (source does not exist)", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "RES_NOT_FOUND", message: "no such source" } },
      404,
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.dryRunPreview({
        sourceId: SOURCE_ID,
        sourceType: "session_note",
      }),
    ).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.extract() — preview mode flags rejected
// ============================================================================

describe("client.extraction.extract() preview-flag guard", () => {
  for (const flag of ["bootstrap", "dryRun"] as const) {
    it(`throws VALIDATION_INPUT_INVALID before fetching when ${flag} is smuggled in`, async () => {
      // A preview request returns a 200 preview body, not the 201 job this
      // method is typed as — the flag must not be serialized from here.
      await expect(
        client.extraction.extract({
          sourceId: SOURCE_ID,
          sourceType: "session_note",
          [flag]: true,
        } as never),
      ).rejects.toMatchObject({
        name: "EngramError",
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
});
