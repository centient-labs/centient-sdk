---
"@centient/secrets": minor
---

Relax `isValidKey` to permit `.` as a namespace separator in credential key names. The validation regex is now `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/` — lowercase alphanumeric plus hyphen and dot, first and last character alphanumeric, up to 64 characters.

Both conventions work now — pick whichever reads best:

```ts
await storeCredential("soma-anthropic-token1", value);  // hyphen-delimited
await storeCredential("soma.anthropic.token1", value);  // dot-delimited
```

Strictly additive — every key that validated under the previous `[a-z0-9-]` regex still validates. Underscores, uppercase, whitespace, and shell metacharacters remain rejected so keys can be safely interpolated into subprocess argv positions without additional escaping.

Motivation: the natural namespace shape for pooled Anthropic credentials is `soma.anthropic.token1`, matching dot-delimited conventions used elsewhere in the soma project. Prior to this change, callers had to pick hyphens to satisfy the vault's stricter-than-necessary validation, even though hyphens and dots are equally safe under the shell-escaping constraint the regex is actually protecting.
