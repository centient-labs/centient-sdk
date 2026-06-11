---
"@centient/sdk": patch
---

Add jitter to retry backoff: every retry site now sleeps `retryDelay * attempt + Math.random() * retryDelay * 0.5` via a single `backoffDelay` method, so synchronized consumers no longer retry in lockstep against a struggling server. The linear base budget is unchanged; worst case adds at most `0.5 * retryDelay` per attempt.
