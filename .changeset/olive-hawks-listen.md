---
"@centient/sdk": minor
---

feat(sdk): expose engram incremental listing on `crystals.list()` (#134)

`crystals.list()` offered only offset pagination. Over a corpus that mutates
between requests, offset pages shift underfoot — deeper pages repeat or skip
rows — so no client could build a correct incremental scan on top of it. The
server has had the fix since engram-server 0.45.0 (ADR-040 / #995 watermarks,
#925 keyset cursor); the SDK did not expose it.

Additive params on `crystals.list()` — **requires engram-server >= 0.45.0**:

- `updatedAfter` / `createdAfter` — ISO-8601 watermarks; the server returns only
  rows changed strictly after the instant. This is the poll window.
- `cursor` — the opaque `(createdAt, id)` keyset cursor. The result now carries
  `nextCursor`; `undefined` means the window is drained.

Compose them: the watermark is the poll window, the cursor is the pagination
*within* it. Advancing the watermark per page instead of per poll silently drops
every row tying on the boundary timestamp — the docs and JSDoc carry the rule.

Three things fail loudly instead of degrading:

- `cursor` + `offset` together is a **compile error** (`ListKnowledgeCrystalsParams`
  is now a union of `ListKnowledgeCrystalsFilters & (OffsetPaginationParams |
  KeysetPaginationParams)`, all three exported), and a `VALIDATION_INPUT_INVALID`
  `EngramError` for plain-JS callers. The server resolves the conflict by
  silently ignoring `offset`; the SDK refuses.
- A zone-less watermark throws client-side with a message naming the fix, rather
  than surfacing the server's opaque 400.
- A non-string `meta.pagination.cursor` throws `ResponseShapeError` at the
  boundary that produced it, not as a 400 on the caller's next page.

Back-compatible: existing offset callers are unaffected — same query string,
same result fields. One typing note: because the pagination half is now a union,
assigning into a pre-declared `ListKnowledgeCrystalsParams` variable
(`params.offset = 5`) no longer typechecks. Build the object as a literal, or
declare it as `ListKnowledgeCrystalsFilters & OffsetPaginationParams`.
