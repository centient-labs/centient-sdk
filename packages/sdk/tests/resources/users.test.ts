/**
 * Users Resource Tests
 *
 * Tests for the UsersResource SDK pattern.
 * Users are accounts with associated API key provisioning.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type { User, ApiKey } from "../../src/resources/users.js";

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

const USER_ID = "00000000-0000-4000-8000-000000000010";

const mockUser: User = {
  id: USER_ID,
  name: "alice",
  displayName: "Alice Smith",
  createdAt: "2026-01-01T00:00:00Z",
};

const mockApiKey: ApiKey = {
  id: "key-001",
  name: "default",
  prefix: "eng_",
  value: "eng_abc123secret",
};

// ============================================================================
// Test Setup
// ============================================================================

describe("UsersResource", () => {
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
  // users.create()
  // ==========================================================================

  describe("users.create", () => {
    it("should POST to /v1/users and return user + key", async () => {
      mockFetch = mockFetchResponse(
        { data: { user: mockUser, key: mockApiKey } },
        201
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.users.create({ name: "alice" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "alice" }),
        })
      );

      expect(result.user.id).toBe(USER_ID);
      expect(result.user.name).toBe("alice");
      expect(result.key.prefix).toBe("eng_");
      expect(result.key.value).toBe("eng_abc123secret");
    });

    it("throws EngramError on validation failure", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "VALIDATION_FAILED", message: "name is required" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.users.create({ name: "" })
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // ==========================================================================
  // users.list()
  // ==========================================================================

  describe("users.list", () => {
    it("should GET /v1/users and return User[]", async () => {
      const secondUser: User = {
        id: "00000000-0000-4000-8000-000000000011",
        name: "bob",
        displayName: null,
        createdAt: "2026-01-02T00:00:00Z",
      };

      mockFetch = mockFetchResponse({
        data: { users: [mockUser, secondUser] },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/users",
        expect.objectContaining({ method: "GET" })
      );

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("alice");
      expect(result[1].name).toBe("bob");
    });
  });

  // ==========================================================================
  // users.get()
  // ==========================================================================

  describe("users.get", () => {
    it("should GET /v1/users/:idOrName and return User", async () => {
      mockFetch = mockFetchResponse({ data: { user: mockUser } });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.users.get("alice");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/users/alice",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.id).toBe(USER_ID);
      expect(result.name).toBe("alice");
      expect(result.displayName).toBe("Alice Smith");
    });

    it("throws EngramError on 404", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.users.get("nonexistent")).rejects.toBeInstanceOf(
        EngramError
      );
    });
  });

  // ==========================================================================
  // users.delete()
  // ==========================================================================

  describe("users.delete", () => {
    it("should DELETE /v1/users/:idOrName", async () => {
      mockFetch = mockFetchResponse({
        data: { deleted: true, revokedKeys: 0 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.users.delete("alice");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/users/alice",
        expect.objectContaining({ method: "DELETE" })
      );

      expect(result.deleted).toBe(true);
      expect(result.revokedKeys).toBe(0);
    });

    it("should DELETE /v1/users/:idOrName?revokeKeys=true with revokeKeys option", async () => {
      mockFetch = mockFetchResponse({
        data: { deleted: true, revokedKeys: 3 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.users.delete("alice", { revokeKeys: true });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/users/alice");
      expect(calledUrl).toContain("revokeKeys=true");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "DELETE" })
      );

      expect(result.deleted).toBe(true);
      expect(result.revokedKeys).toBe(3);
    });

    it("throws EngramError on 500", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INTERNAL_ERROR", message: "Server error" } },
        500
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.users.delete("alice")).rejects.toBeInstanceOf(
        EngramError
      );
    });
  });
});
