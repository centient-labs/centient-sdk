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
