---
"@centient/sdk": minor
---

Model the engram-server 0.50.0 health discriminated unions and add `healthReady()` (#145).

`HealthResponse`, `DetailedHealthResponse`, and the new `ReadyResponse` are now discriminated unions matching what the server actually returns since 0.50.0 (engram-server #1175), and the three health methods parse the typed body from BOTH HTTP 200 and 503 — a health 503 resolves with the degraded/unhealthy/not-ready variant instead of being retried and thrown as an opaque error. Each variant is guarded at runtime (`ResponseShapeError` on contract drift, nested `postgres`/`recovery` objects included).

Migration notes for existing callers:

- `HealthResponse` is now `HealthOkResponse | HealthDegradedResponse | HealthUnhealthyResponse` — narrow on `status` to reach the variant-only fields (`error`, `errorCode`, `recovery`, `recoveryHint`). `status` and `version` remain present on every variant.
- `DetailedHealthResponse` is now `DetailedHealthOkResponse | DetailedHealthDegradedResponse` — `{status, version, postgres, uptime?, embedding?, migrations?}` (+ `recovery?` on degraded; `status: "unhealthy"` maps to the degraded variant). The old `{uptime: number, dependencies, circuitBreakers, rateLimiters}` field set matched nothing 0.50.0 returns; note `uptime` is now a **string**. The orphaned `DependencyHealth`, `CircuitBreakerStats`, and `RateLimiterStats` type exports are removed.
- New `client.healthReady()` calls `GET /v1/health/ready` and returns `ReadyTrueResponse | ReadyFalseResponse` (narrow on the boolean `ready`; the false variant guarantees only `reason`).
- `client.health()` / `healthDetailed()` / `healthReady()` no longer throw on a health 503 — check `status` / `ready` on the resolved value instead. Non-503 errors (401 on the auth-gated routes, proxy 5xx) keep the previous typed-error and retry behavior.
- `checkCompatibility()` now calls `/v1/health` (the bare `/health` alias is not in the 0.50.0 spec) and still resolves against a degraded server, since every variant carries `version`.

Requires engram-server >= 0.50.0 for the union shapes; older servers return the flat pre-union bodies, which the new guards reject with `ResponseShapeError`.
