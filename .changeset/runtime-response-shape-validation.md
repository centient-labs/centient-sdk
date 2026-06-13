---
"@centient/sdk": minor
---

Add category-wide runtime response-shape validation (closes #62).

Every resource read path now routes through a single internal boundary
validator (`src/validate.ts`, `@internal`, stripped from the published `.d.ts`)
covering the three response families — the standard `{ data, meta }` envelope,
the sync `{ success, data }` envelope, and bare peers/maintenance bodies. The
hand-rolled guards #64 added to the sync resource are generalized into shared,
zero-dependency structural guards (no zod).

Malformed 2xx bodies (truncated, `null`, or wrong-typed fields) now throw a new
typed `ResponseShapeError` (extends `EngramError`) carrying the failing request
`path` and `resource` name, instead of surfacing as a downstream `TypeError` at
the call site. The error is **non-retryable** — a malformed body is
deterministic, so the request layer makes exactly one `fetch` before throwing.

The only public-surface addition is the `ResponseShapeError` class; all
validation helpers stay internal.
