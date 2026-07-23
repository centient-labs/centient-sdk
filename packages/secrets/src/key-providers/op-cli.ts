/**
 * Shared 1Password `op` CLI helper (ADR-004 §6).
 *
 * Two independent layers call `op` for different purposes — `OnePasswordProvider`
 * for the vault *encryption key* (ADR-001) and `OnePasswordVault` for credential
 * *values* (ADR-004) — and before this module each carried its own copy of the
 * availability probe and its own `execFileSync` invocation. One source of truth
 * for how `op` is invoked, how long it may take, and what "available and
 * authenticated" means (P6).
 *
 * No dependency on `@1password/sdk` — `execFileSync` only, matching ADR-001's
 * zero-new-runtime-deps position.
 */

import { execFileSync } from "node:child_process";

// =============================================================================
// Timeouts
// =============================================================================

/** Probe calls (`--version`, `account list`) — fast or the CLI is unusable. */
export const OP_PROBE_TIMEOUT_MS = 5_000;

/** Metadata reads (`item get`, `item list`) — a network round-trip. */
export const OP_READ_TIMEOUT_MS = 15_000;

/** Mutations and secret reads — desktop-app approval may sit in front of these. */
export const OP_WRITE_TIMEOUT_MS = 30_000;

// =============================================================================
// Invocation
// =============================================================================

/** Options for {@link runOp}. */
export interface RunOpOptions {
  /**
   * Data piped to `op` on **stdin**. This is the argv-safe path for secret
   * values (ADR-004 §4): anything passed here is invisible to `ps`, unlike an
   * `field=value` argv element.
   */
  input?: string;
  /** Wall-clock timeout. Defaults to {@link OP_READ_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** A failed `op` invocation, with whatever the CLI wrote to stderr. */
export class OpCliError extends Error {
  constructor(
    /** The argv `op` was called with — never contains secret values. */
    public readonly args: readonly string[],
    /** `op`'s stderr, trimmed; empty when the process produced none. */
    public readonly stderr: string,
    /** The underlying spawn/exit error. Narrows `Error.cause` to this value. */
    public override readonly cause: unknown,
  ) {
    super(
      `op ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    );
    this.name = "OpCliError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * True when the failure is 1Password reporting the item simply is not there,
   * as opposed to an auth, network, or configuration problem.
   *
   * The distinction is load-bearing for ADR-004 §7: a not-found is a normal
   * `null`/`false` return, while an unexpected failure additionally warrants a
   * one-time stderr warning so a misconfiguration cannot stay silent (P2).
   * `op` has no stable exit code for this, so the message is the only signal.
   */
  get isNotFound(): boolean {
    return /(?:not found|isn't an item|no item matching|doesn't exist|item not found)/i.test(
      this.stderr,
    );
  }
}

/**
 * Invoke `op` and return its stdout, trimmed.
 *
 * @param args - argv after the binary. **Never** put a secret value here — pass
 *   it via {@link RunOpOptions.input} instead (ADR-004 §4).
 * @throws {@link OpCliError} on spawn failure, non-zero exit, or timeout.
 */
export function runOp(args: readonly string[], opts: RunOpOptions = {}): string {
  try {
    const out = execFileSync("op", [...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? OP_READ_TIMEOUT_MS,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
    return typeof out === "string" ? out.trim() : "";
  } catch (err) {
    throw new OpCliError(args, extractStderr(err), err);
  }
}

/** Pull stderr off an `execFileSync` failure without assuming its shape. */
function extractStderr(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string") return stderr.trim();
  if (Buffer.isBuffer(stderr)) return stderr.toString("utf8").trim();
  return "";
}

// =============================================================================
// Availability
// =============================================================================

/**
 * Whether the `op` CLI is present **and** authenticated.
 *
 * True when the binary is on `PATH` and either `OP_SERVICE_ACCOUNT_TOKEN` is
 * set (headless/CI mode, which needs no further check) or at least one account
 * is configured (desktop app or a prior `op signin`).
 *
 * This answers only "can we talk to 1Password?" — it says nothing about whether
 * a caller *should*. ADR-004's credential backend is opt-in precisely because
 * `op` being installed must never by itself route secrets into 1Password (§1);
 * that selection decision belongs to the caller, not here.
 */
export function detectOpCli(): boolean {
  try {
    runOp(["--version"], { timeoutMs: OP_PROBE_TIMEOUT_MS });
  } catch {
    return false;
  }

  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) return true;

  try {
    const output = runOp(["account", "list", "--format=json"], {
      timeoutMs: OP_PROBE_TIMEOUT_MS,
    });
    // `op` prints "[]" when no accounts are configured.
    return output !== "[]" && output.length > 2;
  } catch {
    return false;
  }
}
