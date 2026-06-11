---
"@centient/sdk": patch
---

Add jitter to retry backoff: every retry site now sleeps `retryDelay * attempt + Math.random() * retryDelay * 0.5` via a single `backoffDelay` method, so synchronized consumers no longer retry in lockstep against a struggling server.

**Behavioral change:** retry delays were previously deterministic (`retryDelay * attempt` exactly); they are now randomized within `[retryDelay * attempt, retryDelay * attempt + 0.5 * retryDelay)`. The linear base budget is unchanged and the worst case adds at most `0.5 * retryDelay` per attempt, but tests or monitors that assert exact retry timing must either tolerate the jitter window or stub `Math.random()` to pin delays.
