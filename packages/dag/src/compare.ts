/**
 * Shared deterministic node-ID ordering.
 *
 * Every operation that emits node IDs breaks ties with a single,
 * caller-overridable comparator so output never depends on Map/Set insertion
 * order. Centralising the default here keeps `graph` and `cascade` in lockstep
 * (one definition, no drift) — the DRY counterpart of the determinism contract.
 *
 * @module compare
 */

/** Stable comparator over node IDs. Default is ascending codepoint order. */
export type IdComparator<TId extends string> = (a: TId, b: TId) => number;

/**
 * Default comparator: ascending Unicode-codepoint order via `<`/`>`.
 *
 * Pure and total; never throws. Returns `-1`/`0`/`1`.
 */
export function defaultComparator<TId extends string>(a: TId, b: TId): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
