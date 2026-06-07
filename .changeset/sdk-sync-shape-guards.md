---
"@centient/sdk": patch
---

Complete runtime response-shape validation across the sync resource:
`getStatus`, `pullFrom`, and `resolveConflict` now reject a null/malformed
`data` envelope with a structured `EngramError` (instead of a downstream
`TypeError`), consistent with the guards already on `push`/`pushTo`/
`listConflicts`/peers. No change for well-formed responses. (Advances #62.)
