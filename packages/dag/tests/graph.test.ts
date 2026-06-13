/**
 * Behavioral baseline for the generic DAG graph core.
 *
 * Ported from the crucible orchestrator DAG suite
 * (platform/crucible .../tests/orchestrator/dag.test.ts), re-expressed against
 * the generic DAGNode<TId> API (the crucible suite tested the orchestrator-
 * specific DAGEngine + DAGDefinition validation, which is out of scope here).
 * Topologies (linear / diamond / parallel / single / complex) and the
 * cycle/topo/wave assertions are preserved 1:1; spec additions cover the
 * ordered cycle path, missing-node errors, and wide fan-out.
 */

import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  detectCycle,
  topologicalSort,
  computeWaves,
  DAGCycleError,
  DAGMissingNodeError,
  type DAGNode,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures (mirrors crucible topologies)
// ---------------------------------------------------------------------------

/** Linear: a -> b -> c */
const linear: DAGNode[] = [
  { id: "a", dependsOn: [] },
  { id: "b", dependsOn: ["a"] },
  { id: "c", dependsOn: ["b"] },
];

/** Diamond: a -> {b, c} -> d */
const diamond: DAGNode[] = [
  { id: "a", dependsOn: [] },
  { id: "b", dependsOn: ["a"] },
  { id: "c", dependsOn: ["a"] },
  { id: "d", dependsOn: ["b", "c"] },
];

/** Parallel: a, b, c (no deps) */
const parallel: DAGNode[] = [
  { id: "a", dependsOn: [] },
  { id: "b", dependsOn: [] },
  { id: "c", dependsOn: [] },
];

/** Single node */
const single: DAGNode[] = [{ id: "solo", dependsOn: [] }];

/** Complex 4-wave DAG resembling a real orchestration. */
const complex: DAGNode[] = [
  { id: "w0-a", dependsOn: [] },
  { id: "w0-b", dependsOn: [] },
  { id: "w1-a", dependsOn: ["w0-a"] },
  { id: "w1-b", dependsOn: ["w0-a", "w0-b"] },
  { id: "w2-a", dependsOn: ["w1-a", "w1-b"] },
  { id: "w3-a", dependsOn: ["w2-a"] },
];

/** Wide fan-out: one root, 50 independent dependents, one sink. */
function wideFanout(width: number): DAGNode[] {
  const leaves = Array.from({ length: width }, (_, i) => `leaf-${String(i).padStart(3, "0")}`);
  return [
    { id: "root", dependsOn: [] },
    ...leaves.map((id) => ({ id, dependsOn: ["root"] })),
    { id: "sink", dependsOn: leaves },
  ];
}

// ---------------------------------------------------------------------------
// buildAdjacency
// ---------------------------------------------------------------------------

describe("buildAdjacency", () => {
  it("records nodes, in/out edges, and in-degree", () => {
    const g = buildAdjacency(diamond);
    expect([...g.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...(g.inEdges.get("d") ?? [])].sort()).toEqual(["b", "c"]);
    expect([...(g.outEdges.get("a") ?? [])].sort()).toEqual(["b", "c"]);
    expect(g.inDegree.get("a")).toBe(0);
    expect(g.inDegree.get("d")).toBe(2);
  });

  it("throws DAGMissingNodeError for an unknown dependency", () => {
    const nodes: DAGNode[] = [{ id: "a", dependsOn: ["ghost"] }];
    expect(() => buildAdjacency(nodes)).toThrow(DAGMissingNodeError);
    try {
      buildAdjacency(nodes);
    } catch (err) {
      expect(err).toBeInstanceOf(DAGMissingNodeError);
      const e = err as DAGMissingNodeError;
      expect(e.missingId).toBe("ghost");
      expect(e.nodeId).toBe("a");
    }
  });
});

// ---------------------------------------------------------------------------
// detectCycle
// ---------------------------------------------------------------------------

describe("detectCycle", () => {
  it("passes acyclic graphs", () => {
    for (const g of [linear, diamond, parallel, single, complex]) {
      expect(detectCycle(g).hasCycle).toBe(false);
    }
  });

  it("detects a direct cycle (a -> b -> a) and returns an ordered closed path", () => {
    const nodes: DAGNode[] = [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ];
    const res = detectCycle(nodes);
    expect(res.hasCycle).toBe(true);
    if (res.hasCycle) {
      // Closed path: first === last, every consecutive pair is a real edge.
      expect(res.cycle[0]).toBe(res.cycle[res.cycle.length - 1]);
      expect(new Set(res.cycle)).toEqual(new Set(["a", "b"]));
      expect(res.cycle.length).toBe(3);
    }
  });

  it("detects an indirect cycle (a -> b -> c -> a)", () => {
    const nodes: DAGNode[] = [
      { id: "a", dependsOn: ["c"] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ];
    const res = detectCycle(nodes);
    expect(res.hasCycle).toBe(true);
    if (res.hasCycle) {
      expect(new Set(res.cycle)).toEqual(new Set(["a", "b", "c"]));
      expect(res.cycle[0]).toBe(res.cycle[res.cycle.length - 1]);
    }
  });

  it("detects a cycle in a subgraph with an acyclic branch", () => {
    const nodes: DAGNode[] = [
      { id: "root", dependsOn: [] },
      { id: "x", dependsOn: ["y"] },
      { id: "y", dependsOn: ["x"] },
    ];
    const res = detectCycle(nodes);
    expect(res.hasCycle).toBe(true);
    if (res.hasCycle) {
      expect(new Set(res.cycle)).toEqual(new Set(["x", "y"]));
    }
  });

  it("is deterministic across runs", () => {
    const nodes: DAGNode[] = [
      { id: "a", dependsOn: ["c"] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ];
    const first = detectCycle(nodes);
    const second = detectCycle(nodes);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
  it("orders a linear DAG", () => {
    expect(topologicalSort(linear)).toEqual(["a", "b", "c"]);
  });

  it("respects all constraints in a diamond DAG", () => {
    const order = topologicalSort(diamond);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("a")).toBeLessThan(idx("b"));
    expect(idx("a")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("d"));
    expect(idx("c")).toBeLessThan(idx("d"));
  });

  it("orders independent nodes deterministically (ascending)", () => {
    expect(topologicalSort(parallel)).toEqual(["a", "b", "c"]);
  });

  it("returns the single node for a single-node DAG", () => {
    expect(topologicalSort(single)).toEqual(["solo"]);
  });

  it("respects every dependency in the complex DAG", () => {
    const order = topologicalSort(complex);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("w0-a")).toBeLessThan(idx("w1-a"));
    expect(idx("w0-a")).toBeLessThan(idx("w1-b"));
    expect(idx("w0-b")).toBeLessThan(idx("w1-b"));
    expect(idx("w1-a")).toBeLessThan(idx("w2-a"));
    expect(idx("w1-b")).toBeLessThan(idx("w2-a"));
    expect(idx("w2-a")).toBeLessThan(idx("w3-a"));
  });

  it("is reproducible (stable) across repeated calls", () => {
    expect(topologicalSort(complex)).toEqual(topologicalSort(complex));
  });

  it("throws DAGCycleError with the cycle path on a cyclic graph", () => {
    const nodes: DAGNode[] = [
      { id: "alpha", dependsOn: ["beta"] },
      { id: "beta", dependsOn: ["alpha"] },
    ];
    expect(() => topologicalSort(nodes)).toThrow(DAGCycleError);
    try {
      topologicalSort(nodes);
    } catch (err) {
      expect(err).toBeInstanceOf(DAGCycleError);
      const e = err as DAGCycleError;
      expect(new Set(e.cycle)).toEqual(new Set(["alpha", "beta"]));
      expect(e.message).toMatch(/cycle detected:.*->/i);
    }
  });

  it("accepts a custom comparator (descending)", () => {
    const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
    expect(topologicalSort(parallel, desc)).toEqual(["c", "b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// computeWaves
// ---------------------------------------------------------------------------

describe("computeWaves", () => {
  it("assigns all independent nodes to wave 0", () => {
    expect(computeWaves(parallel)).toEqual([["a", "b", "c"]]);
  });

  it("assigns sequential waves to a linear DAG", () => {
    expect(computeWaves(linear)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("assigns correct waves for a diamond DAG", () => {
    expect(computeWaves(diamond)).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("assigns correct waves for the complex DAG", () => {
    expect(computeWaves(complex)).toEqual([
      ["w0-a", "w0-b"],
      ["w1-a", "w1-b"],
      ["w2-a"],
      ["w3-a"],
    ]);
  });

  it("places a single node in wave 0", () => {
    expect(computeWaves(single)).toEqual([["solo"]]);
  });

  it("uses the longest path (node after both arms of a diamond is wave 2)", () => {
    // a -> b -> d, a -> d directly. d must wait for the longest path.
    const nodes: DAGNode[] = [
      { id: "a", dependsOn: [] },
      { id: "b", dependsOn: ["a"] },
      { id: "d", dependsOn: ["a", "b"] },
    ];
    const waves = computeWaves(nodes);
    expect(waves).toEqual([["a"], ["b"], ["d"]]);
    // Validate the intermediate wave index of every node, not just the shape:
    // d sits in wave 2 (longest path a->b->d), never wave 1 (the short a->d edge).
    const waveOf = (id: string) => waves.findIndex((layer) => layer.includes(id));
    expect(waveOf("a")).toBe(0);
    expect(waveOf("b")).toBe(1);
    expect(waveOf("d")).toBe(2);
  });

  it("collapses a wide fan-out into three waves", () => {
    const waves = computeWaves(wideFanout(50));
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(["root"]);
    expect(waves[1]).toHaveLength(50);
    expect(waves[2]).toEqual(["sink"]);
    // Wave 1 is sorted.
    expect(waves[1]).toEqual([...waves[1]!].sort());
  });

  it("throws DAGCycleError on a cyclic graph", () => {
    const nodes: DAGNode[] = [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ];
    expect(() => computeWaves(nodes)).toThrow(DAGCycleError);
  });
});

// ---------------------------------------------------------------------------
// Missing-node propagation through the operations
// ---------------------------------------------------------------------------

describe("missing-node handling", () => {
  const broken: DAGNode[] = [{ id: "a", dependsOn: ["nonexistent"] }];

  it("detectCycle surfaces DAGMissingNodeError", () => {
    expect(() => detectCycle(broken)).toThrow(DAGMissingNodeError);
  });

  it("topologicalSort surfaces DAGMissingNodeError", () => {
    expect(() => topologicalSort(broken)).toThrow(DAGMissingNodeError);
  });

  it("computeWaves surfaces DAGMissingNodeError", () => {
    expect(() => computeWaves(broken)).toThrow(DAGMissingNodeError);
  });
});

// ---------------------------------------------------------------------------
// Generic TId narrowing (compile-time + runtime smoke)
// ---------------------------------------------------------------------------

describe("generic TId", () => {
  it("narrows to a string-literal union", () => {
    type Stage = "build" | "test" | "deploy";
    const nodes: DAGNode<Stage>[] = [
      { id: "build", dependsOn: [] },
      { id: "test", dependsOn: ["build"] },
      { id: "deploy", dependsOn: ["test"] },
    ];
    const order: Stage[] = topologicalSort(nodes);
    expect(order).toEqual(["build", "test", "deploy"]);
  });
});
