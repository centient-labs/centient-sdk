# @centient/dag

Generic directed-acyclic-graph scheduling core. Pure computation, zero runtime
dependencies. Operates over `DAGNode<TId>` — an `id` plus a `dependsOn` edge
list — and makes **no assumptions about node payloads**: callers keep their
domain data out of band (e.g. a `Map<TId, Payload>` keyed by node id).

Provides the primitives a scheduler needs:

- **Adjacency building** — in/out edges + in-degree, with missing-dependency validation.
- **Cycle detection** — DFS three-colour marking that returns the **ordered cycle path**.
- **Topological sort** — Kahn's algorithm with deterministic tie-breaking.
- **Wave computation** — parallelizable layers (longest-path level assignment).
- **Failure-cascade propagation** — downstream nodes that become unreachable when a node fails.

## Installation

```bash
npm install @centient/dag
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/dag --workspace
```

## Quick Start

```typescript
import {
  topologicalSort,
  computeWaves,
  propagateFailure,
  detectCycle,
  type DAGNode,
} from "@centient/dag";

// TId narrows to your own string-literal union — fully type-checked.
type Stage = "build" | "test" | "lint" | "deploy";

const nodes: DAGNode<Stage>[] = [
  { id: "build", dependsOn: [] },
  { id: "test", dependsOn: ["build"] },
  { id: "lint", dependsOn: ["build"] },
  { id: "deploy", dependsOn: ["test", "lint"] },
];

topologicalSort(nodes);
// → ["build", "lint", "test", "deploy"]

computeWaves(nodes);
// → [["build"], ["lint", "test"], ["deploy"]]
//   each inner array can run concurrently

propagateFailure(nodes, "build");
// → { failed: ["build"], cascaded: ["deploy", "lint", "test"] }
```

## Determinism

Every operation that emits node IDs is **reproducible**. Ties (independent
nodes, peers within a wave) break with a single comparator — ascending Unicode
codepoint order by default — so output never depends on `Map`/`Set` insertion
order. Pass a custom `IdComparator<TId>` to any function to override the order.
There is no `Date.now()` or `Math.random()` anywhere in the package.

```typescript
const descending = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
topologicalSort(nodes, descending);
```

## API

### Graph algorithms

| Function | Returns | Notes |
|----------|---------|-------|
| `buildAdjacency(nodes)` | `AdjacencyGraph<TId>` | in/out edges + in-degree; throws on unknown deps |
| `detectCycle(nodes, compare?)` | `CycleDetectionResult<TId>` | `{ hasCycle, cycle }`; cycle is an ordered closed path |
| `topologicalSort(nodes, compare?)` | `TId[]` | Kahn's algorithm; throws `DAGCycleError` |
| `computeWaves(nodes, compare?)` | `TId[][]` | parallelizable layers; throws `DAGCycleError` |

### Failure cascade

| Function | Returns | Notes |
|----------|---------|-------|
| `transitiveDependents(nodes, id, compare?)` | `TId[]` | all downstream nodes (excludes `id`) |
| `propagateFailure(nodes, failed, compare?)` | `CascadeResult<TId>` | `{ failed, cascaded }`; accepts one or many failed ids |

### Errors

- **`DAGCycleError`** — thrown by `topologicalSort` / `computeWaves` on a cyclic
  graph. Carries `cycle: ReadonlyArray<TId>` (the ordered, closed path) and a
  human-readable `message` (`DAG cycle detected: a -> b -> a`).
- **`DAGMissingNodeError`** — thrown when a `dependsOn` entry (or a cascade/query
  target) references a node not declared in the graph. Carries `missingId` and
  the referencing `nodeId` (when applicable). The core refuses to silently treat
  an undeclared dependency as a phantom node.

## Wave semantics

`computeWaves` assigns each node to wave `1 + max(wave of its dependencies)` —
the longest-path distance from any root. Wave 0 holds dependency-free nodes.
Every node inside a wave is mutually independent, so a scheduler may dispatch a
whole wave concurrently and only advance to wave `N+1` once wave `N` settles.

## Failure cascade

When a node fails, everything that transitively depends on it can no longer run
(its inputs will never be produced). `propagateFailure` returns that downstream
set in `cascaded` so a scheduler can mark those nodes skipped/blocked instead of
dispatching them. A node that is itself in the failed set is never double-counted
as cascaded.

## Provenance & divergences

This package was harvested from two copies of the same engine and cross-checked
against the original:

- **Original:** `platform/crucible` `packages/crucible/src/orchestrator/dag.ts`
  (+ its test suite).
- **Extracted copy:** `pipeline-sdk` `packages/orchestrator/src/dag.ts`
  (header: "100% generic — extracted as-is from crucible").

Where the two disagreed, the original's behaviour was chosen unless the copy
fixed a demonstrable bug. Recorded divergences:

1. **Cycle detection returns the cycle *path*, not a node *set*.** The crucible
   original uses DFS three-colour marking and reconstructs the real ordered
   cycle (`a -> b -> a`). The pipeline-sdk copy reused Kahn's algorithm and
   returned only the unordered set of unvisited (cycle-participating) nodes,
   losing the path. We kept the original's path-returning behaviour — it is both
   the original and what the consuming spec requires ("the cycle path in the
   error").

2. **Missing dependencies are a hard error, not a silent phantom node.** Both
   seeds tolerated a `dependsOn` id with no declared node (treating it as an
   implicit zero-edge node). This core throws `DAGMissingNodeError` instead,
   per the no-silent-degradation principle. Orchestrator-level schema validation
   (which previously caught this upstream) lives in the consumer, not here.

3. **Orchestrator-specific surface was deliberately dropped.** `DAGDefinition`
   validation (kebab-case ids, `chainMode`, `conflictStrategy`,
   `stageTimeoutMinutes`), the `DAGEngine` class, ready-queue resolution, and
   chain extraction are pipeline/orchestrator concerns, not generic DAG
   scheduling — they stay in the consumer to preserve this package's zero-dep,
   payload-agnostic property. The failure *classifiers* (`failure-classifier.ts`
   in both seeds) classify failures by exit code / stderr and are likewise
   domain logic; this package owns failure *cascade propagation* through the
   graph, not failure classification.

## License

MIT
