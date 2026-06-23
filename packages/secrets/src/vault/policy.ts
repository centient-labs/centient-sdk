/**
 * SecretsPolicy — Middleware layer for credential operations.
 *
 * Policies are cross-cutting concerns (audit, rate limiting, access
 * control, attestation) applied to every credential operation via
 * `setSecretsPolicies([...])`. In 0.5.0 only the audit policy is
 * shipped; the API shape is designed to grow into the full policy
 * stack described in ADR-002.
 *
 * Execution model:
 *   1. `before` hooks run top-to-bottom. If one throws, the operation
 *      is aborted and the error propagates to the caller — but the
 *      `after` hooks of already-entered policies (those whose `before`
 *      hook already completed) still fire with a `*_rejected` event, so
 *      a policy-denied operation is audited rather than vanishing
 *      (ADR-002 §1.0.0). The rejecting policy's own `after` hook does
 *      not fire — its `before` hook did not complete.
 *   2. The backend operation executes.
 *   3. `after` hooks run bottom-to-top with a structured event
 *      describing the outcome. Exceptions in `after` hooks are
 *      swallowed with a one-time stderr warning — audit infrastructure
 *      failures must never break credential operations.
 */

import type { VaultType } from "./types.js";

// =============================================================================
// Event types
// =============================================================================

export type SecretsEventType =
  | "credential_read"
  | "credential_read_missing"
  | "credential_read_failed"
  | "credential_read_rejected"
  | "credential_written"
  | "credential_write_failed"
  | "credential_write_rejected"
  | "credential_deleted"
  | "credential_delete_failed"
  | "credential_delete_rejected"
  | "credential_enumerated"
  | "credential_enumerate_failed"
  | "credential_enumerate_rejected";

export interface SecretsEvent {
  type: SecretsEventType;
  timestamp: string;
  backend: VaultType;
  key?: string;
  keyCount?: number;
  prefix?: string;
  error?: string;
  durationMs: number;
}

// =============================================================================
// Operation type (what `before` hooks receive)
// =============================================================================

export interface SecretsOperation {
  type: "read" | "write" | "delete" | "enumerate";
  key?: string;
  prefix?: string;
}

/**
 * The audit event type emitted when a `before` hook rejects an
 * operation. Single source of truth for the operation→`*_rejected`
 * mapping, shared by the cascade vault and the session vault.
 */
export function rejectedEventType(op: SecretsOperation): SecretsEventType {
  switch (op.type) {
    case "read":
      return "credential_read_rejected";
    case "write":
      return "credential_write_rejected";
    case "delete":
      return "credential_delete_rejected";
    case "enumerate":
      return "credential_enumerate_rejected";
    default: {
      // Exhaustiveness guard: if a new SecretsOperation["type"] is added
      // without a case here, this assignment fails to compile.
      const unreachable: never = op.type;
      throw new Error(`unhandled operation type: ${String(unreachable)}`);
    }
  }
}

// =============================================================================
// Policy interface
// =============================================================================

export interface SecretsPolicy {
  readonly name: string;
  /** `before` hooks may be async; they are awaited before the operation runs. */
  before?(op: SecretsOperation): void | Promise<void>;
  /**
   * `after` hooks MUST be synchronous (return type is `void`, not
   * `Promise<void>`). The runner invokes them synchronously and catches
   * only synchronous throws — a `Promise` returned from an `after` hook
   * is not awaited, so its rejection would escape as an unhandled
   * rejection rather than being swallowed with the one-time warning. Do
   * audit I/O via a fire-and-forget sink the hook itself owns, or buffer
   * and flush outside the hook.
   */
  after?(event: SecretsEvent): void;
}

// =============================================================================
// Policy registry
// =============================================================================

let activePolicies: SecretsPolicy[] = [];
let afterWarningEmitted = false;

export function setSecretsPolicies(policies: SecretsPolicy[]): void {
  activePolicies = [...policies];
  afterWarningEmitted = false;
}

export function getActivePolicies(): readonly SecretsPolicy[] {
  return activePolicies;
}

/**
 * Run `before` hooks top-to-bottom. If a hook throws, the operation is
 * rejected: the `after` hooks of the already-entered policies (indices
 * `0..i-1`, bottom-to-top) fire with the event built by
 * `makeRejectionEvent` so the denied operation is still audited, then the
 * original error is re-thrown to abort the operation. The rejecting
 * policy's own `after` hook is intentionally skipped — its `before` hook
 * did not complete, so the policy was not fully entered. See ADR-002
 * §1.0.0.
 */
export async function runBeforeHooks(
  op: SecretsOperation,
  makeRejectionEvent: (error: string) => SecretsEvent,
): Promise<void> {
  for (let i = 0; i < activePolicies.length; i++) {
    const policy = activePolicies[i]!;
    if (!policy.before) continue;
    try {
      await policy.before(op);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runAfterHooksForRange(makeRejectionEvent(msg), i - 1);
      throw err;
    }
  }
}

export function runAfterHooks(event: SecretsEvent): void {
  runAfterHooksForRange(event, activePolicies.length - 1);
}

/**
 * Run `after` hooks for policies `fromIndex..0` (bottom-to-top). A
 * negative `fromIndex` is a no-op (no policy was entered). Synchronous
 * hook exceptions are swallowed best-effort with a one-time stderr
 * warning — audit-infrastructure failures must never break credential
 * operations. `after` hooks are synchronous by contract (see
 * `SecretsPolicy.after`); a hook that returns a rejected `Promise` is
 * not awaited here, so it would surface as an unhandled rejection.
 */
function runAfterHooksForRange(event: SecretsEvent, fromIndex: number): void {
  for (let i = fromIndex; i >= 0; i--) {
    const policy = activePolicies[i]!;
    if (policy.after) {
      try {
        policy.after(event);
      } catch (err) {
        if (!afterWarningEmitted) {
          afterWarningEmitted = true;
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[secrets] policy "${policy.name}" after-hook threw (swallowed): ${msg}\n`,
          );
        }
      }
    }
  }
}

// =============================================================================
// Built-in policies
// =============================================================================

export interface AuditTrailOptions {
  sink: (event: SecretsEvent) => void;
  includeReads?: boolean;
}

export function auditTrail(opts: AuditTrailOptions): SecretsPolicy {
  const includeReads = opts.includeReads ?? true;
  return {
    name: "auditTrail",
    after(event: SecretsEvent): void {
      if (
        !includeReads &&
        (event.type === "credential_read" ||
          event.type === "credential_read_missing")
      ) {
        return;
      }
      opts.sink(event);
    },
  };
}
