/**
 * Adversarial test vectors for {@link sanitizeComponent}.
 *
 * One row per attack vector. Each row's comment names the attack class. The
 * suite is the security contract for the single-component sanitizer: if a row
 * stops failing, a guard regressed.
 *
 * Control bytes are built from escape sequences (never embedded literally) so
 * the source stays clean ASCII and reviewable.
 */

import { describe, expect, it } from "vitest";

import {
  sanitizeComponent,
  type PathErrorCode,
} from "../src/index.js";

const NUL = "\u0000";

interface RejectVector {
  /** Attack class — names WHY this input is dangerous. */
  attack: string;
  /** The raw untrusted component. */
  input: string;
  /** The PathErrorCode we require the guard to return. */
  code: PathErrorCode;
}

const REJECT_VECTORS: RejectVector[] = [
  // --- null byte / truncation ----------------------------------------------
  {
    attack: "null-byte truncation (C string terminator)",
    input: `evil${NUL}.txt`,
    code: "NULL_BYTE",
  },
  {
    attack: "null byte at end (extension-hiding)",
    input: `report.pdf${NUL}`,
    code: "NULL_BYTE",
  },

  // --- control characters --------------------------------------------------
  {
    attack: "control char (carriage return — log/path injection)",
    input: "name\r",
    code: "CONTROL_CHAR",
  },
  {
    attack: "control char (newline — log injection)",
    input: "a\nb",
    code: "CONTROL_CHAR",
  },
  {
    attack: "DEL control char (0x7f)",
    input: "a\u007fb",
    code: "CONTROL_CHAR",
  },

  // --- raw path separators -------------------------------------------------
  {
    attack: "embedded forward slash (sub-path injection)",
    input: "a/b",
    code: "PATH_SEPARATOR",
  },
  {
    attack: "embedded backslash (Windows sub-path injection)",
    input: "a\\b",
    code: "PATH_SEPARATOR",
  },

  // --- dot-segment traversal -----------------------------------------------
  {
    attack: "exact parent-dir token",
    input: "..",
    code: "DOT_SEGMENT",
  },
  {
    attack: "exact current-dir token",
    input: ".",
    code: "DOT_SEGMENT",
  },
  {
    attack: "embedded dot-dot traversal",
    input: "a..b",
    code: "TRAVERSAL",
  },

  // --- percent-encoded traversal -------------------------------------------
  {
    attack: "percent-encoded dot-dot (%2e%2e)",
    input: "%2e%2e",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "percent-encoded slash (%2f)",
    input: "a%2fb",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "percent-encoded backslash (%5c)",
    input: "a%5cb",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "double-encoded dot (%252e — decoder runs twice)",
    input: "%252e%252e",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "mixed encoded + literal (%2e.)",
    input: "%2e.",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "percent-encoded null (%00)",
    input: "a%00b",
    code: "PERCENT_ENCODED",
  },
  {
    attack: "overlong UTF-8 lead byte (%c0 — overlong slash encoding)",
    input: "a%c0%afb",
    code: "PERCENT_ENCODED",
  },

  // --- unicode normalization tricks ----------------------------------------
  {
    attack: "fullwidth solidus U+FF0F (NFKC folds to /)",
    input: "a／b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "fraction slash U+2044 homoglyph",
    input: "a⁄b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "division slash U+2215 homoglyph",
    input: "a∕b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "fullwidth reverse solidus U+FF3C (NFKC folds to \\)",
    input: "a＼b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "one-dot leader U+2024 (homoglyph .)",
    input: "a․․b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "two-dot leader U+2025 (homoglyph ..)",
    input: "a‥b",
    code: "UNICODE_TRICK",
  },
  {
    attack: "fullwidth full stop U+FF0E pair (NFKC folds to ..)",
    input: "a．．b",
    code: "UNICODE_TRICK",
  },

  // --- Windows reserved device names ---------------------------------------
  {
    attack: "Windows device name CON",
    input: "CON",
    code: "RESERVED_DEVICE_NAME",
  },
  {
    attack: "Windows device name NUL (lowercase)",
    input: "nul",
    code: "RESERVED_DEVICE_NAME",
  },
  {
    attack: "Windows device name with extension (NUL.txt is still NUL)",
    input: "NUL.txt",
    code: "RESERVED_DEVICE_NAME",
  },
  {
    attack: "Windows COM port device (COM1)",
    input: "COM1",
    code: "RESERVED_DEVICE_NAME",
  },
  {
    attack: "Windows LPT device (LPT9)",
    input: "LPT9",
    code: "RESERVED_DEVICE_NAME",
  },

  // --- Windows trailing dot/space name confusion ---------------------------
  {
    attack: "trailing dot (Windows strips — evil. == evil)",
    input: "evil.",
    code: "TRAILING_DOT_OR_SPACE",
  },
  {
    attack: "trailing space (Windows strips)",
    input: "evil ",
    code: "TRAILING_DOT_OR_SPACE",
  },

  // --- empty / whitespace --------------------------------------------------
  {
    attack: "empty string",
    input: "",
    code: "EMPTY",
  },
  {
    attack: "whitespace-only",
    input: "   ",
    code: "EMPTY",
  },

  // --- long-path edge -------------------------------------------------------
  {
    attack: "over-long component (256 chars > 255 limit)",
    input: "a".repeat(256),
    code: "TOO_LONG",
  },
];

describe("sanitizeComponent — adversarial rejection vectors", () => {
  it.each(REJECT_VECTORS)(
    "rejects [$attack] with code $code",
    ({ input, code }) => {
      const result = sanitizeComponent(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        // Error message must never echo the raw untrusted input verbatim.
        expect(result.error.message).not.toContain(NUL);
      }
    },
  );
});

interface AcceptVector {
  why: string;
  input: string;
}

const ACCEPT_VECTORS: AcceptVector[] = [
  { why: "plain filename", input: "report.pdf" },
  { why: "single dot inside name (not a dot-segment)", input: "v1.2.3" },
  { why: "hyphen + underscore", input: "my_file-name" },
  { why: "leading dotfile", input: ".gitignore" },
  { why: "unicode letters that do NOT fold to separators", input: "café-señor" },
  { why: "device-name-like but with non-reserved suffix", input: "CONSOLE" },
  { why: "exactly 255 chars (at the limit)", input: "a".repeat(255) },
];

describe("sanitizeComponent — legitimate components pass", () => {
  it.each(ACCEPT_VECTORS)("accepts [$why]", ({ input }) => {
    const result = sanitizeComponent(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(input);
    }
  });
});

describe("sanitizeComponent — options", () => {
  it("honors a custom maxLength", () => {
    const result = sanitizeComponent("abcdef", { maxLength: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TOO_LONG");
    }
  });

  it.each(["CON", "NUL", "COM1", "LPT9", "AUX", "PRN", "nul", "NUL.txt"])(
    "allows reserved device name %j when rejectReservedNames is false",
    (name) => {
      const result = sanitizeComponent(name, { rejectReservedNames: false });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(name);
      }
    },
  );
});
