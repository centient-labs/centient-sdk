/**
 * Flatten/unflatten between nested config objects and dotted-key records.
 *
 * The loader's precedence engine operates on a single flat keyspace so that a
 * default (`{"engram.timeoutMs": 10000}`) and a nested file value
 * (`{"engram": {"timeoutMs": 5000}}`) collide on the same logical key. Arrays
 * and non-plain-object leaves are kept whole — we do not flatten INTO arrays,
 * since array indices are rarely meaningful config keys.
 */

import { ConfigError } from "./errors.js";

/** True for a plain `{}` object (not null, not an array, not a class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Flatten a nested object into dotted keys. `{a:{b:1}}` -> `{"a.b":1}`. Arrays
 * and primitive leaves are stored at their dotted path unchanged.
 */
export function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      Object.assign(out, flatten(value, dotted));
    } else {
      out[dotted] = value;
    }
  }
  return out;
}

/**
 * Inverse of {@link flatten}: `{"a.b":1}` -> `{a:{b:1}}`. Used by write-back to
 * persist a flat keyspace as a human-friendly nested JSON file.
 *
 * Dotted keys that imply contradictory shapes are a HARD ERROR, not a
 * last-write-wins silent overwrite (no-silent-degradation). Two cases conflict:
 *
 *   - A leaf occupies a path another key wants to descend through:
 *     `{"a.b": 1, "a.b.c": 2}` — "a.b" is both a scalar and a parent.
 *   - An object occupies a path another key wants to set as a leaf:
 *     `{"a.b.c": 2, "a.b": 1}` (same pair, opposite order).
 *
 * Either way the merged flat keyspace is internally inconsistent and silently
 * dropping one would lose configured data, so a `ConfigError("KEY_CONFLICT")`
 * is raised naming both colliding keys.
 */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Tracks which dotted prefix first "owned" each materialised container node,
  // so a conflict message can name the key that established the shape.
  const owner = new Map<Record<string, unknown>, string>();
  owner.set(out, "");

  for (const [dotted, value] of Object.entries(flat)) {
    const parts = dotted.split(".");
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      const existing = cursor[part];
      if (existing === undefined && !Object.prototype.hasOwnProperty.call(cursor, part)) {
        const child: Record<string, unknown> = {};
        cursor[part] = child;
        owner.set(child, parts.slice(0, i + 1).join("."));
      } else if (!isPlainObject(existing)) {
        // A non-object value already lives here but this key needs to descend
        // through it: e.g. existing "a.b" leaf vs incoming "a.b.c".
        throw new ConfigError(
          "KEY_CONFLICT",
          `Conflicting config keys: "${parts.slice(0, i + 1).join(".")}" is set as a ` +
            `value but "${dotted}" requires it to be an object.`,
          { key: dotted },
        );
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1] as string;
    const existingLeaf = cursor[leaf];
    if (isPlainObject(existingLeaf)) {
      // An object subtree already lives here but this key sets a scalar leaf:
      // e.g. existing "a.b.c" made "a.b" an object, incoming "a.b" is a value.
      const establishedBy = owner.get(existingLeaf) ?? `${dotted} (nested)`;
      throw new ConfigError(
        "KEY_CONFLICT",
        `Conflicting config keys: "${dotted}" is set as a value but a nested key ` +
          `(e.g. under "${establishedBy}") already requires it to be an object.`,
        { key: dotted },
      );
    }
    cursor[leaf] = value;
  }
  return out;
}
