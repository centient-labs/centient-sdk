/**
 * Failure-cascade propagation tests.
 *
 * The transitiveDependents traversal mirrors the crucible
 * getTransitiveDependents behaviour (the failure-cascade primitive the
 * orchestrator builds its skip logic on); propagateFailure wraps it into the
 * multi-root cascade the spec calls for.
 */

import { describe, it, expect } from "vitest";
import {
  propagateFailure,
  transitiveDependents,
  DAGMissingNodeError,
  type DAGNode,
} from "../src/index.js";

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

describe("transitiveDependents", () => {
  it("returns all downstream nodes in a linear DAG", () => {
    expect(transitiveDependents(linear, "a")).toEqual(["b", "c"]);
    expect(transitiveDependents(linear, "b")).toEqual(["c"]);
    expect(transitiveDependents(linear, "c")).toEqual([]);
  });

  it("returns the full downstream set in a diamond DAG", () => {
    expect(transitiveDependents(diamond, "a")).toEqual(["b", "c", "d"]);
    expect(transitiveDependents(diamond, "b")).toEqual(["d"]);
    expect(transitiveDependents(diamond, "d")).toEqual([]);
  });

  it("throws DAGMissingNodeError for an unknown node", () => {
    expect(() => transitiveDependents(linear, "ghost")).toThrow(DAGMissingNodeError);
  });
});

describe("propagateFailure", () => {
  it("cascades a single failure through a linear chain", () => {
    const res = propagateFailure(linear, "a");
    expect(res.failed).toEqual(["a"]);
    expect(res.cascaded).toEqual(["b", "c"]);
  });

  it("a mid-chain failure cascades only downstream, not upstream", () => {
    const res = propagateFailure(linear, "b");
    expect(res.failed).toEqual(["b"]);
    expect(res.cascaded).toEqual(["c"]);
  });

  it("a leaf failure cascades to nothing", () => {
    const res = propagateFailure(linear, "c");
    expect(res.failed).toEqual(["c"]);
    expect(res.cascaded).toEqual([]);
  });

  it("a root failure in a diamond cascades to every dependent", () => {
    const res = propagateFailure(diamond, "a");
    expect(res.failed).toEqual(["a"]);
    expect(res.cascaded).toEqual(["b", "c", "d"]);
  });

  it("one arm of a diamond failing still cascades to the sink", () => {
    // d depends on both b and c; b failing makes d unreachable.
    const res = propagateFailure(diamond, "b");
    expect(res.failed).toEqual(["b"]);
    expect(res.cascaded).toEqual(["d"]);
  });

  it("accepts multiple failed nodes and deduplicates the cascade", () => {
    const res = propagateFailure(diamond, ["b", "c"]);
    expect(res.failed).toEqual(["b", "c"]);
    // d appears once even though it is downstream of both b and c.
    expect(res.cascaded).toEqual(["d"]);
  });

  it("never reports a failed node as cascaded", () => {
    // a and b both fail; b is downstream of a but is itself failed.
    const res = propagateFailure(linear, ["a", "b"]);
    expect(res.failed).toEqual(["a", "b"]);
    expect(res.cascaded).toEqual(["c"]);
  });

  it("wide fan-out: failing the root cascades to every leaf and the sink", () => {
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf-${String(i).padStart(2, "0")}`);
    const nodes: DAGNode[] = [
      { id: "root", dependsOn: [] },
      ...leaves.map((id) => ({ id, dependsOn: ["root"] })),
      { id: "sink", dependsOn: leaves },
    ];
    const res = propagateFailure(nodes, "root");
    expect(res.cascaded).toEqual([...leaves, "sink"].sort());
  });

  it("throws DAGMissingNodeError when a failed id is unknown", () => {
    expect(() => propagateFailure(linear, "ghost")).toThrow(DAGMissingNodeError);
  });

  it("is deterministic and sorted", () => {
    const res = propagateFailure(diamond, "a");
    expect(res.cascaded).toEqual([...res.cascaded].sort());
    expect(propagateFailure(diamond, "a")).toEqual(res);
  });
});
