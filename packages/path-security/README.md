# @centient/path-security

Path-traversal validation and path-component sanitization with a Result-typed
API. Zero runtime dependencies, ESM-only.

Two layers, both reject-not-scrub and both returning `Result<T, PathError>` —
nothing throws on a rejected path, so callers must handle the failure branch
and learn *which* attack class was detected.

## Installation

```bash
npm install @centient/path-security
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/path-security --workspace
```

## API

### `sanitizeComponent(input, options?)`

Validate a single untrusted path **segment** — a filename, directory name, or
id. A component may not contain separators, may not be `.`/`..`, and may not
encode either through percent-encoding or unicode tricks.

```typescript
import { sanitizeComponent } from "@centient/path-security";

const result = sanitizeComponent(userTopic);
if (!result.ok) {
  // result.error.code is e.g. "TRAVERSAL", "NULL_BYTE", "UNICODE_TRICK"
  throw new Error(`bad component: ${result.error.code}`);
}
const safeName = result.value; // unchanged input, proven safe
```

Options: `maxLength` (default 255), `rejectReservedNames` (default true —
blocks Windows device names like `CON`, `NUL`, `COM1`).

### `validateWithinRoots(inputPath, options)`

Validate that a path, once resolved, stays inside one of a caller-supplied set
of `allowedRoots`. **Pure and synchronous** — no filesystem I/O, no ambient
`os`/`process` reads. There is no implicit default root set; the caller must
pass at least one (defaulting to `homedir`/`cwd` is exactly the silent ambient
behavior this package avoids).

```typescript
import { validateWithinRoots } from "@centient/path-security";

const result = validateWithinRoots(inputPath, {
  allowedRoots: ["/srv/app/data"],
});
if (result.ok) {
  readFile(result.value); // resolved absolute path, proven in-root
}
```

Options: `allowedRoots` (required), `requireAbsolute` (default true),
`expandTilde` (default false) + `homeDir` (injected, required when
`expandTilde` is true).

### `resolveRealPathWithinRoots(inputPath, options)`

Same containment check as `validateWithinRoots`, plus **symlink resolution**
via `fs.realpath`. Catches a symlink *inside* a root that points *outside* it
— the case the lexical check cannot see. Async; the `fs` implementation is
injectable for testing.

```typescript
import { resolveRealPathWithinRoots } from "@centient/path-security";

const result = await resolveRealPathWithinRoots(inputPath, {
  allowedRoots: ["/srv/app/data"],
});
// rejects with OUTSIDE_ROOTS if a symlink (or symlinked parent dir) escapes
```

## Attack classes covered

The test suite is table-driven, one row per vector, each naming its attack
class:

- encoded traversal — percent-encoded dot-dot, double-encoding, mixed,
  overlong UTF-8 lead bytes
- null bytes (truncation / extension-hiding)
- control characters (log/path injection)
- raw path separators in a component
- unicode normalization tricks — homoglyph solidus / full-stop, NFKC folding
  that introduces a separator or `..`
- Windows reserved device names (`CON`, `NUL`, `COM1`-`9`, `LPT1`-`9`),
  drive-letter paths (`C:\`), UNC paths (`\\server\share`), device-namespace
  paths (`\\.\`, `\\?\`)
- trailing dot / space name confusion (Windows strips them)
- long-path edges (the 255-char component limit)
- symlink escape (leaf and intermediate-directory)

## Design notes

- **Strictest-of-seeds.** Each check is drawn from one of three internal
  implementations (centient `pathValidation.ts` / `path-guards.ts`, crucible
  `sanitize-path.ts`, soma `git/sanitize.ts`); where they disagreed, the
  stricter behavior won. Source comments name the originating seed per check.
- **Reject, don't scrub.** A component that would need scrubbing to be safe is
  rejected with a code, so the caller learns about the attack rather than
  silently using a mangled name. (crucible *stripped* separators; this package
  rejects — stricter.)
- **No ambient state.** `homeDir` and `fs` are injected, not read from `os` /
  `process`, keeping the functions pure and deterministic (observable
  architecture).

## License

MIT
