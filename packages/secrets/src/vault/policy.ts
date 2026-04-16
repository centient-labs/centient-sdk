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
 *   1. `before` hooks run top-to-bottom. If any throws, the operation
 *      is aborted and the error propagates to the caller.
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
  | "credential_written"
  | "credential_write_failed"
  | "credential_deleted"
  | "credential_delete_failed"
  | "credential_enumerated"
  | "credential_enumerate_failed";

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

// =============================================================================
// Policy interface
// =============================================================================

export interface SecretsPolicy {
  readonly name: string;
  before?(op: SecretsOperation): void | Promise<void>;
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

export async function runBeforeHooks(op: SecretsOperation): Promise<void> {
  for (const policy of activePolicies) {
    if (policy.before) await policy.before(op);
  }
}

export function runAfterHooks(event: SecretsEvent): void {
  for (let i = activePolicies.length - 1; i >= 0; i--) {
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
