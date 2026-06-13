/**
 * DAG Engine (ADR-021 Decision 1, 10)
 *
 * Loads, validates, and processes Directed Acyclic Graph definitions for
 * multi-pipeline orchestration. Provides:
 *
 * - Cycle detection via DFS (white/gray/black coloring)
 * - Topological sort via Kahn's algorithm
 * - Wave calculation (groups pipelines by execution wave)
 * - Ready-queue resolution (pipelines whose deps are all satisfied)
 *
 * Pure computation -- no I/O. DAG JSON is passed in as a parsed object.
 *
 * @module orchestrator/dag
 */

import type {
  Chain,
  DAGDefinition,
  DAGPipelineEntry,
  OrchestratorError,
  PipelineStatus,
  Result,
} from "./types.js";
import { validateDAGDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Adjacency representation for internal graph operations. */
interface AdjacencyGraph {
  /** Map from pipeline ID to set of IDs it depends on (incoming edges). */
  inEdges: Map<string, Set<string>>;
  /** Map from pipeline ID to set of IDs that depend on it (outgoing edges). */
  outEdges: Map<string, Set<string>>;
  /** All pipeline IDs in the graph. */
  nodes: Set<string>;
}

/** DFS node coloring for cycle detection. */
type NodeColor = "white" | "gray" | "black";

// ---------------------------------------------------------------------------
// DAGEngine
// ---------------------------------------------------------------------------

export class DAGEngine {
  private readonly definition: DAGDefinition;
  private readonly graph: AdjacencyGraph;
  private readonly pipelineMap: Map<string, DAGPipelineEntry>;
  private readonly sortedOrder: string[];
  private readonly waves: Map<string, number>;

  private constructor(
    definition: DAGDefinition,
    graph: AdjacencyGraph,
    pipelineMap: Map<string, DAGPipelineEntry>,
    sortedOrder: string[],
    waves: Map<string, number>,
  ) {
    this.definition = definition;
    this.graph = graph;
    this.pipelineMap = pipelineMap;
    this.sortedOrder = sortedOrder;
    this.waves = waves;
  }

  /**
   * Load and validate a DAG definition, then build the engine.
   *
   * Performs full validation: schema, cycle detection, topological sort,
   * and wave calculation. Returns a ready-to-use DAGEngine or an error.
   */
  static load(input: unknown): Result<DAGEngine, OrchestratorError> {
    // 1. Schema validation (delegates to types.ts)
    const validated = validateDAGDefinition(input);
    if (!validated.ok) {
      return validated;
    }
    const definition = validated.value;

    // 2. Build adjacency graph
    const pipelineMap = new Map<string, DAGPipelineEntry>();
    for (const entry of definition.pipelines) {
      pipelineMap.set(entry.id, entry);
    }

    const graph = buildAdjacencyGraph(definition.pipelines);

    // 3. Cycle detection
    const cycleResult = detectCycle(graph);
    if (cycleResult !== null) {
      return {
        ok: false,
        error: {
          code: "DAG_CYCLE_DETECTED",
          message: `Cycle detected: ${cycleResult.join(" -> ")}`,
          component: "orchestrator/dag",
          recovery: "Remove circular dependencies from the DAG definition",
        },
      };
    }

    // 4. Topological sort
    const sortResult = topologicalSort(graph);
    if (!sortResult.ok) {
      return sortResult;
    }

    // 5. Wave calculation
    const waves = calculateWaves(graph);

    return {
      ok: true,
      value: new DAGEngine(definition, graph, pipelineMap, sortResult.value, waves),
    };
  }

  /** The validated DAG definition. */
  getDefinition(): DAGDefinition {
    return this.definition;
  }

  /** All pipeline entries in the DAG. */
  getPipelines(): readonly DAGPipelineEntry[] {
    return this.definition.pipelines;
  }

  /** Get a pipeline entry by ID. */
  getPipeline(id: string): DAGPipelineEntry | undefined {
    return this.pipelineMap.get(id);
  }

  /** All pipeline IDs in topological order. */
  getTopologicalOrder(): readonly string[] {
    return this.sortedOrder;
  }

  /** Get the wave number for a pipeline. */
  getWave(pipelineId: string): number | undefined {
    return this.waves.get(pipelineId);
  }

  /** Total number of execution waves. */
  getWaveCount(): number {
    if (this.waves.size === 0) return 0;
    let max = 0;
    for (const wave of this.waves.values()) {
      if (wave > max) max = wave;
    }
    return max + 1;
  }

  /** Get all pipeline IDs in a specific wave. */
  getPipelinesInWave(wave: number): string[] {
    const result: string[] = [];
    for (const [id, w] of this.waves) {
      if (w === wave) result.push(id);
    }
    return result;
  }

  /** Get all waves as an array of arrays (wave index -> pipeline IDs). */
  getAllWaves(): string[][] {
    const waveCount = this.getWaveCount();
    const result: string[][] = [];
    for (let i = 0; i < waveCount; i++) {
      result.push(this.getPipelinesInWave(i));
    }
    return result;
  }

  /** Get direct dependencies of a pipeline. */
  getDependencies(pipelineId: string): readonly string[] {
    const entry = this.pipelineMap.get(pipelineId);
    return entry?.dependsOn ?? [];
  }

  /** Get direct dependents of a pipeline (pipelines that depend on it). */
  getDependents(pipelineId: string): string[] {
    const out = this.graph.outEdges.get(pipelineId);
    return out ? [...out] : [];
  }

  /**
   * Identify linear chains in the DAG (ADR-026 D1).
   *
   * A chain is a maximal sequence of pipeline nodes where each node
   * (except the head) has exactly one predecessor with exactly one successor.
   * Fan-out and convergence points break chains.
   *
   * Every pipeline belongs to exactly one chain. Single-pipeline chains
   * are valid (pipelines at fan-out/convergence points, or isolated nodes).
   *
   * @param dagId - DAG identifier for the Chain.dagId field. Falls back to
   *   DAGDefinition.id or empty string if neither is set.
   * @returns Deterministic Chain[] — same DAG always produces same chains.
   */
  getChains(dagId?: string): Chain[] {
    const effectiveDagId = dagId ?? this.definition.id ?? "";
    const assigned = new Set<string>();
    const chains: Chain[] = [];

    // Traverse in topological order for determinism
    for (const nodeId of this.sortedOrder) {
      if (assigned.has(nodeId)) continue;

      // Start a new chain with this node as head
      const members: string[] = [nodeId];
      assigned.add(nodeId);

      // Extend forward: follow the single outgoing edge if conditions met.
      // Per-pipeline chainMode: "pr" overrides break the chain — a PR-mode
      // pipeline cannot extend or be extended by a commit chain (ADR-026 D6).
      let current = nodeId;
      const headEntry = this.pipelineMap.get(nodeId);
      const headIsPr = headEntry?.chainMode === "pr";

      // If the head itself is PR-mode, don't try to extend at all
      if (!headIsPr) {
        while (true) {
          const outEdges = this.graph.outEdges.get(current);
          // Current node must have exactly 1 dependent
          if (!outEdges || outEdges.size !== 1) break;

          const next = [...outEdges][0]!;
          // Next node must have exactly 1 dependency
          const inEdges = this.graph.inEdges.get(next);
          if (!inEdges || inEdges.size !== 1) break;

          // Next must not already be assigned (safety check)
          if (assigned.has(next)) break;

          // Per-pipeline chainMode: "pr" breaks the chain
          const nextEntry = this.pipelineMap.get(next);
          if (nextEntry?.chainMode === "pr") break;

          members.push(next);
          assigned.add(next);
          current = next;
        }
      }

      chains.push({
        id: members[0]!,
        dagId: effectiveDagId,
        pipelines: members,
        head: members[0]!,
        tail: members[members.length - 1]!,
      });
    }

    return chains;
  }

  /**
   * Get the chain that contains a specific pipeline.
   *
   * Returns undefined if the pipeline is not in the DAG.
   */
  getChainForPipeline(pipelineId: string, dagId?: string): Chain | undefined {
    const chains = this.getChains(dagId);
    return chains.find((c) => c.pipelines.includes(pipelineId));
  }

  /**
   * Get all transitive dependents of a pipeline (direct + indirect).
   *
   * Uses BFS from the given pipeline following outgoing edges.
   */
  getTransitiveDependents(pipelineId: string): string[] {
    const visited = new Set<string>();
    const queue = [pipelineId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.graph.outEdges.get(current);
      if (!dependents) continue;

      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    return [...visited];
  }

  /**
   * Get pipelines ready to execute.
   *
   * A pipeline is "ready" when:
   * - Its status is "ready"
   * - All its dependencies are in the `completed` set
   * - It is not in the `running`, `blocked`, `failed`, or `skipped` sets
   *
   * @param statuses - Map of pipeline ID to current status
   * @returns Array of pipeline IDs ready to start
   */
  getReadyPipelines(
    statuses: ReadonlyMap<string, PipelineStatus>,
  ): string[] {
    const ready: string[] = [];

    for (const id of this.graph.nodes) {
      const status = statuses.get(id);
      if (status !== "ready") continue;

      const entry = this.pipelineMap.get(id);
      const deps = entry?.dependsOn ?? [];
      const allDepsComplete = deps.every(
        (dep) => statuses.get(dep) === "complete",
      );

      if (allDepsComplete) {
        ready.push(id);
      }
    }

    return ready;
  }

  /** Total number of pipelines in the DAG. */
  get size(): number {
    return this.graph.nodes.size;
  }
}

// ---------------------------------------------------------------------------
// Internal: Adjacency Graph Construction
// ---------------------------------------------------------------------------

function buildAdjacencyGraph(pipelines: DAGPipelineEntry[]): AdjacencyGraph {
  const nodes = new Set<string>();
  const inEdges = new Map<string, Set<string>>();
  const outEdges = new Map<string, Set<string>>();

  for (const p of pipelines) {
    nodes.add(p.id);
    if (!inEdges.has(p.id)) inEdges.set(p.id, new Set());
    if (!outEdges.has(p.id)) outEdges.set(p.id, new Set());
  }

  for (const p of pipelines) {
    for (const dep of p.dependsOn ?? []) {
      inEdges.get(p.id)!.add(dep);
      outEdges.get(dep)!.add(p.id);
    }
  }

  return { nodes, inEdges, outEdges };
}

// ---------------------------------------------------------------------------
// Internal: Cycle Detection (DFS white/gray/black)
// ---------------------------------------------------------------------------

/**
 * Detect cycles using DFS with three-color marking.
 *
 * - White: unvisited
 * - Gray: currently in the DFS stack (being explored)
 * - Black: fully explored
 *
 * If we encounter a gray node during DFS, a cycle exists.
 *
 * @returns The cycle path (array of IDs) if a cycle exists, null otherwise.
 */
function detectCycle(graph: AdjacencyGraph): string[] | null {
  const color = new Map<string, NodeColor>();
  const parent = new Map<string, string | null>();

  for (const node of graph.nodes) {
    color.set(node, "white");
  }

  for (const node of graph.nodes) {
    if (color.get(node) === "white") {
      const cycle = dfsVisit(node, graph, color, parent);
      if (cycle !== null) return cycle;
    }
  }

  return null;
}

function dfsVisit(
  node: string,
  graph: AdjacencyGraph,
  color: Map<string, NodeColor>,
  parent: Map<string, string | null>,
): string[] | null {
  color.set(node, "gray");

  const neighbors = graph.outEdges.get(node);
  if (neighbors) {
    for (const neighbor of neighbors) {
      if (color.get(neighbor) === "gray") {
        // Found a cycle -- reconstruct the path
        return reconstructCycle(node, neighbor, parent);
      }

      if (color.get(neighbor) === "white") {
        parent.set(neighbor, node);
        const cycle = dfsVisit(neighbor, graph, color, parent);
        if (cycle !== null) return cycle;
      }
    }
  }

  color.set(node, "black");
  return null;
}

/**
 * Reconstruct cycle path from DFS parent chain.
 *
 * We found an edge from `from` to `to` where `to` is gray (in the current
 * DFS path). Walk back from `from` via `parent` until we reach `to`.
 */
function reconstructCycle(
  from: string,
  to: string,
  parent: Map<string, string | null>,
): string[] {
  const path: string[] = [to, from];
  let current = from;

  while (current !== to) {
    const p = parent.get(current);
    if (p === null || p === undefined) break;
    path.push(p);
    current = p;
  }

  path.reverse();
  return path;
}

// ---------------------------------------------------------------------------
// Internal: Topological Sort (Kahn's Algorithm)
// ---------------------------------------------------------------------------

/**
 * Produce a topological ordering using Kahn's algorithm.
 *
 * Repeatedly removes nodes with zero in-degree. If all nodes are removed,
 * the result is a valid topological order. If not, a cycle exists (should
 * already be caught by detectCycle, but this is a safety net).
 */
function topologicalSort(
  graph: AdjacencyGraph,
): Result<string[], OrchestratorError> {
  // Working copy of in-degree counts
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node, graph.inEdges.get(node)?.size ?? 0);
  }

  // Seed queue with zero in-degree nodes
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  // Sort for deterministic ordering among peers
  queue.sort();

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    const dependents = graph.outEdges.get(node);
    if (dependents) {
      // Collect newly freed nodes, then sort for determinism
      const newlyFree: string[] = [];
      for (const dep of dependents) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          newlyFree.push(dep);
        }
      }
      newlyFree.sort();
      queue.push(...newlyFree);
    }
  }

  if (sorted.length !== graph.nodes.size) {
    return {
      ok: false,
      error: {
        code: "DAG_CYCLE_DETECTED",
        message: `Topological sort failed: ${graph.nodes.size - sorted.length} nodes remain (cycle detected)`,
        component: "orchestrator/dag",
        recovery: "Remove circular dependencies from the DAG definition",
      },
    };
  }

  return { ok: true, value: sorted };
}

// ---------------------------------------------------------------------------
// Internal: Wave Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate execution waves.
 *
 * Wave 0: pipelines with no dependencies.
 * Wave N: pipelines whose max dependency wave is N-1.
 *
 * This is the longest-path distance from any root node.
 */
function calculateWaves(graph: AdjacencyGraph): Map<string, number> {
  const waves = new Map<string, number>();

  // Working copy of in-degrees
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node, graph.inEdges.get(node)?.size ?? 0);
  }

  // Seed with wave 0 (no dependencies)
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      waves.set(node, 0);
      queue.push(node);
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeWave = waves.get(node) ?? 0;
    const dependents = graph.outEdges.get(node);

    if (dependents) {
      for (const dep of dependents) {
        // Wave = max(current wave assignment, parent wave + 1)
        const currentWave = waves.get(dep) ?? 0;
        const candidateWave = nodeWave + 1;
        if (candidateWave > currentWave) {
          waves.set(dep, candidateWave);
        }

        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          queue.push(dep);
        }
      }
    }
  }

  return waves;
}
