/**
 * Flatten/unflatten between nested config objects and dotted-key records.
 *
 * The loader's precedence engine operates on a single flat keyspace so that a
 * default (`{"engram.timeoutMs": 10000}`) and a nested file value
 * (`{"engram": {"timeoutMs": 5000}}`) collide on the same logical key. Arrays
 * and non-plain-object leaves are kept whole — we do not flatten INTO arrays,
 * since array indices are rarely meaningful config keys.
 */

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
 */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [dotted, value] of Object.entries(flat)) {
    const parts = dotted.split(".");
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      const existing = cursor[part];
      if (!isPlainObject(existing)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1] as string] = value;
  }
  return out;
}
