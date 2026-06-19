---
"@centient/sdk": patch
---

Fix `parseApiError` so the thrown error CLASS is a function of the HTTP status,
not the response envelope shape (issue #117).

The nested error envelope `{ error: { code, message, details? } }` was handled
in a branch that ran before the `switch (statusCode)` mapping and — for every
code other than the two shimmer special-cases — threw a base `EngramError`. As
a result the `404 → NotFoundError` / `401 → UnauthorizedError` /
`409 → CrystalVersionConflictError` / `500 → InternalError` mappings only fired
for the flat `{ code, message }` body shape, never for the nested envelope. In
practice engram's nested `404 RES_NOT_FOUND` ("no live shimmer") was thrown as a
base `EngramError`, so consumers catching `NotFoundError` to detect a healthy
"route live, record absent" 404 misclassified it (broke mbot's ADR-031
shimmer-heartbeat probe against engram 0.42.0 + @centient/sdk 2.1.0).

Both envelope branches now route through one shared `errorForCode` helper that
maps `code` + `statusCode` to the typed class, so a nested-envelope 404 is
`instanceof NotFoundError` exactly like a flat-body 404. The typed shimmer
special-cases (`SHIMMER_CAS_CONFLICT`, `SHIMMER_DISABLED`) and the
`OPERATION_VERSION_CONFLICT` CAS case still map to their typed errors. The
server's original `code` and `details` are preserved on the status-keyed classes
(`NotFoundError`/`UnauthorizedError`/`InternalError` gained optional
`code`/`details` params), so a nested `RES_NOT_FOUND` 404 is both
`instanceof NotFoundError` AND keeps `code === "RES_NOT_FOUND"`. A generic 409
(e.g. `SYNC_SCHEMA_VERSION_MISMATCH`) stays a base `EngramError` carrying its
real code/message/details rather than being rewritten into a `SessionExistsError`.
