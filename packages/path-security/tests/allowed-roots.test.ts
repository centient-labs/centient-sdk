/**
 * Adversarial test vectors for {@link validateWithinRoots}.
 *
 * Allowed roots are POSIX-style absolute paths under a synthetic base so the
 * suite is deterministic across machines (no real filesystem, no homedir).
 * One row per attack vector; each comment names the attack class.
 */

import { describe, expect, it } from "vitest";

import {
  validateWithinRoots,
  type PathErrorCode,
  type ValidateWithinRootsOptions,
} from "../src/index.js";

const ROOT = "/srv/app/data";
const NUL = "\u0000";

const baseOpts: ValidateWithinRootsOptions = {
  allowedRoots: [ROOT],
};

interface RejectVector {
  attack: string;
  input: string;
  code: PathErrorCode;
  opts?: Partial<ValidateWithinRootsOptions>;
}

const REJECT_VECTORS: RejectVector[] = [
  // --- plain traversal -----------------------------------------------------
  {
    attack: "dot-dot escape above the root",
    input: `${ROOT}/../etc/passwd`,
    code: "TRAVERSAL",
  },
  {
    attack: "deep dot-dot escape",
    input: `${ROOT}/a/b/../../../../../etc/shadow`,
    code: "TRAVERSAL",
  },

  // --- null byte -----------------------------------------------------------
  {
    attack: "null-byte truncation",
    input: `${ROOT}/ok${NUL}/../../etc`,
    code: "NULL_BYTE",
  },

  // --- percent-encoded traversal -------------------------------------------
  {
    attack: "percent-encoded dot-dot (%2e%2e)",
    input: `${ROOT}/%2e%2e/etc`,
    code: "PERCENT_ENCODED",
  },
  {
    attack: "percent-encoded slash (%2f)",
    input: `${ROOT}/a%2f..%2fetc`,
    code: "PERCENT_ENCODED",
  },
  {
    attack: "double-encoded dot-dot (%252e)",
    input: `${ROOT}/%252e%252e/etc`,
    code: "PERCENT_ENCODED",
  },

  // --- unicode homoglyph ---------------------------------------------------
  {
    attack: "fullwidth solidus U+FF0F imitating /",
    input: `${ROOT}／..／etc`,
    code: "UNICODE_TRICK",
  },
  {
    attack: "fullwidth full stop U+FF0E imitating ..",
    input: `${ROOT}/．．/etc`,
    code: "UNICODE_TRICK",
  },

  // --- Windows drive / UNC / device ----------------------------------------
  {
    attack: "Windows drive-letter path (C:\\)",
    input: "C:\\Windows\\System32",
    code: "WINDOWS_DRIVE",
  },
  {
    attack: "bare Windows drive (C:)",
    input: "C:",
    code: "WINDOWS_DRIVE",
  },
  {
    attack: "UNC path (\\\\server\\share)",
    input: "\\\\server\\share\\secret",
    code: "UNC_PATH",
  },
  {
    attack: "Windows device namespace (\\\\.\\PhysicalDrive0)",
    input: "\\\\.\\PhysicalDrive0",
    code: "UNC_PATH",
  },
  {
    attack: "Windows long-path device prefix (\\\\?\\C:\\)",
    input: "\\\\?\\C:\\secret",
    code: "UNC_PATH",
  },

  // --- containment boundary ------------------------------------------------
  {
    attack: "sibling-prefix false-positive (/srv/app/data-backup)",
    input: "/srv/app/data-backup/x",
    code: "OUTSIDE_ROOTS",
  },
  {
    attack: "absolute path entirely outside the root",
    input: "/etc/passwd",
    code: "OUTSIDE_ROOTS",
  },

  // --- shape / config ------------------------------------------------------
  {
    attack: "relative path (ambient-cwd resolution refused)",
    input: "data/x",
    code: "NOT_ABSOLUTE",
  },
  {
    attack: "tilde without expansion enabled",
    input: "~/secret",
    code: "NOT_ABSOLUTE",
  },
  {
    attack: "empty path",
    input: "",
    code: "EMPTY",
  },
  {
    attack: "no allowed roots configured",
    input: `${ROOT}/file`,
    code: "NO_ALLOWED_ROOTS",
    opts: { allowedRoots: [] },
  },
];

describe("validateWithinRoots — adversarial rejection vectors", () => {
  it.each(REJECT_VECTORS)(
    "rejects [$attack] with code $code",
    ({ input, code, opts }) => {
      const result = validateWithinRoots(input, { ...baseOpts, ...opts });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    },
  );
});

interface AcceptVector {
  why: string;
  input: string;
  opts?: Partial<ValidateWithinRootsOptions>;
  expected: string;
}

const ACCEPT_VECTORS: AcceptVector[] = [
  {
    why: "the root itself",
    input: ROOT,
    expected: ROOT,
  },
  {
    why: "a nested file under the root",
    input: `${ROOT}/sub/file.txt`,
    expected: `${ROOT}/sub/file.txt`,
  },
  {
    why: "a single trailing dot segment (current dir, no escape)",
    input: `${ROOT}/./file.txt`,
    expected: `${ROOT}/file.txt`,
  },
  {
    why: "tilde expansion when enabled, resolving under a root",
    input: "~/file.txt",
    opts: {
      allowedRoots: ["/home/agent"],
      expandTilde: true,
      homeDir: "/home/agent",
    },
    expected: "/home/agent/file.txt",
  },
];

describe("validateWithinRoots — legitimate paths pass", () => {
  it.each(ACCEPT_VECTORS)("accepts [$why]", ({ input, opts, expected }) => {
    const result = validateWithinRoots(input, { ...baseOpts, ...opts });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(expected);
    }
  });
});
