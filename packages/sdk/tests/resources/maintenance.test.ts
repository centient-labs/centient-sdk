/**
 * Maintenance Resource Tests
 *
 * Tests for the MaintenanceResource SDK pattern.
 * Maintenance operations include tombstone cleanup and changelog compaction
 * with dry-run support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type {
  TombstoneCleanupResult,
  ChangelogCompactResult,
} from "../../src/resources/maintenance.js";

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
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

const mockTombstoneResult: TombstoneCleanupResult = {
  deleted: 42,
  warnings: [],
  dryRun: false,
};

const mockChangelogResult: ChangelogCompactResult = {
  deleted: 100,
  belowSeq: "seq-500",
  dryRun: false,
};

// ============================================================================
// Test Setup
// ============================================================================

describe("MaintenanceResource", () => {
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
  // maintenance.tombstoneCleanup()
  // ==========================================================================

  describe("maintenance.tombstoneCleanup", () => {
    it("should POST to /v1/maintenance/tombstone-cleanup", async () => {
      mockFetch = mockFetchResponse({ data: mockTombstoneResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.maintenance.tombstoneCleanup();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/maintenance/tombstone-cleanup",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.deleted).toBe(42);
      expect(result.warnings).toEqual([]);
      expect(result.dryRun).toBe(false);
    });

    it("should include days and dryRun in request body", async () => {
      const dryRunResult: TombstoneCleanupResult = {
        deleted: 15,
        warnings: ["Some records have dependencies"],
        dryRun: true,
      };

      mockFetch = mockFetchResponse({ data: dryRunResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.maintenance.tombstoneCleanup({
        days: 30,
        dryRun: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/maintenance/tombstone-cleanup",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ days: 30, dryRun: true }),
        })
      );

      expect(result.deleted).toBe(15);
      expect(result.warnings).toEqual(["Some records have dependencies"]);
      expect(result.dryRun).toBe(true);
    });

    it("throws EngramError on 500", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INTERNAL_ERROR", message: "Server error" } },
        500
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.maintenance.tombstoneCleanup()
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // ==========================================================================
  // maintenance.changelogCompact()
  // ==========================================================================

  describe("maintenance.changelogCompact", () => {
    it("should POST to /v1/maintenance/changelog-compact", async () => {
      mockFetch = mockFetchResponse({ data: mockChangelogResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.maintenance.changelogCompact();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/maintenance/changelog-compact",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.deleted).toBe(100);
      expect(result.belowSeq).toBe("seq-500");
      expect(result.dryRun).toBe(false);
    });

    it("should include days and dryRun in request body", async () => {
      const dryRunResult: ChangelogCompactResult = {
        deleted: 50,
        belowSeq: "seq-200",
        dryRun: true,
        reason: "Preview only",
      };

      mockFetch = mockFetchResponse({ data: dryRunResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.maintenance.changelogCompact({
        days: 90,
        dryRun: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/maintenance/changelog-compact",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ days: 90, dryRun: true }),
        })
      );

      expect(result.deleted).toBe(50);
      expect(result.belowSeq).toBe("seq-200");
      expect(result.dryRun).toBe(true);
      expect(result.reason).toBe("Preview only");
    });

    it("throws EngramError on 500", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INTERNAL_ERROR", message: "Server error" } },
        500
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.maintenance.changelogCompact()
      ).rejects.toBeInstanceOf(EngramError);
    });
  });
});
