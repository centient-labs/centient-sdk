/**
 * Unit tests for DAGEngine (ADR-021 T4).
 *
 * Covers:
 * - DAG loading and validation
 * - Cycle detection (positive and negative)
 * - Topological sort correctness
 * - Wave calculation
 * - Ready-queue resolution
 * - Edge cases: single pipeline, empty deps, diamond, complex DAG
 * - Error cases: missing deps, self-reference, invalid schema
 */

import { describe, it, expect } from "vitest";
import { DAGEngine } from "../../src/orchestrator/dag.js";
import type { Chain, PipelineStatus } from "../../src/orchestrator/types.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const STAGES = ["conceptualize", "architect", "implement", "review"];

/** Simple linear DAG: A -> B -> C */
function linearDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "a", name: "Pipeline A", stages: STAGES, dependsOn: [] as string[] },
      { id: "b", name: "Pipeline B", stages: STAGES, dependsOn: ["a"] },
      { id: "c", name: "Pipeline C", stages: STAGES, dependsOn: ["b"] },
    ],
  };
}

/** Diamond DAG: A -> B, A -> C, B -> D, C -> D */
function diamondDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "a", name: "Pipeline A", stages: STAGES, dependsOn: [] as string[] },
      { id: "b", name: "Pipeline B", stages: STAGES, dependsOn: ["a"] },
      { id: "c", name: "Pipeline C", stages: STAGES, dependsOn: ["a"] },
      { id: "d", name: "Pipeline D", stages: STAGES, dependsOn: ["b", "c"] },
    ],
  };
}

/** Parallel DAG: A, B, C (no dependencies) */
function parallelDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "a", name: "Pipeline A", stages: STAGES },
      { id: "b", name: "Pipeline B", stages: STAGES },
      { id: "c", name: "Pipeline C", stages: STAGES },
    ],
  };
}

/** Single pipeline */
function singleDAG() {
  return {
    version: 1,
    pipelines: [{ id: "solo", name: "Solo Pipeline", stages: STAGES }],
  };
}

/** Complex 4-wave DAG resembling a real orchestration */
function complexDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "w0-a", name: "Wave 0 A", stages: STAGES },
      { id: "w0-b", name: "Wave 0 B", stages: STAGES },
      { id: "w1-a", name: "Wave 1 A", stages: STAGES, dependsOn: ["w0-a"] },
      { id: "w1-b", name: "Wave 1 B", stages: STAGES, dependsOn: ["w0-a", "w0-b"] },
      { id: "w2-a", name: "Wave 2 A", stages: STAGES, dependsOn: ["w1-a", "w1-b"] },
      { id: "w3-a", name: "Wave 3 A", stages: STAGES, dependsOn: ["w2-a"] },
    ],
  };
}

function makeStatuses(
  entries: Array<[string, PipelineStatus]>,
): Map<string, PipelineStatus> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Loading & Validation
// ---------------------------------------------------------------------------

describe("DAGEngine", () => {
  describe("load", () => {
    it("loads a valid linear DAG", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(3);
      }
    });

    it("loads a valid diamond DAG", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
    });

    it("loads a valid parallel DAG", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
    });

    it("loads a single pipeline DAG", () => {
      const result = DAGEngine.load(singleDAG());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(1);
      }
    });

    it("rejects null input", () => {
      const result = DAGEngine.load(null);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
      }
    });

    it("rejects missing version", () => {
      const result = DAGEngine.load({ pipelines: [] });
      expect(result.ok).toBe(false);
    });

    it("rejects empty pipelines", () => {
      const result = DAGEngine.load({ version: 1, pipelines: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
      }
    });

    it("accepts pipeline without stages (optional field)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "a", name: "A", dependsOn: [] }],
      });
      expect(result.ok).toBe(true);
    });

    it("rejects pipeline with invalid stages type", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "a", name: "A", stages: "not-an-array" }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
        expect(result.error.message).toContain("stages");
      }
    });

    it("rejects missing dependency reference", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", name: "A", stages: STAGES, dependsOn: ["nonexistent"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_MISSING_DEPENDENCY");
        expect(result.error.message).toContain("nonexistent");
      }
    });

    it("rejects self-reference", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "a", name: "A", stages: STAGES, dependsOn: ["a"] }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
        expect(result.error.message).toContain("cannot depend on itself");
      }
    });

    it("rejects duplicate pipeline IDs", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", name: "A", stages: STAGES },
          { id: "a", name: "A2", stages: STAGES },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Duplicate");
      }
    });

    // Pipeline ID kebab-case validation
    it("accepts valid kebab-case IDs", () => {
      for (const id of ["a", "my-pipeline", "pipeline-123", "w0-a", "abc"]) {
        const result = DAGEngine.load({
          version: 1,
          pipelines: [{ id, name: id, stages: STAGES }],
        });
        expect(result.ok, `expected "${id}" to be accepted`).toBe(true);
      }
    });

    it("rejects uppercase pipeline IDs", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "My-Pipeline", name: "P", stages: STAGES }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
        expect(result.error.message).toContain("kebab-case");
      }
    });

    it("rejects IDs with special characters", () => {
      for (const id of ["my_pipeline", "my.pipeline", "my pipeline", "my@pipe"]) {
        const result = DAGEngine.load({
          version: 1,
          pipelines: [{ id, name: id, stages: STAGES }],
        });
        expect(result.ok, `expected "${id}" to be rejected`).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain("kebab-case");
        }
      }
    });

    it("rejects IDs starting or ending with hyphens", () => {
      for (const id of ["-leading", "trailing-", "-both-"]) {
        const result = DAGEngine.load({
          version: 1,
          pipelines: [{ id, name: id, stages: STAGES }],
        });
        expect(result.ok, `expected "${id}" to be rejected`).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("DAG_INVALID");
        }
      }
    });

    it("rejects IDs over 63 characters", () => {
      const longId = "a".repeat(64);
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: longId, name: "Long", stages: STAGES }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("63 character limit");
      }
    });

    it("accepts IDs exactly 63 characters", () => {
      const id63 = "a".repeat(63);
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: id63, name: "Max", stages: STAGES }],
      });
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cycle Detection
  // -------------------------------------------------------------------------

  describe("cycle detection", () => {
    it("passes acyclic graphs", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
    });

    it("detects direct cycle (A -> B -> A)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", name: "A", stages: STAGES, dependsOn: ["b"] },
          { id: "b", name: "B", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_CYCLE_DETECTED");
        expect(result.error.message).toContain("Cycle detected");
      }
    });

    it("detects indirect cycle (A -> B -> C -> A)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", name: "A", stages: STAGES, dependsOn: ["c"] },
          { id: "b", name: "B", stages: STAGES, dependsOn: ["a"] },
          { id: "c", name: "C", stages: STAGES, dependsOn: ["b"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_CYCLE_DETECTED");
      }
    });

    it("detects cycle in subgraph (isolated cycle with acyclic branch)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "root", name: "Root", stages: STAGES },
          { id: "x", name: "X", stages: STAGES, dependsOn: ["y"] },
          { id: "y", name: "Y", stages: STAGES, dependsOn: ["x"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_CYCLE_DETECTED");
      }
    });

    it("provides readable cycle error message", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "alpha", name: "Alpha", stages: STAGES, dependsOn: ["beta"] },
          { id: "beta", name: "Beta", stages: STAGES, dependsOn: ["alpha"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/Cycle detected:.*->/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Topological Sort
  // -------------------------------------------------------------------------

  describe("topological sort", () => {
    it("produces valid ordering for linear DAG", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const order = result.value.getTopologicalOrder();
      expect(order).toEqual(["a", "b", "c"]);
    });

    it("produces valid ordering for diamond DAG", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const order = result.value.getTopologicalOrder();

      // A must come before B and C; B and C must come before D
      const indexOf = (id: string) => order.indexOf(id);
      expect(indexOf("a")).toBeLessThan(indexOf("b"));
      expect(indexOf("a")).toBeLessThan(indexOf("c"));
      expect(indexOf("b")).toBeLessThan(indexOf("d"));
      expect(indexOf("c")).toBeLessThan(indexOf("d"));
    });

    it("produces deterministic ordering for parallel pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // All are wave 0 with no deps; should be sorted alphabetically
      const order = result.value.getTopologicalOrder();
      expect(order).toEqual(["a", "b", "c"]);
    });

    it("single pipeline returns that pipeline", () => {
      const result = DAGEngine.load(singleDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getTopologicalOrder()).toEqual(["solo"]);
    });

    it("respects all dependency constraints in complex DAG", () => {
      const result = DAGEngine.load(complexDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const order = result.value.getTopologicalOrder();
      const indexOf = (id: string) => order.indexOf(id);

      // Wave 0 before wave 1
      expect(indexOf("w0-a")).toBeLessThan(indexOf("w1-a"));
      expect(indexOf("w0-a")).toBeLessThan(indexOf("w1-b"));
      expect(indexOf("w0-b")).toBeLessThan(indexOf("w1-b"));

      // Wave 1 before wave 2
      expect(indexOf("w1-a")).toBeLessThan(indexOf("w2-a"));
      expect(indexOf("w1-b")).toBeLessThan(indexOf("w2-a"));

      // Wave 2 before wave 3
      expect(indexOf("w2-a")).toBeLessThan(indexOf("w3-a"));
    });
  });

  // -------------------------------------------------------------------------
  // Wave Calculation
  // -------------------------------------------------------------------------

  describe("wave calculation", () => {
    it("assigns wave 0 to independent pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getWave("a")).toBe(0);
      expect(result.value.getWave("b")).toBe(0);
      expect(result.value.getWave("c")).toBe(0);
      expect(result.value.getWaveCount()).toBe(1);
    });

    it("assigns sequential waves to linear DAG", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getWave("a")).toBe(0);
      expect(result.value.getWave("b")).toBe(1);
      expect(result.value.getWave("c")).toBe(2);
      expect(result.value.getWaveCount()).toBe(3);
    });

    it("assigns correct waves for diamond DAG", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getWave("a")).toBe(0);
      expect(result.value.getWave("b")).toBe(1);
      expect(result.value.getWave("c")).toBe(1);
      expect(result.value.getWave("d")).toBe(2);
      expect(result.value.getWaveCount()).toBe(3);
    });

    it("assigns correct waves for complex DAG", () => {
      const result = DAGEngine.load(complexDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getWave("w0-a")).toBe(0);
      expect(result.value.getWave("w0-b")).toBe(0);
      expect(result.value.getWave("w1-a")).toBe(1);
      expect(result.value.getWave("w1-b")).toBe(1);
      expect(result.value.getWave("w2-a")).toBe(2);
      expect(result.value.getWave("w3-a")).toBe(3);
      expect(result.value.getWaveCount()).toBe(4);
    });

    it("getPipelinesInWave returns correct sets", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getPipelinesInWave(0)).toEqual(["a"]);
      expect(result.value.getPipelinesInWave(1).sort()).toEqual(["b", "c"]);
      expect(result.value.getPipelinesInWave(2)).toEqual(["d"]);
    });

    it("getAllWaves returns all waves as arrays", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const waves = result.value.getAllWaves();
      expect(waves).toHaveLength(3);
      expect(waves[0]).toEqual(["a"]);
      expect(waves[1]).toEqual(["b"]);
      expect(waves[2]).toEqual(["c"]);
    });

    it("single pipeline is wave 0", () => {
      const result = DAGEngine.load(singleDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getWave("solo")).toBe(0);
      expect(result.value.getWaveCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Ready Queue (getReadyPipelines)
  // -------------------------------------------------------------------------

  describe("getReadyPipelines", () => {
    it("returns all independent pipelines when nothing is running", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "ready"],
        ["b", "ready"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready.sort()).toEqual(["a", "b", "c"]);
    });

    it("returns root nodes for linear DAG", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "ready"],
        ["b", "ready"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready).toEqual(["a"]);
    });

    it("unblocks B when A completes in linear DAG", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "complete"],
        ["b", "ready"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready).toEqual(["b"]);
    });

    it("diamond: D not ready until both B and C complete", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // B complete, C still running
      const statuses1 = makeStatuses([
        ["a", "complete"],
        ["b", "complete"],
        ["c", "running"],
        ["d", "ready"],
      ]);
      expect(result.value.getReadyPipelines(statuses1)).toEqual([]);

      // Both B and C complete
      const statuses2 = makeStatuses([
        ["a", "complete"],
        ["b", "complete"],
        ["c", "complete"],
        ["d", "ready"],
      ]);
      expect(result.value.getReadyPipelines(statuses2)).toEqual(["d"]);
    });

    it("excludes running pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "running"],
        ["b", "ready"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready.sort()).toEqual(["b", "c"]);
    });

    it("excludes blocked and failed pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "blocked"],
        ["b", "failed"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready).toEqual(["c"]);
    });

    it("excludes completed pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "complete"],
        ["b", "complete"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready).toEqual(["c"]);
    });

    it("returns empty when all are done", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "complete"],
        ["b", "complete"],
        ["c", "complete"],
      ]);

      expect(result.value.getReadyPipelines(statuses)).toEqual([]);
    });

    it("excludes skipped pipelines", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([
        ["a", "skipped"],
        ["b", "ready"],
        ["c", "ready"],
      ]);

      const ready = result.value.getReadyPipelines(statuses);
      expect(ready.sort()).toEqual(["b", "c"]);
    });

    it("returns empty for empty status map", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const statuses = makeStatuses([]);
      expect(result.value.getReadyPipelines(statuses)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Dependency Queries
  // -------------------------------------------------------------------------

  describe("dependency queries", () => {
    it("getDependencies returns direct deps", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDependencies("d")).toEqual(["b", "c"]);
      expect(result.value.getDependencies("a")).toEqual([]);
    });

    it("getDependents returns direct dependents", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDependents("a").sort()).toEqual(["b", "c"]);
      expect(result.value.getDependents("d")).toEqual([]);
    });

    it("getTransitiveDependents returns all downstream", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getTransitiveDependents("a").sort()).toEqual(["b", "c"]);
      expect(result.value.getTransitiveDependents("b")).toEqual(["c"]);
      expect(result.value.getTransitiveDependents("c")).toEqual([]);
    });

    it("getTransitiveDependents handles diamond correctly", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const transitive = result.value.getTransitiveDependents("a").sort();
      expect(transitive).toEqual(["b", "c", "d"]);
    });

    it("getDependencies returns empty for unknown pipeline", () => {
      const result = DAGEngine.load(singleDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDependencies("nonexistent")).toEqual([]);
    });

    it("getPipeline returns entry or undefined", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const entry = result.value.getPipeline("a");
      expect(entry).toBeDefined();
      expect(entry?.name).toBe("Pipeline A");
      expect(result.value.getPipeline("nope")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Chain Detection (ADR-026 D1)
  // -------------------------------------------------------------------------

  describe("getChains", () => {
    it("linear DAG A → B → C produces one chain [A, B, C]", () => {
      const result = DAGEngine.load(linearDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(1);

      const chain = chains[0]!;
      expect(chain.id).toBe("a");
      expect(chain.dagId).toBe("test-dag");
      expect(chain.pipelines).toEqual(["a", "b", "c"]);
      expect(chain.head).toBe("a");
      expect(chain.tail).toBe("c");
    });

    it("disconnected DAG [A] [B] [C] produces three single-member chains", () => {
      const result = DAGEngine.load(parallelDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(3);

      // Each chain should have exactly one member
      for (const chain of chains) {
        expect(chain.pipelines).toHaveLength(1);
        expect(chain.head).toBe(chain.tail);
        expect(chain.head).toBe(chain.id);
        expect(chain.dagId).toBe("test-dag");
      }

      // All pipelines covered, no duplicates
      const allPipelines = chains.flatMap((c: Chain) => c.pipelines).sort();
      expect(allPipelines).toEqual(["a", "b", "c"]);
    });

    it("single pipeline produces single-member chain", () => {
      const result = DAGEngine.load(singleDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(1);

      const chain = chains[0]!;
      expect(chain.id).toBe("solo");
      expect(chain.pipelines).toEqual(["solo"]);
      expect(chain.head).toBe("solo");
      expect(chain.tail).toBe("solo");
    });

    it("diamond DAG A → {B, C} → D produces 4 single-member chains", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(4);

      // Each chain should be single-member (fan-out and fan-in break chains)
      for (const chain of chains) {
        expect(chain.pipelines).toHaveLength(1);
        expect(chain.head).toBe(chain.tail);
        expect(chain.id).toBe(chain.head);
        expect(chain.dagId).toBe("test-dag");
      }

      // No pipeline in more than one chain; union = {a, b, c, d}
      const allPipelines = chains.flatMap((c: Chain) => c.pipelines).sort();
      expect(allPipelines).toEqual(["a", "b", "c", "d"]);

      // Verify no duplicates
      const uniquePipelines = new Set(allPipelines);
      expect(uniquePipelines.size).toBe(4);
    });

    it("mixed topology {A → B → C, D → E} produces two parallel chains", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
          { id: "c", stages: STAGES, dependsOn: ["b"] },
          { id: "d", stages: STAGES },
          { id: "e", stages: STAGES, dependsOn: ["d"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(2);

      // Find each chain by head
      const chainA = chains.find((c: Chain) => c.head === "a")!;
      const chainD = chains.find((c: Chain) => c.head === "d")!;
      expect(chainA).toBeDefined();
      expect(chainD).toBeDefined();

      expect(chainA.pipelines).toEqual(["a", "b", "c"]);
      expect(chainA.tail).toBe("c");

      expect(chainD.pipelines).toEqual(["d", "e"]);
      expect(chainD.tail).toBe("e");

      // All pipelines covered
      const allPipelines = chains.flatMap((c: Chain) => c.pipelines).sort();
      expect(allPipelines).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("convergence {A → B, C → B} produces 3 single-member chains", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "c", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a", "c"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains("test-dag");
      expect(chains).toHaveLength(3);

      // Convergence breaks chains: B has in-degree 2, so no chain extends to B
      // A has out-degree 1, but its dependent B has in-degree 2 — breaks chain
      for (const chain of chains) {
        expect(chain.pipelines).toHaveLength(1);
        expect(chain.head).toBe(chain.tail);
      }

      const allPipelines = chains.flatMap((c: Chain) => c.pipelines).sort();
      expect(allPipelines).toEqual(["a", "b", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // chainMode and id validation (ADR-026 D6)
  // -------------------------------------------------------------------------

  describe("chainMode and id validation", () => {
    it("loads DAG with id + chainMode: 'commit' and getChains() returns multi-member chains", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
          { id: "c", stages: STAGES, dependsOn: ["b"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const def = result.value.getDefinition();
      expect(def.id).toBe("my-dag");
      expect(def.chainMode).toBe("commit");

      // getChains uses the DAG id when no explicit dagId is passed
      const chains = result.value.getChains();
      expect(chains).toHaveLength(1);
      expect(chains[0]!.dagId).toBe("my-dag");
      expect(chains[0]!.pipelines).toEqual(["a", "b", "c"]);
    });

    it("loads DAG with chainMode: 'pr' and getChains() still works", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "pr",
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const def = result.value.getDefinition();
      expect(def.chainMode).toBe("pr");

      // getChains() still returns chain structure (engine decides behavior based on chainMode)
      const chains = result.value.getChains();
      expect(chains).toHaveLength(1);
      expect(chains[0]!.pipelines).toEqual(["a", "b"]);
    });

    it("rejects DAG with chainMode: 'commit' but no id", () => {
      const result = DAGEngine.load({
        version: 1,
        chainMode: "commit",
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
        expect(result.error.message).toContain("id is required");
        expect(result.error.message).toContain("commit");
      }
    });

    it("defaults dagId to empty string when DAG has no id", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const chains = result.value.getChains();
      expect(chains[0]!.dagId).toBe("");
    });

    it("accepts chainMode: 'pr' without id", () => {
      const result = DAGEngine.load({
        version: 1,
        chainMode: "pr",
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      });
      expect(result.ok).toBe(true);
    });

    it("accepts DAG without chainMode (backwards compatible)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      });
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // conflictStrategy validation (ADR-026 D5, Phase 3)
  // -------------------------------------------------------------------------

  describe("conflictStrategy validation", () => {
    it("accepts DAG with conflictStrategy: 'manual'", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: "manual",
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDefinition().conflictStrategy).toBe("manual");
    });

    it("accepts DAG with conflictStrategy: 'auto-rerun'", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: "auto-rerun",
        pipelines: [
          { id: "a", stages: STAGES },
          { id: "b", stages: STAGES, dependsOn: ["a"] },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDefinition().conflictStrategy).toBe("auto-rerun");
    });

    it("rejects DAG with invalid conflictStrategy", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: "invalid",
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      } as unknown as Parameters<typeof DAGEngine.load>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("DAG_INVALID");
      expect(result.error.message).toContain("conflictStrategy");
      expect(result.error.message).toContain("invalid");
      expect(result.error.component).toBe("orchestrator/types");
      expect(result.error.recovery).toContain("manual");
      expect(result.error.recovery).toContain("auto-rerun");
    });

    it("rejects DAG with conflictStrategy: null", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: null,
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      } as unknown as Parameters<typeof DAGEngine.load>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("DAG_INVALID");
    });

    it('rejects DAG with conflictStrategy: ""', () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: "",
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      } as unknown as Parameters<typeof DAGEngine.load>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("DAG_INVALID");
    });

    it("rejects DAG with conflictStrategy: 123", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: 123,
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      } as unknown as Parameters<typeof DAGEngine.load>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("DAG_INVALID");
    });

    it("rejects DAG with conflictStrategy: true", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        conflictStrategy: true,
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      } as unknown as Parameters<typeof DAGEngine.load>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("DAG_INVALID");
    });

    it("accepts DAG without conflictStrategy (backwards compatible)", () => {
      const result = DAGEngine.load({
        version: 1,
        id: "my-dag",
        chainMode: "commit",
        pipelines: [
          { id: "a", stages: STAGES },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getDefinition().conflictStrategy).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Definition Access
  // -------------------------------------------------------------------------

  describe("definition access", () => {
    it("getDefinition returns the original definition", () => {
      const dag = linearDAG();
      const result = DAGEngine.load(dag);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const def = result.value.getDefinition();
      expect(def.version).toBe(1);
      expect(def.pipelines).toHaveLength(3);
    });

    it("getPipelines returns all entries", () => {
      const result = DAGEngine.load(diamondDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.getPipelines()).toHaveLength(4);
    });

    it("size reflects pipeline count", () => {
      const result = DAGEngine.load(complexDAG());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.size).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // stageTimeoutMinutes validation
  // -------------------------------------------------------------------------

  describe("stageTimeoutMinutes validation", () => {
    it("accepts valid positive integer", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "my-pipeline", stageTimeoutMinutes: 90 }],
      });
      expect(result.ok).toBe(true);
    });

    it("accepts absence (no stageTimeoutMinutes field)", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "my-pipeline" }],
      });
      expect(result.ok).toBe(true);
    });

    it("rejects zero", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "my-pipeline", stageTimeoutMinutes: 0 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
        expect(result.error.message).toContain("positive integer");
      }
    });

    it("rejects negative value", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "my-pipeline", stageTimeoutMinutes: -10 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
      }
    });

    it("rejects float", () => {
      const result = DAGEngine.load({
        version: 1,
        pipelines: [{ id: "my-pipeline", stageTimeoutMinutes: 1.5 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DAG_INVALID");
      }
    });

    it("rejects string value", () => {
      const result = DAGEngine.load({
        version: 1,
        // @ts-expect-error testing runtime validation
        pipelines: [{ id: "my-pipeline", stageTimeoutMinutes: "90" }],
      });
      expect(result.ok).toBe(false);
    });
  });
});
