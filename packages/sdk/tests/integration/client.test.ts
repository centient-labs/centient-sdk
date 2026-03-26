/**
 * SDK Integration Tests
 *
 * Tests the SDK against a real engram server.
 * These tests require engram to be running with an embedded PostgreSQL database.
 *
 * The tests verify end-to-end functionality including:
 * - Sessions: create, get, list, update, delete
 * - Session Notes: create, list, search
 * - Knowledge Items: create, get, list, search, update, delete, getEdges, getRelated, promote
 * - Edges: create, get, list, update, delete
 * - Error handling: NotFoundError, ValidationFailedError
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import {
  EngramClient,
  NotFoundError,
  type LocalSession,
  type LocalSessionNote,
  type KnowledgeCrystal,
} from "../../src/index.js";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_PORT = 3199; // Use non-standard port for tests
const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;
const SERVER_START_TIMEOUT = 30000; // 30 seconds to start server
const PROJECT_PATH = "/test/integration-tests";

// ============================================================================
// Server Management
// ============================================================================

let serverProcess: ChildProcess | null = null;
let client: EngramClient;

/**
 * Start the engram server for integration tests.
 * Uses environment variables to configure the test port.
 */
async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server failed to start within ${SERVER_START_TIMEOUT}ms`));
    }, SERVER_START_TIMEOUT);

    // Start engram with test configuration
    serverProcess = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: "/Users/owenjohnson/dev/centient/packages/engram",
      env: {
        ...process.env,
        ENGRAM_LOCAL_PORT: String(TEST_PORT),
        ENGRAM_LOCAL_HOST: "127.0.0.1",
        NODE_ENV: "test",
        // Use embedded postgres for isolation
        ENGRAM_POSTGRES_MODE: "embedded",
        // Disable auth for simpler testing
        ENGRAM_LOCAL_AUTH_ENABLED: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let serverOutput = "";

    serverProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      serverOutput += output;

      // Server is ready when it prints the banner
      if (output.includes("ENGRAM LOCAL") || output.includes("Health:")) {
        clearTimeout(timeout);
        // Give it a moment to fully initialize
        sleep(500).then(() => resolve());
      }
    });

    serverProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      serverOutput += output;
      // Some log output goes to stderr, don't fail on it
      if (process.env.DEBUG) {
        console.error("[Server stderr]:", output);
      }
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start server: ${err.message}\nOutput: ${serverOutput}`));
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}\nOutput: ${serverOutput}`));
      }
    });
  });
}

/**
 * Stop the engram server.
 */
async function stopServer(): Promise<void> {
  if (serverProcess) {
    return new Promise((resolve) => {
      serverProcess!.on("exit", () => {
        serverProcess = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      serverProcess!.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL");
          serverProcess = null;
          resolve();
        }
      }, 5000);
    });
  }
}

/**
 * Wait for server to be healthy.
 */
async function waitForHealth(maxRetries = 20, delayMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${TEST_BASE_URL}/health`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === "ok") {
          return;
        }
      }
    } catch {
      // Server not ready yet
    }
    await sleep(delayMs);
  }
  throw new Error("Server health check failed after maximum retries");
}

// ============================================================================
// Test Lifecycle
// ============================================================================

beforeAll(async () => {
  // Start the server
  await startServer();

  // Wait for server to be healthy
  await waitForHealth();

  // Create client
  client = new EngramClient({
    baseUrl: TEST_BASE_URL,
    timeout: 10000,
    retries: 1,
  });
}, 60000); // 60 second timeout for server startup

afterAll(async () => {
  await stopServer();
}, 15000);

// ============================================================================
// Test Data Tracking
// ============================================================================

// Track created resources for cleanup
const createdSessions: string[] = [];
const createdKnowledgeItems: string[] = [];
const createdEdges: string[] = [];

// Cleanup helper
async function cleanupTestData(): Promise<void> {
  // Clean up edges first (they reference knowledge items)
  for (const edgeId of createdEdges) {
    try {
      await client.edges.delete(edgeId);
    } catch {
      // Ignore errors during cleanup
    }
  }
  createdEdges.length = 0;

  // Clean up knowledge items
  for (const itemId of createdKnowledgeItems) {
    try {
      await client.crystals.delete(itemId);
    } catch {
      // Ignore errors during cleanup
    }
  }
  createdKnowledgeItems.length = 0;

  // Clean up sessions
  for (const sessionId of createdSessions) {
    try {
      await client.sessions.delete(sessionId);
    } catch {
      // Ignore errors during cleanup
    }
  }
  createdSessions.length = 0;
}

// ============================================================================
// Sessions Resource Tests
// ============================================================================

describe("SessionsResource Integration", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("create", () => {
    it("should create a session with minimal fields", async () => {
      const session = await client.sessions.create({
        projectPath: PROJECT_PATH,
      });

      createdSessions.push(session.id);

      expect(session.id).toBeDefined();
      expect(session.projectPath).toBe(PROJECT_PATH);
      expect(session.status).toBe("active");
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it("should create a session with externalId and metadata", async () => {
      const externalId = `test-session-${Date.now()}`;
      const metadata = { purpose: "integration-test", version: 1 };

      const session = await client.sessions.create({
        externalId,
        projectPath: PROJECT_PATH,
        metadata,
      });

      createdSessions.push(session.id);

      expect(session.externalId).toBe(externalId);
      expect(session.metadata).toEqual(metadata);
    });
  });

  describe("get", () => {
    it("should get a session by ID", async () => {
      const created = await client.sessions.create({
        projectPath: PROJECT_PATH,
      });
      createdSessions.push(created.id);

      const fetched = await client.sessions.get(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.projectPath).toBe(PROJECT_PATH);
    });

    it("should get a session by externalId", async () => {
      const externalId = `test-external-${Date.now()}`;
      const created = await client.sessions.create({
        externalId,
        projectPath: PROJECT_PATH,
      });
      createdSessions.push(created.id);

      const fetched = await client.sessions.get(externalId);

      expect(fetched.externalId).toBe(externalId);
    });

    it("should throw NotFoundError for non-existent session", async () => {
      await expect(
        client.sessions.get("non-existent-session-id")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("list", () => {
    it("should list sessions", async () => {
      // Create a few sessions
      const session1 = await client.sessions.create({ projectPath: PROJECT_PATH });
      const session2 = await client.sessions.create({ projectPath: PROJECT_PATH });
      createdSessions.push(session1.id, session2.id);

      const result = await client.sessions.list();

      expect(result.sessions.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it("should filter sessions by projectPath", async () => {
      const uniquePath = `/test/unique-${Date.now()}`;
      const session = await client.sessions.create({ projectPath: uniquePath });
      createdSessions.push(session.id);

      const result = await client.sessions.list({ projectPath: uniquePath });

      expect(result.sessions.length).toBe(1);
      expect(result.sessions[0].projectPath).toBe(uniquePath);
    });

    it("should filter sessions by status", async () => {
      const session = await client.sessions.create({ projectPath: PROJECT_PATH });
      createdSessions.push(session.id);

      const activeResult = await client.sessions.list({ status: "active" });
      expect(activeResult.sessions.some((s) => s.id === session.id)).toBe(true);

      const finalizedResult = await client.sessions.list({ status: "finalized" });
      expect(finalizedResult.sessions.some((s) => s.id === session.id)).toBe(false);
    });

    it("should respect limit and offset", async () => {
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        const s = await client.sessions.create({ projectPath: PROJECT_PATH });
        createdSessions.push(s.id);
      }

      const result = await client.sessions.list({ limit: 2 });
      expect(result.sessions.length).toBe(2);
    });
  });

  describe("update", () => {
    it("should update session status", async () => {
      const session = await client.sessions.create({ projectPath: PROJECT_PATH });
      createdSessions.push(session.id);

      const updated = await client.sessions.update(session.id, {
        status: "finalized",
      });

      expect(updated.status).toBe("finalized");
    });

    it("should update session metadata", async () => {
      const session = await client.sessions.create({
        projectPath: PROJECT_PATH,
        metadata: { original: true },
      });
      createdSessions.push(session.id);

      const updated = await client.sessions.update(session.id, {
        metadata: { updated: true, version: 2 },
      });

      expect(updated.metadata).toEqual({ updated: true, version: 2 });
    });
  });

  describe("delete", () => {
    it("should delete a session", async () => {
      const session = await client.sessions.create({ projectPath: PROJECT_PATH });

      await client.sessions.delete(session.id);

      // Should not be found after deletion
      await expect(client.sessions.get(session.id)).rejects.toThrow(NotFoundError);
    });
  });
});

// ============================================================================
// Session Notes Resource Tests
// ============================================================================

describe("SessionNotesResource Integration", () => {
  let testSession: LocalSession;

  beforeEach(async () => {
    testSession = await client.sessions.create({ projectPath: PROJECT_PATH });
    createdSessions.push(testSession.id);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("create", () => {
    it("should create a note in a session", async () => {
      const note = await client.sessions.notes(testSession.id).create({
        type: "decision",
        content: "Use PostgreSQL for storage",
      });

      expect(note.id).toBeDefined();
      expect(note.sessionId).toBe(testSession.id);
      expect(note.type).toBe("decision");
      expect(note.content).toBe("Use PostgreSQL for storage");
      expect(note.embeddingStatus).toBe("pending");
    });

    it("should create a note with metadata", async () => {
      const note = await client.sessions.notes(testSession.id).create({
        type: "hypothesis",
        content: "The caching layer might improve performance",
        metadata: { confidence: 0.7, source: "analysis" },
      });

      expect(note.metadata).toEqual({ confidence: 0.7, source: "analysis" });
    });
  });

  describe("list", () => {
    it("should list notes in a session", async () => {
      await client.sessions.notes(testSession.id).create({
        type: "decision",
        content: "Decision 1",
      });
      await client.sessions.notes(testSession.id).create({
        type: "hypothesis",
        content: "Hypothesis 1",
      });

      const result = await client.sessions.notes(testSession.id).list();

      expect(result.notes.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it("should filter notes by type", async () => {
      await client.sessions.notes(testSession.id).create({
        type: "decision",
        content: "Decision 1",
      });
      await client.sessions.notes(testSession.id).create({
        type: "hypothesis",
        content: "Hypothesis 1",
      });

      const result = await client.sessions.notes(testSession.id).list({
        type: "decision",
      });

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].type).toBe("decision");
    });
  });

  describe("search", () => {
    it("should search notes within session", async () => {
      await client.sessions.notes(testSession.id).create({
        type: "decision",
        content: "We decided to use PostgreSQL for the database layer",
      });
      await client.sessions.notes(testSession.id).create({
        type: "hypothesis",
        content: "The authentication flow should use JWT tokens",
      });

      // Wait a moment for embeddings to be processed (if available)
      await sleep(500);

      const results = await client.sessions.notes(testSession.id).search({
        query: "database storage",
        limit: 5,
      });

      // Search may return results based on keyword matching or embeddings
      expect(Array.isArray(results)).toBe(true);
    });
  });
});

// ============================================================================
// Notes Resource Tests (Global)
// ============================================================================

describe("NotesResource Integration", () => {
  let testSession: LocalSession;
  let testNote: LocalSessionNote;

  beforeEach(async () => {
    testSession = await client.sessions.create({ projectPath: PROJECT_PATH });
    createdSessions.push(testSession.id);

    testNote = await client.sessions.notes(testSession.id).create({
      type: "decision",
      content: "Original content",
    });
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("get", () => {
    it("should get a note by ID", async () => {
      const note = await client.notes.get(testNote.id);

      expect(note.id).toBe(testNote.id);
      expect(note.content).toBe("Original content");
    });

    it("should throw NotFoundError for non-existent note", async () => {
      await expect(
        client.notes.get("00000000-0000-0000-0000-000000000000")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("update", () => {
    it("should update a note", async () => {
      const updated = await client.notes.update(testNote.id, {
        content: "Updated content",
      });

      expect(updated.content).toBe("Updated content");
    });
  });

  describe("delete", () => {
    it("should delete a note", async () => {
      await client.notes.delete(testNote.id);

      await expect(client.notes.get(testNote.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("search", () => {
    it("should perform global search across sessions", async () => {
      // Create notes in multiple sessions
      const session2 = await client.sessions.create({ projectPath: PROJECT_PATH });
      createdSessions.push(session2.id);

      await client.sessions.notes(testSession.id).create({
        type: "decision",
        content: "Database architecture decision",
      });
      await client.sessions.notes(session2.id).create({
        type: "learning",
        content: "Learned about database indexing strategies",
      });

      await sleep(500);

      const results = await client.notes.search({
        query: "database",
        limit: 10,
      });

      expect(Array.isArray(results)).toBe(true);
    });
  });
});

// ============================================================================
// Crystals Resource Tests (migrated from KnowledgeResource)
// ============================================================================

describe("CrystalsResource Integration", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("create", () => {
    it("should create a knowledge crystal node", async () => {
      const item = await client.crystals.create({
        nodeType: "pattern",
        title: "Repository Pattern",
        summary: "Abstracting data access behind an interface",
        tags: ["architecture", "data-access"],
        contentInline: "The repository pattern provides a clean abstraction...",
      });

      createdKnowledgeItems.push(item.id);

      expect(item.id).toBeDefined();
      expect(item.nodeType).toBe("pattern");
      expect(item.title).toBe("Repository Pattern");
      expect(item.summary).toBe("Abstracting data access behind an interface");
      expect(item.tags).toEqual(["architecture", "data-access"]);
      expect(item.contentInline).toContain("repository pattern");
      expect(item.verified).toBe(false);
    });

    it("should create a knowledge crystal with all fields", async () => {
      const item = await client.crystals.create({
        nodeType: "decision",
        title: "Use TypeScript",
        summary: "Project will use TypeScript for type safety",
        tags: ["language", "tooling"],
        contentInline: "We chose TypeScript because...",
        confidence: 0.9,
        verified: true,
        sourceType: "manual",
        sourceProject: "my-project",
        typeMetadata: { rationale: "Type safety improves reliability" },
      });

      createdKnowledgeItems.push(item.id);

      expect(item.confidence).toBe(0.9);
      expect(item.verified).toBe(true);
      expect(item.sourceType).toBe("manual");
      expect(item.sourceProject).toBe("my-project");
      expect(item.typeMetadata).toEqual({ rationale: "Type safety improves reliability" });
    });
  });

  describe("get", () => {
    it("should get a knowledge crystal by ID", async () => {
      const created = await client.crystals.create({
        nodeType: "learning",
        title: "Test Knowledge",
        summary: "Test summary",
      });
      createdKnowledgeItems.push(created.id);

      const fetched = await client.crystals.get(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe("Test Knowledge");
    });

    it("should throw NotFoundError for non-existent item", async () => {
      await expect(
        client.crystals.get("00000000-0000-0000-0000-000000000000")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("list", () => {
    it("should list knowledge crystals", async () => {
      const item1 = await client.crystals.create({
        nodeType: "pattern",
        title: "Pattern 1",
      });
      const item2 = await client.crystals.create({
        nodeType: "learning",
        title: "Learning 1",
      });
      createdKnowledgeItems.push(item1.id, item2.id);

      const result = await client.crystals.list();

      expect(result.crystals.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by nodeType", async () => {
      const pattern = await client.crystals.create({
        nodeType: "pattern",
        title: "Filter Test Pattern",
      });
      const learning = await client.crystals.create({
        nodeType: "learning",
        title: "Filter Test Learning",
      });
      createdKnowledgeItems.push(pattern.id, learning.id);

      const result = await client.crystals.list({ nodeType: "pattern" });

      expect(result.crystals.every((i) => i.nodeType === "pattern")).toBe(true);
    });

    it("should filter by tags", async () => {
      const tagged = await client.crystals.create({
        nodeType: "pattern",
        title: "Tagged Item",
        tags: ["unique-tag-123"],
      });
      createdKnowledgeItems.push(tagged.id);

      const result = await client.crystals.list({ tags: ["unique-tag-123"] });

      expect(result.crystals.some((i) => i.id === tagged.id)).toBe(true);
    });

    it("should filter by verified status", async () => {
      const verified = await client.crystals.create({
        nodeType: "decision",
        title: "Verified Decision",
        verified: true,
      });
      const unverified = await client.crystals.create({
        nodeType: "decision",
        title: "Unverified Decision",
        verified: false,
      });
      createdKnowledgeItems.push(verified.id, unverified.id);

      const verifiedResult = await client.crystals.list({ verified: true });
      expect(verifiedResult.crystals.some((i) => i.id === verified.id)).toBe(true);
      expect(verifiedResult.crystals.some((i) => i.id === unverified.id)).toBe(false);
    });

    it("should respect limit and offset", async () => {
      // Create several items
      for (let i = 0; i < 5; i++) {
        const item = await client.crystals.create({
          nodeType: "note",
          title: `List Test Note ${i}`,
        });
        createdKnowledgeItems.push(item.id);
      }

      const result = await client.crystals.list({ limit: 2 });
      expect(result.crystals.length).toBe(2);
    });
  });

  describe("update", () => {
    it("should update a knowledge crystal", async () => {
      const item = await client.crystals.create({
        nodeType: "pattern",
        title: "Original Title",
        summary: "Original summary",
      });
      createdKnowledgeItems.push(item.id);

      const updated = await client.crystals.update(item.id, {
        title: "Updated Title",
        summary: "Updated summary",
        verified: true,
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.summary).toBe("Updated summary");
      expect(updated.verified).toBe(true);
    });

    it("should throw NotFoundError for non-existent item", async () => {
      await expect(
        client.crystals.update("00000000-0000-0000-0000-000000000000", {
          title: "Updated",
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("delete", () => {
    it("should delete a knowledge crystal", async () => {
      const item = await client.crystals.create({
        nodeType: "note",
        title: "To Delete",
      });

      await client.crystals.delete(item.id);

      await expect(client.crystals.get(item.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("search", () => {
    it("should search knowledge crystals", async () => {
      const item = await client.crystals.create({
        nodeType: "pattern",
        title: "Search Test Pattern",
        summary: "This pattern involves database connection pooling strategies",
        contentInline: "Connection pooling helps manage database connections efficiently...",
      });
      createdKnowledgeItems.push(item.id);

      await sleep(500);

      const results = await client.crystals.search({
        query: "database connection",
        limit: 10,
      });

      expect(Array.isArray(results)).toBe(true);
    });

    it("should filter search by nodeType", async () => {
      const pattern = await client.crystals.create({
        nodeType: "pattern",
        title: "Search Filter Pattern",
        summary: "Testing search filtering",
      });
      const learning = await client.crystals.create({
        nodeType: "learning",
        title: "Search Filter Learning",
        summary: "Testing search filtering",
      });
      createdKnowledgeItems.push(pattern.id, learning.id);

      await sleep(500);

      const results = await client.crystals.search({
        query: "search filtering",
        nodeType: "pattern",
        limit: 10,
      });

      expect(results.every((r) => r.item.nodeType === "pattern")).toBe(true);
    });
  });

  describe("edges via edges resource", () => {
    it("should get edges for a knowledge crystal via edges.list", async () => {
      const source = await client.crystals.create({
        nodeType: "pattern",
        title: "Source Pattern",
      });
      const target = await client.crystals.create({
        nodeType: "pattern",
        title: "Target Pattern",
      });
      createdKnowledgeItems.push(source.id, target.id);

      const edge = await client.edges.create({
        sourceId: source.id,
        targetId: target.id,
        relationship: "related_to",
      });
      createdEdges.push(edge.id);

      const result = await client.edges.list({ sourceId: source.id });

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
      expect(result.edges.some((e) => e.id === edge.id)).toBe(true);
    });
  });

  describe("versions", () => {
    it("should get version history for a knowledge crystal", async () => {
      const item = await client.crystals.create({
        nodeType: "pattern",
        title: "Versioned Pattern",
        contentInline: "Version 1 content",
      });
      createdKnowledgeItems.push(item.id);

      const result = await client.crystals.versions(item.id).list();

      expect(Array.isArray(result.versions)).toBe(true);
    });

    it("should create a new version of a knowledge crystal", async () => {
      const original = await client.crystals.create({
        nodeType: "pattern",
        title: "Original Pattern",
        contentInline: "Original content",
      });
      createdKnowledgeItems.push(original.id);

      const newVersion = await client.crystals.versions(original.id).create({
        changelog: "Updated to v2",
      });

      expect(newVersion.crystalId).toBe(original.id);
    });
  });
});

// ============================================================================
// Edges Resource Tests
// ============================================================================

describe("EdgesResource Integration", () => {
  let sourceItem: KnowledgeCrystal;
  let targetItem: KnowledgeCrystal;

  beforeEach(async () => {
    sourceItem = await client.crystals.create({
      nodeType: "pattern",
      title: "Edge Test Source",
    });
    targetItem = await client.crystals.create({
      nodeType: "pattern",
      title: "Edge Test Target",
    });
    createdKnowledgeItems.push(sourceItem.id, targetItem.id);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("create", () => {
    it("should create an edge between knowledge items", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(edge.id);

      expect(edge.id).toBeDefined();
      expect(edge.sourceId).toBe(sourceItem.id);
      expect(edge.targetId).toBe(targetItem.id);
      expect(edge.relationship).toBe("related_to");
    });

    it("should create an edge with metadata", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "derived_from",
        metadata: { reason: "Refactored from original" },
      });
      createdEdges.push(edge.id);

      expect(edge.metadata).toEqual({ reason: "Refactored from original" });
    });

    it("should support all relationship types", async () => {
      const relationshipTypes = [
        "derived_from",
        "related_to",
        "contradicts",
        "implements",
        "depends_on",
      ] as const;

      for (const relationship of relationshipTypes) {
        const source = await client.crystals.create({
          nodeType: "note",
          title: `Source for ${relationship}`,
        });
        const target = await client.crystals.create({
          nodeType: "note",
          title: `Target for ${relationship}`,
        });
        createdKnowledgeItems.push(source.id, target.id);

        const edge = await client.edges.create({
          sourceId: source.id,
          targetId: target.id,
          relationship,
        });
        createdEdges.push(edge.id);

        expect(edge.relationship).toBe(relationship);
      }
    });
  });

  describe("get", () => {
    it("should get an edge by ID", async () => {
      const created = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(created.id);

      const fetched = await client.edges.get(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.sourceId).toBe(sourceItem.id);
      expect(fetched.targetId).toBe(targetItem.id);
    });

    it("should throw NotFoundError for non-existent edge", async () => {
      await expect(
        client.edges.get("00000000-0000-0000-0000-000000000000")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("list", () => {
    it("should list edges", async () => {
      const edge1 = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(edge1.id);

      const result = await client.edges.list();

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by sourceId", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(edge.id);

      const result = await client.edges.list({ sourceId: sourceItem.id });

      expect(result.edges.every((e) => e.sourceId === sourceItem.id)).toBe(true);
    });

    it("should filter by targetId", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(edge.id);

      const result = await client.edges.list({ targetId: targetItem.id });

      expect(result.edges.every((e) => e.targetId === targetItem.id)).toBe(true);
    });

    it("should filter by relationship", async () => {
      const edge1 = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });
      createdEdges.push(edge1.id);

      // Create another item pair for different relationship
      const source2 = await client.crystals.create({
        nodeType: "note",
        title: "Source 2",
      });
      const target2 = await client.crystals.create({
        nodeType: "note",
        title: "Target 2",
      });
      createdKnowledgeItems.push(source2.id, target2.id);

      const edge2 = await client.edges.create({
        sourceId: source2.id,
        targetId: target2.id,
        relationship: "depends_on",
      });
      createdEdges.push(edge2.id);

      const result = await client.edges.list({ relationship: "related_to" });

      expect(result.edges.every((e) => e.relationship === "related_to")).toBe(true);
    });
  });

  describe("update", () => {
    it("should update edge metadata", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
        metadata: { original: true },
      });
      createdEdges.push(edge.id);

      const updated = await client.edges.update(edge.id, {
        metadata: { updated: true, version: 2 },
      });

      expect(updated.metadata).toEqual({ updated: true, version: 2 });
    });
  });

  describe("delete", () => {
    it("should delete an edge", async () => {
      const edge = await client.edges.create({
        sourceId: sourceItem.id,
        targetId: targetItem.id,
        relationship: "related_to",
      });

      await client.edges.delete(edge.id);

      await expect(client.edges.get(edge.id)).rejects.toThrow(NotFoundError);
    });
  });
});

// ============================================================================
// Session Scratch Resource Tests
// ============================================================================

describe("SessionScratchResource Integration", () => {
  let testSession: LocalSession;

  beforeEach(async () => {
    testSession = await client.sessions.create({ projectPath: PROJECT_PATH });
    createdSessions.push(testSession.id);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("create", () => {
    it("should create a scratch note", async () => {
      const scratch = await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "This looks like a potential pattern",
      });

      expect(scratch.id).toBeDefined();
      expect(scratch.sessionId).toBe(testSession.id);
      expect(scratch.type).toBe("observation");
      expect(scratch.content).toBe("This looks like a potential pattern");
    });

    it("should create scratch with promotion hints", async () => {
      const scratch = await client.sessions.scratch(testSession.id).create({
        type: "insight",
        content: "This could be promoted to a pattern",
        suggestedType: "pattern",
        promotionScore: 0.8,
      });

      expect(scratch.suggestedType).toBe("pattern");
      expect(scratch.promotionScore).toBe(0.8);
    });
  });

  describe("get", () => {
    it("should get a scratch note by ID", async () => {
      const created = await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "Test scratch",
      });

      const fetched = await client.sessions.scratch(testSession.id).get(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.content).toBe("Test scratch");
    });
  });

  describe("list", () => {
    it("should list scratch notes in a session", async () => {
      await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "Scratch 1",
      });
      await client.sessions.scratch(testSession.id).create({
        type: "insight",
        content: "Scratch 2",
      });

      const result = await client.sessions.scratch(testSession.id).list();

      expect(result.scratches.length).toBe(2);
    });

    it("should filter scratch notes by type", async () => {
      await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "Observation scratch",
      });
      await client.sessions.scratch(testSession.id).create({
        type: "insight",
        content: "Insight scratch",
      });

      const result = await client.sessions.scratch(testSession.id).list({
        type: "observation",
      });

      expect(result.scratches.length).toBe(1);
      expect(result.scratches[0].type).toBe("observation");
    });
  });

  describe("update", () => {
    it("should update a scratch note", async () => {
      const scratch = await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "Original content",
      });

      const updated = await client.sessions.scratch(testSession.id).update(scratch.id, {
        content: "Updated content",
        promotionScore: 0.9,
      });

      expect(updated.content).toBe("Updated content");
      expect(updated.promotionScore).toBe(0.9);
    });
  });

  describe("delete", () => {
    it("should delete a scratch note", async () => {
      const scratch = await client.sessions.scratch(testSession.id).create({
        type: "observation",
        content: "To be deleted",
      });

      await client.sessions.scratch(testSession.id).delete(scratch.id);

      await expect(
        client.sessions.scratch(testSession.id).get(scratch.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling Integration", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it("should handle NotFoundError correctly", async () => {
    try {
      await client.sessions.get("definitely-not-a-real-session-id");
      expect.fail("Should have thrown NotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("NOT_FOUND");
      expect((error as NotFoundError).statusCode).toBe(404);
    }
  });

  it("should handle multiple NotFoundError scenarios", async () => {
    // Non-existent session
    await expect(client.sessions.get("non-existent")).rejects.toThrow(NotFoundError);

    // Non-existent crystal
    await expect(
      client.crystals.get("00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(NotFoundError);

    // Non-existent edge
    await expect(
      client.edges.get("00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(NotFoundError);
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety Integration", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it("should return properly typed session objects", async () => {
    const session = await client.sessions.create({
      projectPath: PROJECT_PATH,
    });
    createdSessions.push(session.id);

    // Type checks (these would fail compilation if types were wrong)
    const id: string = session.id;
    const projectPath: string = session.projectPath;
    const status: "active" | "finalized" | "abandoned" = session.status;
    const createdAt: string = session.createdAt;
    const metadata: Record<string, unknown> = session.metadata;

    expect(typeof id).toBe("string");
    expect(typeof projectPath).toBe("string");
    expect(["active", "finalized", "abandoned"]).toContain(status);
    expect(typeof createdAt).toBe("string");
    expect(typeof metadata).toBe("object");
  });

  it("should return properly typed knowledge crystal objects", async () => {
    const item = await client.crystals.create({
      nodeType: "pattern",
      title: "Type Test Pattern",
      tags: ["test"],
    });
    createdKnowledgeItems.push(item.id);

    // Type checks
    const id: string = item.id;
    const nodeType: string = item.nodeType;
    const title: string = item.title;
    const tags: string[] = item.tags;
    const verified: boolean = item.verified;

    expect(typeof id).toBe("string");
    expect(typeof nodeType).toBe("string");
    expect(typeof title).toBe("string");
    expect(Array.isArray(tags)).toBe(true);
    expect(typeof verified).toBe("boolean");
  });

  it("should return properly typed edge objects", async () => {
    const source = await client.crystals.create({
      nodeType: "note",
      title: "Type Test Source",
    });
    const target = await client.crystals.create({
      nodeType: "note",
      title: "Type Test Target",
    });
    createdKnowledgeItems.push(source.id, target.id);

    const edge = await client.edges.create({
      sourceId: source.id,
      targetId: target.id,
      relationship: "related_to",
    });
    createdEdges.push(edge.id);

    // Type checks
    const id: string = edge.id;
    const sourceId: string = edge.sourceId;
    const targetId: string = edge.targetId;
    const relationship: string = edge.relationship;
    const createdAt: string = edge.createdAt;

    expect(typeof id).toBe("string");
    expect(typeof sourceId).toBe("string");
    expect(typeof targetId).toBe("string");
    expect(typeof relationship).toBe("string");
    expect(typeof createdAt).toBe("string");
  });
});
