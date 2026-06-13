/**
 * @centient/path-security
 *
 * Path-traversal validation + path-component sanitization with a Result-typed
 * API. Two layers:
 *
 *   - {@link sanitizeComponent} — validate a single untrusted path segment
 *     (filename / directory name / id).
 *   - {@link validateWithinRoots} — validate that a path resolves inside a
 *     set of allowed root directories (pure, no filesystem I/O).
 *   - {@link resolveRealPathWithinRoots} — the same, plus symlink resolution
 *     via `fs.realpath` (async, fs injectable).
 *
 * Every function returns `Result<T, PathError>` — success carries the
 * validated/resolved value, failure a machine-readable {@link PathError} with
 * a `code` naming the attack class. Nothing throws on rejection.
 */

export {
  ok,
  error,
  fail,
  type Result,
  type PathError,
  type PathErrorCode,
} from "./result.js";

export {
  sanitizeComponent,
  type SanitizeComponentOptions,
} from "./sanitize-component.js";

export {
  validateWithinRoots,
  type ValidateWithinRootsOptions,
} from "./allowed-roots.js";

export {
  resolveRealPathWithinRoots,
  type ResolveRealPathOptions,
  type RealpathFs,
} from "./realpath-guard.js";
