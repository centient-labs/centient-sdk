/**
 * Multi-Process Safety E2E Tests
 *
 * Critical tests for verifying that multiple processes can write
 * audit events simultaneously without data loss or corruption.
 *
 * @module tests/e2e/multiprocess.e2e.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create unique test directory for each run
const testDir = join(
  tmpdir(),
  `engram-multiprocess-test-${Date.now()}-${process.pid}`
);

/**
 * Helper to read all events from the audit log file
 */
function readEvents(logPath: string): Array<Record<string, unknown>> {
  if (!existsSync(logPath)) {
    return [];
  }
  const content = readFileSync(logPath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        // Return marker for corrupted lines
        return { __corrupted: true, __raw: line };
      }
    });
}

/**
 * Helper to check if any events are corrupted (partial writes)
 */
function countCorruptedEvents(events: Array<Record<string, unknown>>): number {
  return events.filter((e) => e.__corrupted === true).length;
}

/**
 * Worker script content for spawning child processes that write audit events.
 * Uses the COMPILED dist/ files since spawned processes can't use TypeScript directly.
 */
function createWorkerScript(distPath: string): string {
  return `
import { AuditWriter } from "${distPath}/AuditWriter.js";

const testDir = process.argv[2];
const workerId = parseInt(process.argv[3], 10);
const eventCount = parseInt(process.argv[4], 10);

async function main() {
  const writer = new AuditWriter({
    auditDir: testDir,
    version: "1.0.0-test",
  });

  const eventIds = [];

  for (let i = 0; i < eventCount; i++) {
    const eventId = await writer.log(
      "tool_call",
      "multiprocess_test",
      "success",
      i * 10,
      {
        input: { workerId, eventIndex: i },
        projectPath: "/test/multiprocess",
        sessionId: \`worker-\${workerId}\`,
      }
    );
    eventIds.push(eventId);
  }

  // Output event IDs as JSON for parent process to collect
  console.log(JSON.stringify({ workerId, eventIds }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

// Get the path to the dist directory (compiled JS files)
const distPath = join(__dirname, "../../dist");

describe("Multi-Process Safety E2E", () => {
  beforeEach(() => {
    // Create fresh test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should handle concurrent writes from multiple processes without data loss", async () => {
    // Check if dist files exist (package must be built)
    if (!existsSync(join(distPath, "AuditWriter.js"))) {
      console.log("Skipping: dist files not found. Run 'npm run build' first.");
      return;
    }

    const PROCESS_COUNT = 5;
    const EVENTS_PER_PROCESS = 100;
    const TOTAL_EXPECTED = PROCESS_COUNT * EVENTS_PER_PROCESS;

    // Write worker script to temp file
    const workerPath = join(testDir, "worker.mjs");
    writeFileSync(workerPath, createWorkerScript(distPath));

    // Spawn child processes
    const processPromises: Promise<{
      workerId: number;
      eventIds: string[];
    }>[] = [];

    for (let i = 0; i < PROCESS_COUNT; i++) {
      const promise = new Promise<{ workerId: number; eventIds: string[] }>(
        (resolve, reject) => {
          const child = spawn(
            "node",
            [workerPath, testDir, String(i), String(EVENTS_PER_PROCESS)],
            {
              stdio: ["ignore", "pipe", "pipe"],
              env: { ...process.env, NODE_NO_WARNINGS: "1" },
            }
          );

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (data) => {
            stdout += data.toString();
          });

          child.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          child.on("close", (code) => {
            if (code !== 0) {
              reject(new Error(`Worker ${i} exited with code ${code}: ${stderr}`));
              return;
            }

            try {
              const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
              resolve(result);
            } catch (e) {
              reject(new Error(`Failed to parse worker ${i} output: ${stdout}`));
            }
          });

          child.on("error", reject);
        }
      );

      processPromises.push(promise);
    }

    // Wait for all processes to complete
    const results = await Promise.all(processPromises);

    // Collect all event IDs
    const allEventIds = results.flatMap((r) => r.eventIds);

    // Verify all processes reported their events
    expect(allEventIds.length).toBe(TOTAL_EXPECTED);

    // Verify all event IDs are unique
    const uniqueIds = new Set(allEventIds);
    expect(uniqueIds.size).toBe(TOTAL_EXPECTED);

    // Read and verify the audit file
    const logPath = join(testDir, "events.jsonl");
    const events = readEvents(logPath);

    // Verify no corruption
    const corrupted = countCorruptedEvents(events);
    expect(corrupted).toBe(0);

    // Verify all events were written
    expect(events.length).toBe(TOTAL_EXPECTED);

    // Verify each event has valid structure
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
      expect(event.eventType).toBe("tool_call");
      expect(event.tool).toBe("multiprocess_test");
      expect(event.outcome).toBe("success");
      expect(typeof event.duration).toBe("number");
    }

    // Verify all reported IDs exist in the file
    const fileEventIds = new Set(events.map((e) => e.id));
    for (const id of allEventIds) {
      expect(fileEventIds.has(id)).toBe(true);
    }

    // Verify events from each worker are present
    for (let workerId = 0; workerId < PROCESS_COUNT; workerId++) {
      const workerEvents = events.filter(
        (e) =>
          (e.input as Record<string, unknown>)?.workerId === workerId
      );
      expect(workerEvents.length).toBe(EVENTS_PER_PROCESS);
    }
  }, 60000); // 60 second timeout for this test

  it("should maintain event ID uniqueness across processes", async () => {
    // Check if dist files exist (package must be built)
    if (!existsSync(join(distPath, "AuditWriter.js"))) {
      console.log("Skipping: dist files not found. Run 'npm run build' first.");
      return;
    }

    const PROCESS_COUNT = 3;
    const EVENTS_PER_PROCESS = 50;

    // Write worker script to temp file
    const workerPath = join(testDir, "worker.mjs");
    writeFileSync(workerPath, createWorkerScript(distPath));

    // Spawn processes with slight stagger to test race conditions
    const processPromises: Promise<{
      workerId: number;
      eventIds: string[];
    }>[] = [];

    for (let i = 0; i < PROCESS_COUNT; i++) {
      const promise = new Promise<{ workerId: number; eventIds: string[] }>(
        (resolve, reject) => {
          const child = spawn(
            "node",
            [workerPath, testDir, String(i), String(EVENTS_PER_PROCESS)],
            {
              stdio: ["ignore", "pipe", "pipe"],
              env: { ...process.env, NODE_NO_WARNINGS: "1" },
            }
          );

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (data) => {
            stdout += data.toString();
          });

          child.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          child.on("close", (code) => {
            if (code !== 0) {
              reject(new Error(`Worker ${i} exited with code ${code}: ${stderr}`));
              return;
            }

            try {
              const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
              resolve(result);
            } catch (e) {
              reject(new Error(`Failed to parse worker ${i} output: ${stdout}`));
            }
          });

          child.on("error", reject);
        }
      );

      processPromises.push(promise);
    }

    const results = await Promise.all(processPromises);

    // Collect all event IDs
    const allEventIds = results.flatMap((r) => r.eventIds);

    // Event IDs should include pid@hostname:sequence format
    // Since each process has a different pid, IDs will be unique
    for (const id of allEventIds) {
      expect(id).toMatch(/^\d+@.+:\d+$/);
    }

    // All IDs should be unique
    const uniqueIds = new Set(allEventIds);
    expect(uniqueIds.size).toBe(allEventIds.length);
  }, 30000);

  it("should not produce partial JSON lines under concurrent write load", async () => {
    // Check if dist files exist (package must be built)
    if (!existsSync(join(distPath, "AuditWriter.js"))) {
      console.log("Skipping: dist files not found. Run 'npm run build' first.");
      return;
    }

    const PROCESS_COUNT = 5;
    const EVENTS_PER_PROCESS = 20;

    // Write worker script to temp file
    const workerPath = join(testDir, "worker.mjs");
    writeFileSync(workerPath, createWorkerScript(distPath));

    // Spawn all processes simultaneously
    const processPromises: Promise<void>[] = [];

    for (let i = 0; i < PROCESS_COUNT; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        const child = spawn(
          "node",
          [workerPath, testDir, String(i), String(EVENTS_PER_PROCESS)],
          {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, NODE_NO_WARNINGS: "1" },
          }
        );

        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`Worker ${i} exited with code ${code}`));
          } else {
            resolve();
          }
        });

        child.on("error", reject);
      });

      processPromises.push(promise);
    }

    await Promise.all(processPromises);

    // Read the raw file content
    const logPath = join(testDir, "events.jsonl");
    const rawContent = readFileSync(logPath, "utf-8");

    // Split into lines
    const lines = rawContent.split("\n").filter((line) => line.length > 0);

    // Every line should be valid JSON
    let invalidLines = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        invalidLines++;
      }
    }

    expect(invalidLines).toBe(0);

    // Should have all expected events
    expect(lines.length).toBe(PROCESS_COUNT * EVENTS_PER_PROCESS);
  }, 30000);
});

describe("Multi-Process AuditWriter Direct Tests", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should handle rapid concurrent writes within single process", async () => {
    const { AuditWriter } = await import("../../src/AuditWriter.js");

    const writer = new AuditWriter({
      auditDir: testDir,
      version: "1.0.0-test",
    });

    // Fire 100 concurrent log calls
    const promises = Array.from({ length: 100 }, (_, i) =>
      writer.log("tool_call", `rapid_test_${i}`, "success", i * 10, {
        input: { index: i },
      })
    );

    const eventIds = await Promise.all(promises);

    // All should have unique IDs
    const uniqueIds = new Set(eventIds);
    expect(uniqueIds.size).toBe(100);

    // All should have sequential sequence numbers (within single process)
    const sequences = eventIds.map((id) => parseInt(id.split(":")[1], 10));
    const sortedSequences = [...sequences].sort((a, b) => a - b);

    // Sequences should be consecutive starting from 1
    for (let i = 0; i < sortedSequences.length; i++) {
      expect(sortedSequences[i]).toBe(i + 1);
    }

    // Read and verify file
    const logPath = join(testDir, "events.jsonl");
    const events = readEvents(logPath);

    expect(events.length).toBe(100);
    expect(countCorruptedEvents(events)).toBe(0);

    await writer.clearAllData();
  });
});
