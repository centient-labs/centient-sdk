/**
 * Memory Spaces Resource Tests
 *
 * Tests for the MemorySpacesResource SDK pattern (engram Knowledge API).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "../../src/client.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ "content-type": "application/json" }),
  });
}

describe("MemorySpacesResource", () => {
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

  describe("memorySpaces.list", () => {
    it("should GET /v1/memory-spaces", async () => {
      const mockSpaces = [
        {
          id: "space-1",
          title: "Shared Context",
          description: "A shared space",
          visibility: "shared",
          nodeType: "memory_space",
          createdAt: "2026-01-25T10:00:00Z",
          updatedAt: "2026-01-25T10:00:00Z",
        },
      ];

      mockFetch = mockFetchResponse({ data: { spaces: mockSpaces } });
      vi.stubGlobal("fetch", mockFetch);

      const spaces = await client.memorySpaces.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/memory-spaces",
        expect.objectContaining({ method: "GET" })
      );

      expect(spaces).toHaveLength(1);
      expect(spaces[0].title).toBe("Shared Context");
    });

    it("should pass agentId query param when specified", async () => {
      mockFetch = mockFetchResponse({ data: { spaces: [] } });
      vi.stubGlobal("fetch", mockFetch);

      await client.memorySpaces.list({ agentId: "agent-42" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/memory-spaces?");
      expect(calledUrl).toContain("agentId=agent-42");
    });
  });

  describe("memorySpaces.create", () => {
    it("should POST to /v1/memory-spaces", async () => {
      const mockSpace = {
        id: "space-new",
        title: "Team Knowledge",
        description: "A shared team space",
        visibility: "shared",
        nodeType: "memory_space",
        createdAt: "2026-01-25T10:00:00Z",
        updatedAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: { space: mockSpace } }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const createParams = {
        title: "Team Knowledge",
        description: "A shared team space",
        visibility: "shared" as const,
      };

      const space = await client.memorySpaces.create(createParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/memory-spaces",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(createParams),
        })
      );

      expect(space.id).toBe("space-new");
      expect(space.title).toBe("Team Knowledge");
    });
  });

  describe("memorySpaces.get", () => {
    it("should GET /v1/memory-spaces/:id with members", async () => {
      const mockSpace = {
        id: "space-1",
        title: "Shared Context",
        description: "A shared space",
        visibility: "shared",
        nodeType: "memory_space",
        createdAt: "2026-01-25T10:00:00Z",
        updatedAt: "2026-01-25T10:00:00Z",
        members: [
          { agentId: "agent-1", permission: "admin", joinedAt: "2026-01-25T10:00:00Z" },
          { agentId: "agent-2", permission: "read", joinedAt: "2026-01-25T11:00:00Z" },
        ],
      };

      mockFetch = mockFetchResponse({ data: { space: mockSpace } });
      vi.stubGlobal("fetch", mockFetch);

      const space = await client.memorySpaces.get("space-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/memory-spaces/space-1",
        expect.objectContaining({ method: "GET" })
      );

      expect(space.id).toBe("space-1");
      expect(space.members).toHaveLength(2);
      expect(space.members[0].agentId).toBe("agent-1");
    });
  });

  describe("memorySpaces.join", () => {
    it("should POST to /v1/memory-spaces/:id/join", async () => {
      const mockMember = {
        agentId: "agent-3",
        permission: "write",
        joinedAt: "2026-01-25T12:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: { member: mockMember } });
      vi.stubGlobal("fetch", mockFetch);

      const joinParams = { agentId: "agent-3", permission: "write" as const };
      const member = await client.memorySpaces.join("space-1", joinParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/memory-spaces/space-1/join",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(joinParams),
        })
      );

      expect(member.agentId).toBe("agent-3");
      expect(member.permission).toBe("write");
    });
  });

  describe("memorySpaces.leave", () => {
    it("should DELETE /v1/memory-spaces/:id/leave with agentId query param", async () => {
      mockFetch = mockFetchResponse({ data: { removed: true } });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.memorySpaces.leave("space-1", "agent-3");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/memory-spaces/space-1/leave?agentId=agent-3",
        expect.objectContaining({
          method: "DELETE",
        })
      );

      expect(result.removed).toBe(true);
    });
  });
});
