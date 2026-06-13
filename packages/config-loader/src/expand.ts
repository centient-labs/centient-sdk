/**
 * Environment-variable reference expansion inside config-file string values.
 *
 * Supports the two POSIX-ish forms commonly embedded in JSON config:
 *   - `${VAR}`           -> value of VAR, or "" when unset/empty
 *   - `${VAR:-default}`  -> value of VAR, or `default` when unset/empty
 *
 * An EMPTY env var is treated as unset (falls back to the default) — matching
 * the seed behaviour, where the default config template uses "" placeholders
 * that should resolve to the baked-in default, not an empty override.
 *
 * Extracted verbatim-in-spirit from the centient seed's `expandEnvVars`, with
 * the `process.env` read replaced by an injected lookup so expansion is
 * deterministic in tests.
 */

import type { EnvProvider } from "./types.js";

// Matches ${VAR} or ${VAR:-default}. Var names are restricted to the POSIX
// portable charset — a leading letter or underscore followed by letters,
// digits, or underscores — so references like "${ not a var }" or names with
// punctuation are left untouched instead of being treated as expandable. Both
// cases are honoured (env var names are case-sensitive); restricting to
// uppercase only would wrongly skip valid lowercase names. A `${...}` that does
// not match a well-formed name simply passes through verbatim.
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Expand all `${VAR}` / `${VAR:-default}` references in a single string.
 *
 * DEVIATION FROM SHELL SEMANTICS (intentional): an undefined/empty `${VAR}` with
 * NO default expands to the EMPTY STRING, not to the literal `${VAR}` text that a
 * POSIX shell would leave in place. This matches the centient seed's
 * `expandEnvVars`, where config templates carry `"${VAR}"` placeholders that must
 * collapse to "" (then layer under a baked-in default) when the operator has not
 * set the override. Callers who need a literal fallback should supply one
 * explicitly via `${VAR:-default}` (use `${VAR:-}` to make the empty-string
 * result intentional and self-documenting at the call site).
 */
export function expandEnvRefs(value: string, env: EnvProvider): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string, defaultValue?: string) => {
    const envValue = env.get(varName);
    if (envValue !== undefined && envValue !== "") {
      return envValue;
    }
    return defaultValue !== undefined ? defaultValue : "";
  });
}

/**
 * Recursively expand env references in every string leaf of a JSON-like value.
 * Arrays and nested objects are walked; non-string leaves pass through.
 */
export function expandEnvRefsDeep<T>(value: T, env: EnvProvider): T {
  if (typeof value === "string") {
    return expandEnvRefs(value, env) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvRefsDeep(item, env)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = expandEnvRefsDeep(inner, env);
    }
    return result as T;
  }
  return value;
}
