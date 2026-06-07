---
"@centient/sdk": patch
---

Keep internal HTTP plumbing out of the published type surface. Enable
`stripInternal` so the `@internal` request helpers (`_request`, `_requestRaw`,
`_requestRawBody`, `_requestFormData`) are no longer emitted into the package's
`.d.ts` — external consumers can't accidentally type against them across
releases. The `baseUrl` / `apiKey` client properties are now documented as
genuinely public (un-`@internal`-ed) so they remain available for introspection.
No runtime change. (Closes #60.)

Note: this is a type-level change only. Any consumer that was typing against the
`_request*` helpers (in violation of their `@internal` contract) will now get a
TypeScript error and should migrate off them — they were never part of the
supported public API. `patch` is appropriate under SemVer because `@internal`
explicitly disclaims stability.

Workspace audit: the only callers of `_request*` are the SDK's own resource
classes (`export-import`, `sync`), which compile from source and are unaffected
by `stripInternal` (it only changes emitted `.d.ts`). No other workspace package
or external consumer depends on these methods.
