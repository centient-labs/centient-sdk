---
"@centient/sdk": patch
---

Add `crystals.related(id)` method that wraps `GET /v1/crystals/:id/related` and returns the paginated edge envelope as `{ edges, total, hasMore }`.

The current server implementation returns graph neighbours (incoming + outgoing edges), not embedding-similarity matches — callers should label UI accordingly. Mirrors the typing pattern of `crystals.list()`.
