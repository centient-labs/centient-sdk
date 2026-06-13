/**
 * Failure-cascade propagation over a generic DAG.
 *
 * When a node fails, every node that transitively depends on it can no longer
 * run — its inputs will never be produced. {@link propagateFailure} computes
 * that downstream cascade so a scheduler can mark the affected nodes blocked /
 * skipped instead of dispatching them. Pure computation, deterministic output.
 *
 * @module cascade
 */

import { buildAdjacency, type IdComparator } from "./graph.js";
import { type DAGNode, DAGMissingNodeError } from "./types.js";

function defaultComparator<TId extends string>(a: TId, b: TId): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Outcome of a failure cascade from one or more failed nodes. */
export interface CascadeResult<TId extends string = string> {
  /**
   * The originating failed node IDs (deduplicated, sorted). Echoed back for
   * convenience so callers can union failed + cascaded in one place.
   */
  readonly failed: ReadonlyArray<TId>;
  /**
   * All nodes that transitively depend on a failed node and are therefore
   * unreachable. Excludes the failed nodes themselves. Sorted for determinism.
   */
  readonly cascaded: ReadonlyArray<TId>;
}

/**
 * Compute all transitive dependents of a node (direct + indirect downstream).
 *
 * BFS over outgoing edges. The starting node is not included in the result.
 * Output is sorted by `compare` for reproducibility.
 *
 * @throws {DAGMissingNodeError} if `nodeId` is not in the graph.
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function transitiveDependents<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
  nodeId: TId,
  compare: IdComparator<TId> = defaultComparator,
): TId[] {
  const graph = buildAdjacency(nodes);
  if (!graph.nodes.has(nodeId)) {
    throw new DAGMissingNodeError<TId>(nodeId);
  }

  const visited = new Set<TId>();
  const queue: TId[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of graph.outEdges.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return [...visited].sort(compare);
}

/**
 * Propagate a failure cascade from one or more failed nodes.
 *
 * Returns the set of downstream nodes that become unreachable because a node
 * they (transitively) depend on failed. The failed nodes are echoed in
 * `failed`; nodes that are themselves in the failed set are never reported as
 * `cascaded`. Both lists are deduplicated and sorted.
 *
 * @param failedIds - one or more failed node IDs.
 * @throws {DAGMissingNodeError} if any failed id is not in the graph.
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function propagateFailure<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
  failedIds: TId | ReadonlyArray<TId>,
  compare: IdComparator<TId> = defaultComparator,
): CascadeResult<TId> {
  const graph = buildAdjacency(nodes);
  const failed = new Set<TId>(
    Array.isArray(failedIds) ? failedIds : [failedIds as TId],
  );

  for (const id of failed) {
    if (!graph.nodes.has(id)) {
      throw new DAGMissingNodeError<TId>(id);
    }
  }

  const cascaded = new Set<TId>();
  const queue: TId[] = [...failed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of graph.outEdges.get(current) ?? []) {
      if (failed.has(dependent) || cascaded.has(dependent)) continue;
      cascaded.add(dependent);
      queue.push(dependent);
    }
  }

  return {
    failed: [...failed].sort(compare),
    cascaded: [...cascaded].sort(compare),
  };
}
