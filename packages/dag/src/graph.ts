/**
 * Generic DAG graph algorithms — pure computation, no I/O.
 *
 * - {@link buildAdjacency}: in/out edges + in-degree from a node list.
 * - {@link detectCycle}: DFS three-colour marking, returns the ordered cycle path.
 * - {@link topologicalSort}: Kahn's algorithm with deterministic (stable) tie-break.
 * - {@link computeWaves}: parallelizable layers (longest-path level assignment).
 *
 * Determinism: every operation that emits node IDs sorts ties with a single,
 * caller-overridable comparator (default: ascending Unicode-codepoint order via
 * `<`/`>` so output never depends on Map/Set insertion order). No `Date.now()`
 * or `Math.random()` anywhere.
 *
 * @module graph
 */

import {
  type AdjacencyGraph,
  type CycleDetectionResult,
  type DAGNode,
  DAGCycleError,
  DAGMissingNodeError,
} from "./types.js";
import { defaultComparator, type IdComparator } from "./compare.js";

// Re-exported so the public surface (graph.ts) keeps exposing IdComparator.
export type { IdComparator };

/**
 * Build the adjacency representation (in/out edges + in-degree).
 *
 * Validates that every `dependsOn` id refers to a declared node and throws
 * {@link DAGMissingNodeError} otherwise. A node listed only as a dependency
 * (never declared) is a missing-dependency error, not a silent phantom node —
 * the no-silent-degradation principle.
 *
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function buildAdjacency<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
): AdjacencyGraph<TId> {
  const nodeSet = new Set<TId>();
  const inEdges = new Map<TId, Set<TId>>();
  const outEdges = new Map<TId, Set<TId>>();

  for (const node of nodes) {
    nodeSet.add(node.id);
    if (!inEdges.has(node.id)) inEdges.set(node.id, new Set());
    if (!outEdges.has(node.id)) outEdges.set(node.id, new Set());
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeSet.has(dep)) {
        throw new DAGMissingNodeError<TId>(dep, node.id);
      }
      inEdges.get(node.id)!.add(dep);
      outEdges.get(dep)!.add(node.id);
    }
  }

  const inDegree = new Map<TId, number>();
  for (const id of nodeSet) {
    inDegree.set(id, inEdges.get(id)!.size);
  }

  return { nodes: nodeSet, inEdges, outEdges, inDegree };
}

/**
 * Detect a cycle using DFS with three-colour marking (white/gray/black).
 *
 * Returns `{ hasCycle: false }` for an acyclic graph, or
 * `{ hasCycle: true, cycle }` with the cycle as an ordered, closed path
 * (first and last element identical), e.g. `["a", "b", "a"]`.
 *
 * Ported from the crucible original, which returns the real cycle *path*.
 * The pipeline-sdk copy returned only the unordered set of cycle-participating
 * nodes via Kahn's algorithm — this restores the more useful path (and is the
 * behaviour the spec calls for: "the cycle path in the error").
 *
 * Roots and neighbours are visited in deterministic (sorted) order so the
 * representative cycle is reproducible across runs.
 *
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function detectCycle<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
  compare: IdComparator<TId> = defaultComparator,
): CycleDetectionResult<TId> {
  const graph = buildAdjacency(nodes);
  type Color = 0 | 1 | 2; // 0 white, 1 gray, 2 black
  const color = new Map<TId, Color>();
  const parent = new Map<TId, TId | undefined>();
  for (const id of graph.nodes) color.set(id, 0);

  const sortedRoots = [...graph.nodes].sort(compare);

  // Iterative DFS to avoid stack overflow on deep graphs.
  for (const root of sortedRoots) {
    if (color.get(root) !== 0) continue;

    // Stack frames carry the node and its not-yet-visited neighbour iterator.
    const stack: Array<{ node: TId; neighbors: TId[]; index: number }> = [];
    color.set(root, 1);
    parent.set(root, undefined);
    stack.push({
      node: root,
      neighbors: [...(graph.outEdges.get(root) ?? [])].sort(compare),
      index: 0,
    });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.index < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.index]!;
        frame.index += 1;
        const c = color.get(neighbor);
        if (c === 1) {
          // Back-edge frame.node -> neighbor: reconstruct the cycle path.
          return { hasCycle: true, cycle: reconstructCycle(frame.node, neighbor, parent) };
        }
        if (c === 0) {
          color.set(neighbor, 1);
          parent.set(neighbor, frame.node);
          stack.push({
            node: neighbor,
            neighbors: [...(graph.outEdges.get(neighbor) ?? [])].sort(compare),
            index: 0,
          });
        }
      } else {
        color.set(frame.node, 2);
        stack.pop();
      }
    }
  }

  return { hasCycle: false };
}

/**
 * Reconstruct an ordered closed cycle path from a DFS parent chain.
 *
 * A back-edge `from -> to` was found with `to` gray (on the active DFS path).
 * Walk back from `from` via `parent` until reaching `to`, then close the loop.
 * Result reads root-most first and repeats `to` at the end, e.g. `["a","b","a"]`.
 */
function reconstructCycle<TId extends string>(
  from: TId,
  to: TId,
  parent: ReadonlyMap<TId, TId | undefined>,
): TId[] {
  const path: TId[] = [from];
  let current: TId | undefined = from;
  let closed = from === to;
  while (current !== to) {
    current = parent.get(current);
    if (current === undefined) break;
    path.push(current);
    if (current === to) {
      closed = true;
      break;
    }
  }
  // A back-edge `from -> to` means `to` is gray (on the active DFS path) and is
  // therefore an ancestor of `from` reachable via `parent`. If the walk did not
  // reach `to` the parent map is corrupted — returning a path that does not
  // close would silently emit a wrong cycle (no-silent-degradation, P-no-silent).
  if (!closed) {
    throw new Error(
      `DAG cycle reconstruction failed: no parent path from "${from}" back to "${to}" (corrupted parent map)`,
    );
  }
  path.reverse();
  path.push(to); // close the loop: [...to..from, to]
  return path;
}

/**
 * Topological sort via Kahn's algorithm.
 *
 * Among nodes that become ready simultaneously, ties break by `compare`
 * (default ascending codepoint order) so output is deterministic.
 *
 * @throws {DAGCycleError} if the graph contains a cycle (carries the cycle path).
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function topologicalSort<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
  compare: IdComparator<TId> = defaultComparator,
): TId[] {
  const cycle = detectCycle(nodes, compare);
  if (cycle.hasCycle) throw new DAGCycleError(cycle.cycle);

  const graph = buildAdjacency(nodes);
  const inDegree = new Map<TId, number>(graph.inDegree);

  // A sorted array acting as a priority queue keeps peer ordering stable.
  const ready: TId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }
  ready.sort(compare);

  const result: TId[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    result.push(current);

    const newlyFree: TId[] = [];
    for (const dependent of graph.outEdges.get(current) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) newlyFree.push(dependent);
    }
    if (newlyFree.length > 0) {
      newlyFree.sort(compare);
      ready.push(...newlyFree);
      ready.sort(compare);
    }
  }

  return result;
}

/**
 * Compute parallel-execution waves (parallelizable layers).
 *
 * Wave 0 holds nodes with no dependencies. A node is placed in wave
 * `1 + max(wave of its dependencies)` — the longest-path distance from any
 * root. Every node within a wave is mutually independent, so a scheduler may
 * run a whole wave concurrently. Each wave is sorted by `compare` for
 * reproducible output.
 *
 * @throws {DAGCycleError} if the graph contains a cycle (carries the cycle path).
 * @throws {DAGMissingNodeError} when a dependency references an unknown node.
 */
export function computeWaves<TId extends string>(
  nodes: ReadonlyArray<DAGNode<TId>>,
  compare: IdComparator<TId> = defaultComparator,
): TId[][] {
  const cycle = detectCycle(nodes, compare);
  if (cycle.hasCycle) throw new DAGCycleError(cycle.cycle);

  const graph = buildAdjacency(nodes);
  const inDegree = new Map<TId, number>(graph.inDegree);
  const wave = new Map<TId, number>();

  const queue: TId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      wave.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentWave = wave.get(current) ?? 0;
    for (const dependent of graph.outEdges.get(current) ?? []) {
      const candidate = currentWave + 1;
      if (candidate > (wave.get(dependent) ?? -1)) {
        wave.set(dependent, candidate);
      }
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  let maxWave = -1;
  for (const w of wave.values()) {
    if (w > maxWave) maxWave = w;
  }

  const waves: TId[][] = Array.from({ length: maxWave + 1 }, () => []);
  for (const [id, w] of wave) {
    waves[w]!.push(id);
  }
  for (const layer of waves) layer.sort(compare);
  return waves;
}
