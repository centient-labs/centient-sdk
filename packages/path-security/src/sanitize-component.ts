/**
 * Path-component sanitizer.
 *
 * A "component" is a single path segment — a filename or directory name —
 * built from untrusted input (a topic, a session id, a project name). It is
 * NOT a path: it may not contain separators, may not be `.`/`..`, and may not
 * encode either of those through percent-encoding or unicode tricks.
 *
 * Strictest-of-seeds policy. For every check below the comment names the seed
 * the behavior was lifted from, and where two seeds disagreed the stricter
 * one wins:
 *
 *   - null bytes               -> reject  (centient pathValidation, crucible)
 *   - control characters       -> reject  (centient validatePathComponent)
 *   - path separators `/`,`\`  -> reject  (centient — crucible only *stripped*
 *                                 them, which can collapse `a/../b` into `a..b`
 *                                 or merge segments; rejecting is stricter)
 *   - literal `..`             -> reject  (crucible, soma — centient permitted
 *                                 `..` if the *resolved* path stayed in-root,
 *                                 but a single component must never traverse)
 *   - exact `.` / `..`         -> reject  (centient validatePathComponent)
 *   - length > 255             -> reject  (centient validatePathComponent)
 *
 * Checks with no seed (added for this package — public scrutiny matters here,
 * and the acceptance vectors demand them) are marked `[added]`:
 *
 *   - percent-encoded traversal / separators (single + double encoding)
 *   - unicode normalization tricks (a glyph that NFC/NFKC-folds into `.` or
 *     a separator, fullwidth solidus, overlong forms)
 *   - Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 *   - trailing dot / space (Windows strips these, enabling name confusion)
 */

import {
  fail,
  ok,
  type PathError,
  type Result,
} from "./result.js";
import { hasUnicodeTrick } from "./unicode-trick.js";

/** Options for {@link sanitizeComponent}. */
export interface SanitizeComponentOptions {
  /**
   * Maximum allowed component length. Default 255 (the common single-name
   * limit on ext4/APFS/NTFS). From centient validatePathComponent.
   */
  maxLength?: number;
  /**
   * When true (default), reject Windows reserved device names (CON, NUL, …).
   * Cross-platform safety: a file named `CON` is unusable on Windows and is a
   * classic name-confusion vector. `[added]` — no seed checked this.
   */
  rejectReservedNames?: boolean;
}

const DEFAULT_MAX_LENGTH = 255;

// Null byte (U+0000) — path-truncation attack. (centient, crucible)
const NULL_BYTE = "\u0000";

// Control characters: C0 (0x00-0x1f) and DEL (0x7f). From centient.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

// Windows reserved device names (case-insensitive, with or without an
// extension — `NUL.txt` is still NUL on Windows). [added]
const RESERVED_DEVICE_RE =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.[^.]*)?$/i;

// Percent-encoded `.` (%2e), `/` (%2f), `\` (%5c) and the null byte (%00),
// plus the overlong/illegal UTF-8 lead bytes (%c0 %c1 %e0 %f0) used in
// overlong-encoding traversal. The leading `%25*` allows the double-encoded
// forms (`%252e`) without recursively decoding. [added]
const PERCENT_ENCODED_RE = /%(25)*(2e|2f|5c|00|c0|c1|e0|f0)/i;

/**
 * Sanitize and validate a single untrusted path component (filename or
 * directory name). Returns the (unchanged) input on success — sanitization
 * here is reject-not-scrub: a component that needs scrubbing to be safe is
 * rejected so the caller learns about the attack rather than silently using
 * a mangled name.
 *
 * @param input - raw untrusted single-segment string
 * @param options - {@link SanitizeComponentOptions}
 * @returns the validated component, or a structured {@link PathError}
 */
export function sanitizeComponent(
  input: string,
  options?: SanitizeComponentOptions,
): Result<string, PathError> {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const rejectReservedNames = options?.rejectReservedNames ?? true;

  // Empty / whitespace-only. (centient validateProjectName, crucible)
  if (input.length === 0 || input.trim() === "") {
    return fail("EMPTY", "Path component cannot be empty");
  }

  // Null bytes — path-truncation attack. (centient, crucible)
  if (input.includes(NULL_BYTE)) {
    return fail("NULL_BYTE", "Path component contains a null byte");
  }

  // Control characters. (centient validatePathComponent)
  if (CONTROL_CHARS_RE.test(input)) {
    return fail("CONTROL_CHAR", "Path component contains control characters");
  }

  // Length. (centient validatePathComponent)
  if (input.length > maxLength) {
    return fail(
      "TOO_LONG",
      `Path component too long (max ${maxLength} characters)`,
    );
  }

  // Percent-encoded traversal / separators (single + double encoding). [added]
  if (PERCENT_ENCODED_RE.test(input)) {
    return fail(
      "PERCENT_ENCODED",
      "Path component contains percent-encoded path characters",
    );
  }

  // Unicode normalization tricks. [added]
  if (hasUnicodeTrick(input)) {
    return fail(
      "UNICODE_TRICK",
      "Path component contains characters that normalize into path separators or dots",
    );
  }

  // Path separators. (centient validatePathComponent — stricter than crucible,
  // which stripped them.)
  if (input.includes("/") || input.includes("\\")) {
    return fail(
      "PATH_SEPARATOR",
      "Path component contains a path separator",
    );
  }

  // Exact `.` / `..`. (centient validatePathComponent)
  if (input === "." || input === "..") {
    return fail("DOT_SEGMENT", "Path component cannot be '.' or '..'");
  }

  // Any embedded `..`. (crucible sanitizePathComponent, soma allowlist)
  if (input.includes("..")) {
    return fail("TRAVERSAL", "Path component contains a '..' sequence");
  }

  // Windows reserved device names. [added]
  if (rejectReservedNames && RESERVED_DEVICE_RE.test(input)) {
    return fail(
      "RESERVED_DEVICE_NAME",
      "Path component is a reserved Windows device name",
    );
  }

  // Trailing dot or space — Windows silently strips these, so `evil.` and
  // `evil` collide. [added]
  if (/[. ]$/.test(input)) {
    return fail(
      "TRAILING_DOT_OR_SPACE",
      "Path component cannot end with a dot or space",
    );
  }

  return ok(input);
}
