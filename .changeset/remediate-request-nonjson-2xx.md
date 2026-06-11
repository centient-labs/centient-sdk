---
"@centient/sdk": patch
---

Stop retrying deterministic JSON parse failures: `request()` and `_requestFormData()` now check `response.ok` before parsing the body, so a non-2xx response with a non-JSON body (e.g. a proxy HTML error page) surfaces as a status-typed ApiError instead of a retried SyntaxError, and a 2xx response with a non-JSON body fails fast with a non-retryable NetworkError carrying the status and the first 200 chars of the body (mirrors the existing `_requestRawBody` handling).
