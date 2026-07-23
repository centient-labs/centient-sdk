/**
 * Retry with an injectable failure classifier.
 *
 * {@link withRetry} runs an async operation, sleeping on a {@link Backoff}
 * schedule between attempts, and retries ONLY the failures its `shouldRetry`
 * predicate accepts. Both seams are injected: the schedule owns the delays
 * (and therefore the randomness), the predicate owns the taxonomy, and
 * `sleep` owns the waiting — so the whole loop is deterministic under test.
 *
 * ## Why the predicate is injectable
 *
 * "Which errors are worth retrying" is a property of the CALLER's failure
 * domain, not of the retry mechanism. A client riding out an upstream
 * brownout wants request timeouts retried (they are the brownout's dominant
 * transient) and unknown errors NOT retried (an unclassifiable failure may be
 * a non-idempotent partial success, and replaying it duplicates a write). A
 * client fronting a pure, idempotent read may want the opposite. Baking
 * either stance in would make one of them wrong, so the classification is a
 * parameter.
 *
 * {@link isTransientError} is the packaged default: the conservative,
 * brownout-tolerant taxonomy above. {@link createTransientErrorPredicate}
 * builds variants of it (extra retryable codes, a caller-owned conflict
 * predicate, or the opposite stance on unknown errors).
 *
 * ## Taxonomy of {@link isTransientError}
 *
 * | Class                                       | Retried |
 * |---------------------------------------------|---------|
 * | Timeouts (`AbortError`/`TimeoutError`/`TIMEOUT`) | yes |
 * | 5xx (`statusCode >= 500`)                    | yes     |
 * | Network (`NETWORK_ERROR`/`ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`) | yes |
 * | 4xx (`statusCode` in `[400, 500)`), incl. 409 CAS conflicts | no |
 * | Schema validation (`ZodError`)               | no      |
 * | Anything else (unknown)                      | no      |
 *
 * 409 conflicts are non-retryable by the 4xx rule: blind replay of the same
 * `expectedVersion` can never succeed, and the caller's compare-and-set loop
 * owns conflict policy (re-read and reapply, give up, verify a peer won).
 *
 * ## Error propagation
 *
 * `withRetry` is transparent: once the attempts are exhausted (or the
 * predicate rejects a failure), the LAST error is re-thrown unchanged. No new
 * error shape is introduced, so a caller's existing failure handling stays
 * authoritative — this differs from the package's `Result`-returning
 * primitives because a retried operation's failure is the OPERATION's error,
 * not the retry mechanism's outcome.
 */

import type { Backoff } from "./backoff.js";
import type { Sleep } from "./clock.js";
import { systemSleep } from "./clock.js";

/**
 * Classifies a failure as worth retrying (`true`) or terminal (`false`).
 *
 * Called with the raw thrown value, which may be anything — a predicate must
 * tolerate non-`Error` throws.
 */
export type ShouldRetry = (error: unknown) => boolean;

/** Detail handed to {@link RetryConfig.onRetry} before each backoff sleep. */
export interface RetryAttemptInfo {
  /** The 1-based attempt that just failed. */
  readonly attempt: number;
  /** Total attempts configured (1 initial + retries). */
  readonly attempts: number;
  /** Sleep about to be taken, in ms. Can be 0 under full jitter. */
  readonly delayMs: number;
  /** The error that triggered the retry, unmodified. */
  readonly error: unknown;
}

/** Configuration for {@link withRetry}. */
export interface RetryConfig {
  /**
   * The delay schedule. Attempt `n`'s post-failure sleep is
   * `backoff.delayFor(n)`. Build one with `createBackoff`.
   */
  backoff: Backoff;
  /**
   * Total attempts (1 initial + `attempts - 1` retries). Must be an integer
   * >= 1.
   *
   * Defaults to the `backoff`'s own `budgetedAttempts` when it declared one,
   * and to 3 otherwise — a caller who stated the chain length once, on the
   * schedule, should not have to repeat it here. Passing a value ABOVE
   * `budgetedAttempts` still throws: a cumulative budget the loop can
   * silently overrun is not a budget.
   */
  attempts?: number;
  /**
   * Failure classifier (default: {@link isTransientError}). Returning `false`
   * ends the loop immediately and re-throws.
   */
  shouldRetry?: ShouldRetry;
  /** Sleep implementation (default: {@link systemSleep}). */
  sleep?: Sleep;
  /**
   * Observability hook, called once per retry BEFORE the sleep. Purely
   * informational — a throw from it propagates, so keep it total.
   */
  onRetry?: (info: RetryAttemptInfo) => void;
}

const DEFAULT_ATTEMPTS = 3;

/**
 * Run `op`, retrying failures the classifier accepts on the `backoff`
 * schedule. Re-throws the last error once attempts are exhausted, or
 * immediately when the classifier rejects a failure.
 *
 * Wrap ONE logical operation per call. Wrapping a pagination loop instead of
 * the per-page fetch multiplies the retry budget by the page count.
 *
 * @example
 * const backoff = createBackoff({
 *   baseDelayMs: 500, strategy: "exponential", factor: 2,
 *   maxDelayMs: 5_000, jitter: "full", attempts: 3, maxTotalDelayMs: 15_000,
 * });
 * const crystal = await withRetry(() => client.crystals.get(id), {
 *   backoff,
 *   onRetry: ({ attempt, delayMs, error }) => log.warn("retry", { attempt, delayMs, error }),
 * });
 */
export async function withRetry<T>(op: () => Promise<T>, config: RetryConfig): Promise<T> {
  const {
    backoff,
    // A budgeted schedule already states its chain length; take it as the
    // default rather than making the caller repeat it (a budget tighter than
    // DEFAULT_ATTEMPTS would otherwise throw on the ergonomic path).
    attempts = backoff.budgetedAttempts ?? DEFAULT_ATTEMPTS,
    shouldRetry = isTransientError,
    sleep = systemSleep,
    onRetry,
  } = config;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`withRetry: attempts must be an integer >= 1, got ${attempts}`);
  }
  if (backoff.budgetedAttempts !== undefined && attempts > backoff.budgetedAttempts) {
    throw new RangeError(
      `withRetry: attempts ${attempts} exceeds the backoff's budgeted ` +
        `${backoff.budgetedAttempts} — the cumulative delay budget would not hold`,
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = backoff.delayFor(attempt);
      onRetry?.({ attempt, attempts, delayMs, error });
      await sleep(delayMs);
    }
  }
  /* c8 ignore next 2 -- unreachable: the final attempt always returns or throws */
  throw lastError;
}

/** Options for {@link createTransientErrorPredicate}. */
export interface TransientErrorPredicateOptions {
  /**
   * Recognises caller-owned conflicts that must never be replayed (a
   * compare-and-set version conflict raised as a dedicated class rather than
   * a 409). Evaluated FIRST, ahead of every other rule.
   */
  isConflict?: (error: unknown) => boolean;
  /**
   * Additional `error.code` values treated as retryable, compared
   * case-insensitively (e.g. `["EAI_AGAIN", "EHOSTUNREACH"]`).
   */
  retryableCodes?: readonly string[];
  /**
   * Whether an error matching no rule is retried. Default `false` — an
   * unclassifiable failure may be a non-idempotent partial success, and
   * replaying it risks a duplicate write. Set `true` only when every wrapped
   * operation is genuinely idempotent.
   */
  retryUnknown?: boolean;
}

/** Codes that always mean "transient transport failure". */
const RETRYABLE_CODES = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

/** Message fragments (lowercased) that identify a transient failure. */
const RETRYABLE_MESSAGE_FRAGMENTS = [
  "request timed out",
  "internal server error",
  "econnrefused",
  "econnreset",
  "etimedout",
];

/**
 * Build a {@link ShouldRetry} implementing the taxonomy in this module's
 * header, with the supplied adjustments.
 *
 * @example A CAS-aware variant
 * const shouldRetry = createTransientErrorPredicate({
 *   isConflict: isCrystalVersionConflictError,
 * });
 */
export function createTransientErrorPredicate(
  options: TransientErrorPredicateOptions = {},
): ShouldRetry {
  const { isConflict, retryableCodes = [], retryUnknown = false } = options;
  const codes = new Set([
    ...RETRYABLE_CODES,
    ...retryableCodes.map((c) => c.toUpperCase()),
  ]);

  return function shouldRetry(error: unknown): boolean {
    // Conflicts first: they are the caller's to resolve, and a 409 carrying a
    // dedicated class may not expose a status code at all.
    if (isConflict?.(error) === true) return false;
    if (typeof error !== "object" || error === null) return retryUnknown;

    const name = (error as { name?: unknown }).name;
    // Schema-validation failures are deterministic — a retry re-fails identically.
    if (name === "ZodError") return false;

    // A status code is the strongest signal available, so it wins outright:
    // 5xx is the server's own transient, 4xx is the caller's deterministic bug.
    const statusCode = extractStatusCode(error);
    if (statusCode !== undefined) {
      if (statusCode >= 500) return true;
      if (statusCode >= 400) return false;
    }

    if (name === "AbortError" || name === "TimeoutError") return true;

    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code.toUpperCase())) return true;

    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message !== "" && RETRYABLE_MESSAGE_FRAGMENTS.some((f) => message.includes(f))) {
      return true;
    }

    return retryUnknown;
  };
}

/**
 * The packaged default classifier: timeouts, 5xx, and network failures are
 * retryable; 4xx (including 409 conflicts), schema-validation failures, and
 * unknown errors are not. See this module's header for the full taxonomy.
 */
export const isTransientError: ShouldRetry = createTransientErrorPredicate();

/**
 * Pull an HTTP status out of the shapes clients actually throw: a top-level
 * `statusCode` or `status`, or a nested `response.status`. Non-integer and
 * out-of-range values are ignored so a coincidental `status: "failed"` string
 * cannot be read as a code.
 */
function extractStatusCode(error: object): number | undefined {
  const candidates: unknown[] = [
    (error as { statusCode?: unknown }).statusCode,
    (error as { status?: unknown }).status,
  ];
  const response = (error as { response?: unknown }).response;
  if (typeof response === "object" && response !== null) {
    candidates.push((response as { status?: unknown }).status);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      if (candidate >= 100 && candidate < 600) return candidate;
    }
  }
  return undefined;
}
