/**
 * Generic DAG scheduling core — shared types and typed errors.
 *
 * A {@link DAGNode} carries only an `id` and its `dependsOn` edge list. The
 * core makes no assumptions about node payloads: callers attach domain data
 * out of band (e.g. a `Map<TId, Payload>` keyed by node id).
 *
 * `TId` is generic over any string union so callers get exhaustive,
 * type-checked node identifiers.
 *
 * @module types
 */

/** A single node in a directed acyclic graph. */
export interface DAGNode<TId extends string = string> {
  /** Unique node identifier. */
  readonly id: TId;
  /** IDs this node depends on (incoming edges). Must complete before this node. */
  readonly dependsOn: ReadonlyArray<TId>;
}

/**
 * Adjacency representation produced by {@link buildAdjacency}.
 *
 * Edge direction: `dep -> node` (a dependency must complete before its
 * dependent). `outEdges` maps a node to the nodes that depend on it;
 * `inEdges` maps a node to the nodes it depends on.
 */
export interface AdjacencyGraph<TId extends string = string> {
  /** All node IDs in the graph. */
  readonly nodes: ReadonlySet<TId>;
  /** node -> set of IDs it depends on (incoming edges). */
  readonly inEdges: ReadonlyMap<TId, ReadonlySet<TId>>;
  /** node -> set of IDs that depend on it (outgoing edges). */
  readonly outEdges: ReadonlyMap<TId, ReadonlySet<TId>>;
  /** node -> number of incoming edges (its dependency count). */
  readonly inDegree: ReadonlyMap<TId, number>;
}

/** Result of {@link detectCycle}. */
export type CycleDetectionResult<TId extends string = string> =
  | { readonly hasCycle: false }
  | {
      readonly hasCycle: true;
      /**
       * The cycle as an ordered, closed path, e.g. `["a", "b", "a"]`.
       * The first and last elements are the same node.
       */
      readonly cycle: ReadonlyArray<TId>;
    };

/**
 * Thrown when a DAG operation that requires acyclicity (topological sort,
 * wave computation) encounters a cycle. Carries the ordered cycle path so
 * callers can render or programmatically inspect it.
 */
export class DAGCycleError<TId extends string = string> extends Error {
  override readonly name = "DAGCycleError";
  /** Ordered, closed cycle path, e.g. `["a", "b", "a"]`. */
  readonly cycle: ReadonlyArray<TId>;

  constructor(cycle: ReadonlyArray<TId>) {
    super(`DAG cycle detected: ${cycle.join(" -> ")}`);
    this.cycle = cycle;
    // Pin the prototype so `instanceof` holds even when a downstream consumer
    // re-transpiles this package to an ES5/ES2015 target (where `extends Error`
    // loses the subclass prototype). At our own ES2022 target this is a no-op;
    // it is a zero-cost safety net for down-level bundling, not a workaround for
    // a bug at this target.
    Object.setPrototypeOf(this, DAGCycleError.prototype);
  }
}

/**
 * Thrown when a node references a dependency (or a cascade/query targets a
 * node) that does not exist in the graph. Carries both the referencing node
 * and the missing id.
 */
export class DAGMissingNodeError<TId extends string = string> extends Error {
  override readonly name = "DAGMissingNodeError";
  /** The node that referenced the missing id, if applicable. */
  readonly nodeId: TId | undefined;
  /** The id that was referenced but not found in the graph. */
  readonly missingId: TId;

  constructor(missingId: TId, nodeId?: TId) {
    super(
      nodeId === undefined
        ? `DAG references unknown node: ${missingId}`
        : `DAG node "${nodeId}" depends on unknown node: ${missingId}`,
    );
    this.nodeId = nodeId;
    this.missingId = missingId;
    // See DAGCycleError: pins the prototype for down-level (ES5/ES2015)
    // re-transpilation so `instanceof` survives. No-op at our ES2022 target.
    Object.setPrototypeOf(this, DAGMissingNodeError.prototype);
  }
}
