/**
 * Shared unicode-normalization-trick detector.
 *
 * Both the single-component sanitizer and the allowed-roots path validator
 * must reject input whose characters fold (under NFC/NFKC) into a
 * path-significant character — a separator (`/` `\`) or a `..` dot-run — that
 * was not literally present. A downstream layer that normalizes the string
 * (URL decode + NFKC, a filesystem that folds names, a templating step) would
 * otherwise see a separator the lexical check never did.
 *
 * The two call sites previously diverged: the component sanitizer compared the
 * raw string against its NFKC folding, while the path validator only matched a
 * FIXED list of homoglyph characters — so a fold-introduced separator outside
 * that list (e.g. U+2100 `℀` -> `a/c`, U+FE68 `﹨` -> `\`) slipped past the
 * path validator. This module is the single source of truth so they cannot
 * drift again.
 */

// Known homoglyph separators / dot-runs, checked directly so a single glyph
// that is itself a separator lookalike is caught even when it does not fold:
// fullwidth solidus (U+FF0F), fraction slash (U+2044), division slash
// (U+2215), reverse-solidus lookalikes (U+29F5, U+29F8, U+FF3C), one-dot
// leader (U+2024), two-dot leader (U+2025), horizontal ellipsis (U+2026) and
// fullwidth full stop (U+FF0E).
const HOMOGLYPH_SEPARATORS_RE = /[／⁄∕⧵⧸＼․‥…．]/;

const SEPARATOR_GLOBAL_RE = /[/\\]/g;

/** Count `/` and `\` occurrences in a string. */
function countSeparators(value: string): number {
  return (value.match(SEPARATOR_GLOBAL_RE) ?? []).length;
}

/**
 * Return true when `input` contains a character that imitates a path
 * separator/dot or that NFKC-normalization would fold into one.
 *
 * The NFKC comparison catches the open-ended set of glyphs that fold into a
 * separator or `..`; the fixed homoglyph class catches the lookalikes that do
 * not fold but are still visually a separator.
 *
 * Detection is count-based, not presence-based: it fires when folding
 * *increases* the number of separators or *introduces* a `..` dot-run. A
 * presence check (`folded contains "/"`) would be useless for a full path,
 * which already contains separators — that bug let fold-introduced separators
 * (U+2100 -> "a/c", U+FE68 -> "\") slip past the path validator while the
 * component sanitizer (no separators present) still caught them.
 */
export function hasUnicodeTrick(input: string): boolean {
  if (HOMOGLYPH_SEPARATORS_RE.test(input)) {
    return true;
  }
  // If NFKC folding *introduces* a separator or dot-run that the raw string
  // did not already contain, the input was relying on normalization.
  const folded = input.normalize("NFKC");
  if (folded === input) {
    return false;
  }
  const introducesSeparator =
    countSeparators(folded) > countSeparators(input);
  const introducesDotRun = folded.includes("..") && !input.includes("..");
  return introducesSeparator || introducesDotRun;
}
