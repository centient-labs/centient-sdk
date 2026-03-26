/**
 * ExportImportResource Tests
 *
 * Tests for SDK interface to export/import functionality (ADR-042).
 * Covers all five methods: estimateExport, export, exportStream, importData, previewImport.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type {
  ExportEstimate,
  ExportParams,
  ImportOptions,
  ImportPreview,
  ImportResult,
} from "../../src/types/export-import.js";

// ============================================================================
// Helpers
// ============================================================================

function mockJsonResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    body: null,
  });
}

function mockRawResponse(body: ReadableStream<Uint8Array> | null, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
  });
}

const baseExportParams: ExportParams = {
  scopes: ["knowledge"],
  filters: {},
  format: "archive",
  compress: true,
};

// ============================================================================
// Fixtures
// ============================================================================

const mockEstimate: ExportEstimate = {
  knowledgeItems: 100,
  knowledgeEdges: 50,
  crystals: 10,
  crystalMemberships: 30,
  sessions: 5,
  sessionNotes: 200,
  totalEntities: 395,
  estimatedSizeBytes: 1024000,
};

const mockImportResult: ImportResult = {
  success: true,
  counts: {
    knowledgeItems: { inserted: 95, updated: 5, skipped: 0 },
  },
  errors: [],
  duration: 1234,
};

const mockImportPreview: ImportPreview = {
  success: true,
  schemaVersion: {
    archive: "1.0.0",
    current: "1.0.0",
    migrationRequired: false,
  },
  counts: {
    knowledgeItems: { new: 95, updated: 5, skipped: 0 },
  },
  conflicts: [],
  conflictCount: 0,
};

// ============================================================================
// ExportImportResource Tests
// ============================================================================

describe("ExportImportResource", () => {
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

  // --------------------------------------------------------------------------
  // estimateExport
  // --------------------------------------------------------------------------

  describe("exportImport.estimateExport", () => {
    it("should POST to /v1/export/estimate with JSON body", async () => {
      mockFetch = mockJsonResponse({ data: mockEstimate });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.exportImport.estimateExport(baseExportParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/export/estimate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(baseExportParams),
        })
      );
      expect(result.knowledgeItems).toBe(100);
      expect(result.estimatedSizeBytes).toBe(1024000);
      expect(result.totalEntities).toBe(395);
    });

    it("should include X-API-Key header", async () => {
      mockFetch = mockJsonResponse({ data: mockEstimate });
      vi.stubGlobal("fetch", mockFetch);

      await client.exportImport.estimateExport(baseExportParams);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ "X-API-Key": "test-api-key" }),
        })
      );
    });

    it("should throw EngramError on 4xx response", async () => {
      mockFetch = mockJsonResponse(
        { error: { code: "VALIDATION_FAILED", message: "Invalid scope" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.exportImport.estimateExport(baseExportParams)
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("should support multiple scopes and filters", async () => {
      mockFetch = mockJsonResponse({ data: mockEstimate });
      vi.stubGlobal("fetch", mockFetch);

      const params: ExportParams = {
        scopes: ["knowledge", "crystals", "sessions"],
        filters: { crystalIds: ["crystal-1"], verified: true },
        format: "ndjson",
        compress: false,
      };

      await client.exportImport.estimateExport(params);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/export/estimate",
        expect.objectContaining({ body: JSON.stringify(params) })
      );
    });
  });

  // --------------------------------------------------------------------------
  // export (raw Response)
  // --------------------------------------------------------------------------

  describe("exportImport.export", () => {
    it("should POST to /v1/export and return raw Response", async () => {
      const fakeBody = new ReadableStream<Uint8Array>();
      mockFetch = mockRawResponse(fakeBody, 200);
      vi.stubGlobal("fetch", mockFetch);

      const response = await client.exportImport.export(baseExportParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/export",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(baseExportParams),
        })
      );
      expect(response).toBeDefined();
      expect(response.ok).toBe(true);
    });

    it("should send Content-Type: application/json header", async () => {
      mockFetch = mockRawResponse(null, 200);
      vi.stubGlobal("fetch", mockFetch);

      await client.exportImport.export(baseExportParams);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should throw EngramError on 4xx response", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { code: "VALIDATION_FAILED", message: "Bad params" },
          }),
        text: () => Promise.resolve("Bad params"),
        body: null,
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.exportImport.export(baseExportParams)
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("should throw EngramError on 404 response", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({ error: { code: "NOT_FOUND", message: "Not found" } }),
        text: () => Promise.resolve("Not found"),
        body: null,
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.exportImport.export(baseExportParams)
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // --------------------------------------------------------------------------
  // exportStream
  // --------------------------------------------------------------------------

  describe("exportImport.exportStream", () => {
    it("should yield Uint8Array chunks from the response body", async () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);

      let callCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ done: false, value: chunk1 });
          if (callCount === 2) return Promise.resolve({ done: false, value: chunk2 });
          return Promise.resolve({ done: true, value: undefined });
        }),
        releaseLock: vi.fn(),
      };

      const mockStream = {
        getReader: () => mockReader,
      } as unknown as ReadableStream<Uint8Array>;

      mockFetch = mockRawResponse(mockStream, 200);
      vi.stubGlobal("fetch", mockFetch);

      const chunks: Uint8Array[] = [];
      for await (const chunk of client.exportImport.exportStream(baseExportParams)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual(chunk1);
      expect(chunks[1]).toEqual(chunk2);
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it("should yield no chunks when response body is null", async () => {
      mockFetch = mockRawResponse(null, 200);
      vi.stubGlobal("fetch", mockFetch);

      const chunks: Uint8Array[] = [];
      for await (const chunk of client.exportImport.exportStream(baseExportParams)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it("should call POST /v1/export (same as export method)", async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };
      const mockStream = {
        getReader: () => mockReader,
      } as unknown as ReadableStream<Uint8Array>;

      mockFetch = mockRawResponse(mockStream, 200);
      vi.stubGlobal("fetch", mockFetch);

      // Consume the stream
      for await (const _ of client.exportImport.exportStream(baseExportParams)) {
        // no-op
      }

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/export",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should release reader lock even if iteration is abandoned", async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve({ done: false, value: chunk });
          return Promise.resolve({ done: true, value: undefined });
        }),
        releaseLock: vi.fn(),
      };
      const mockStream = {
        getReader: () => mockReader,
      } as unknown as ReadableStream<Uint8Array>;

      mockFetch = mockRawResponse(mockStream, 200);
      vi.stubGlobal("fetch", mockFetch);

      const gen = client.exportImport.exportStream(baseExportParams);
      await gen.next(); // get first chunk then stop
      await gen.return(undefined); // force generator cleanup

      expect(mockReader.releaseLock).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // importData
  // --------------------------------------------------------------------------

  describe("exportImport.importData", () => {
    const importOptions: ImportOptions = {
      onConflict: "newer",
      wipe: false,
    };

    it("should POST to /v1/import with FormData body", async () => {
      let capturedBody: unknown;
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedBody = init.body;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportResult }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["archive content"], { type: "application/gzip" });
      await client.exportImport.importData(file, importOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/import",
        expect.objectContaining({ method: "POST" })
      );
      expect(capturedBody).toBeInstanceOf(FormData);
    });

    it("should NOT set Content-Type header (fetch sets multipart boundary)", async () => {
      let capturedHeaders: Record<string, string> = {};
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportResult }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["data"], { type: "application/gzip" });
      await client.exportImport.importData(file, importOptions);

      expect(capturedHeaders["Content-Type"]).toBeUndefined();
    });

    it("should append file and JSON-serialized options to FormData", async () => {
      let capturedFormData: FormData | null = null;
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedFormData = init.body as FormData;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportResult }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["archive content"], { type: "application/gzip" });
      await client.exportImport.importData(file, importOptions);

      expect(capturedFormData).not.toBeNull();
      expect(capturedFormData!.get("file")).toBeInstanceOf(Blob);
      expect(capturedFormData!.get("options")).toBe(JSON.stringify(importOptions));
    });

    it("should return ImportResult on success", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockImportResult }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["data"]);
      const result = await client.exportImport.importData(file, importOptions);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should throw EngramError on 4xx response", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            error: { code: "VALIDATION_FAILED", message: "Invalid archive" },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["bad data"]);
      await expect(
        client.exportImport.importData(file, importOptions)
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("should accept File objects (not just Blob)", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockImportResult }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new File(["archive content"], "backup.tar.gz", {
        type: "application/gzip",
      });
      const result = await client.exportImport.importData(file, importOptions);

      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // previewImport
  // --------------------------------------------------------------------------

  describe("exportImport.previewImport", () => {
    it("should POST to /v1/import/preview with FormData body", async () => {
      let capturedBody: unknown;
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedBody = init.body;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportPreview }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["archive content"]);
      await client.exportImport.previewImport(file);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/import/preview",
        expect.objectContaining({ method: "POST" })
      );
      expect(capturedBody).toBeInstanceOf(FormData);
    });

    it("should append file only (no options field) to FormData", async () => {
      let capturedFormData: FormData | null = null;
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedFormData = init.body as FormData;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportPreview }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["archive content"]);
      await client.exportImport.previewImport(file);

      expect(capturedFormData).not.toBeNull();
      expect(capturedFormData!.get("file")).toBeInstanceOf(Blob);
      expect(capturedFormData!.get("options")).toBeNull();
    });

    it("should NOT set Content-Type header", async () => {
      let capturedHeaders: Record<string, string> = {};
      mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockImportPreview }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["data"]);
      await client.exportImport.previewImport(file);

      expect(capturedHeaders["Content-Type"]).toBeUndefined();
    });

    it("should return ImportPreview on success", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockImportPreview }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["data"]);
      const result = await client.exportImport.previewImport(file);

      expect(result.success).toBe(true);
      expect(result.conflictCount).toBe(0);
    });

    it("should throw EngramError on 4xx response", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { code: "VALIDATION_FAILED", message: "Bad archive" },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new Blob(["bad data"]);
      await expect(
        client.exportImport.previewImport(file)
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("should accept File objects", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockImportPreview }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const file = new File(["data"], "backup.tar.gz");
      const result = await client.exportImport.previewImport(file);

      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Type correctness (compile-time assertions)
  // --------------------------------------------------------------------------

  describe("type correctness", () => {
    it("ExportScope union values are correct", () => {
      const scopes: ExportParams["scopes"] = ["knowledge", "crystals", "sessions"];
      expect(scopes).toHaveLength(3);
    });

    it("ConflictResolution union values are correct", () => {
      const resolutions: ImportOptions["onConflict"][] = [
        "newer",
        "skip",
        "overwrite",
        "prompt",
      ];
      expect(resolutions).toHaveLength(4);
    });

    it("ExportFilter date fields are typed as string (not Date)", () => {
      const filter: ExportParams["filters"] = {
        since: "2026-01-01T00:00:00Z",
        until: "2026-12-31T23:59:59Z",
      };
      expect(typeof filter.since).toBe("string");
      expect(typeof filter.until).toBe("string");
    });

    it("ImportPreview has optional fields correctly typed", () => {
      const preview: ImportPreview = { success: true };
      expect(preview.success).toBe(true);
      expect(preview.conflicts).toBeUndefined();
      expect(preview.conflictCount).toBeUndefined();
    });

    it("ImportResult counts use inserted/updated/skipped keys", () => {
      const result: ImportResult = {
        success: true,
        counts: {
          knowledgeItems: { inserted: 10, updated: 2, skipped: 0 },
        },
        errors: [],
        duration: 500,
      };
      expect(result.counts.knowledgeItems.inserted).toBe(10);
    });
  });
});

// ============================================================================
// _requestRaw Tests (on EngramClient)
// ============================================================================

describe("EngramClient._requestRaw", () => {
  let client: EngramClient;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-api-key",
      timeout: 5000,
      retries: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("should return raw Response on 2xx", async () => {
    const mockStream = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockStream,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      })
    );

    const response = await client._requestRaw("POST", "/v1/export", { test: true });

    expect(response).toBeDefined();
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  it("should set Content-Type: application/json and X-API-Key headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          body: null,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        });
      })
    );

    await client._requestRaw("POST", "/v1/export", {});

    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedHeaders["X-API-Key"]).toBe("test-api-key");
  });

  it("should throw EngramError on 4xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        body: null,
        json: () =>
          Promise.resolve({ error: { code: "VALIDATION_FAILED", message: "bad" } }),
        text: () => Promise.resolve("bad"),
      })
    );

    await expect(client._requestRaw("POST", "/v1/export", {})).rejects.toBeInstanceOf(
      EngramError
    );
  });

  it("should throw EngramError on 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        body: null,
        json: () =>
          Promise.resolve({ error: { code: "NOT_FOUND", message: "Not found" } }),
        text: () => Promise.resolve("Not found"),
      })
    );

    await expect(client._requestRaw("GET", "/v1/export", {})).rejects.toBeInstanceOf(
      EngramError
    );
  });

  it("should serialize JSON body correctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      })
    );

    const body = { scopes: ["knowledge"], format: "archive" };
    await client._requestRaw("POST", "/v1/export", body);

    const mockFetch = vi.mocked(global.fetch);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify(body) })
    );
  });
});

// ============================================================================
// _requestFormData Tests (on EngramClient)
// ============================================================================

describe("EngramClient._requestFormData", () => {
  let client: EngramClient;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-api-key",
      timeout: 5000,
      retries: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("should send FormData body and return parsed JSON", async () => {
    const responseData = { success: true, counts: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      })
    );

    const formData = new FormData();
    formData.append("file", new Blob(["data"]));

    const result = await client._requestFormData("POST", "/v1/import", formData);

    expect(result).toEqual(responseData);
  });

  it("should NOT set Content-Type header", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      })
    );

    const formData = new FormData();
    await client._requestFormData("POST", "/v1/import", formData);

    expect(capturedHeaders["Content-Type"]).toBeUndefined();
  });

  it("should set X-API-Key header", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      })
    );

    const formData = new FormData();
    await client._requestFormData("POST", "/v1/import", formData);

    expect(capturedHeaders["X-API-Key"]).toBe("test-api-key");
  });

  it("should send FormData as body (not JSON string)", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedBody = init.body;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      })
    );

    const formData = new FormData();
    await client._requestFormData("POST", "/v1/import", formData);

    expect(capturedBody).toBeInstanceOf(FormData);
  });

  it("should throw EngramError on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            error: { code: "VALIDATION_FAILED", message: "Invalid archive" },
          }),
      })
    );

    const formData = new FormData();
    await expect(
      client._requestFormData("POST", "/v1/import", formData)
    ).rejects.toBeInstanceOf(EngramError);
  });
});
