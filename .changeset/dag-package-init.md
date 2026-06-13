---
"@centient/dag": minor
---

Add `@centient/dag` — a generic, zero-dependency DAG scheduling core over `DAGNode<TId>`. Provides adjacency building, cycle detection (with the ordered cycle path in `DAGCycleError`), deterministic topological sort, parallel-wave computation, and failure-cascade propagation. Harvested and cross-checked from the crucible original and the pipeline-sdk extracted copy; typed `DAGMissingNodeError` replaces silent phantom-node tolerance.
