/**
 * @centient/dag — generic DAG scheduling core.
 *
 * Standalone, zero-dependency primitives over {@link DAGNode}<TId>:
 * adjacency building, cycle detection (ordered cycle path), topological sort,
 * parallel-wave computation, and failure-cascade propagation. No assumptions
 * about node payloads; deterministic, reproducible output.
 *
 * @packageDocumentation
 */

export {
  buildAdjacency,
  detectCycle,
  topologicalSort,
  computeWaves,
  type IdComparator,
} from "./graph.js";

export {
  propagateFailure,
  transitiveDependents,
  type CascadeResult,
} from "./cascade.js";

export {
  DAGCycleError,
  DAGMissingNodeError,
  type DAGNode,
  type AdjacencyGraph,
  type CycleDetectionResult,
} from "./types.js";
