/**
 * File lock — native exclusive advisory lock for vault writes.
 *
 * Extracted from session-vault.ts (M3) so session-vault remains focused on
 * orchestration. The lock itself is filesystem-level (O_EXCL create on a
 * `.lock` file) and cooperative: it only protects against writers that call
 * `acquireWriteLock` before mutating.
 *
 * The lock file contains the holding process's PID so stale-lock stealing can
 * distinguish "our PID still owns it" from "the previous holder crashed." On
 * steal we write-and-verify to avoid two racing processes both thinking they
 * stole the same stale lock (M2).
 */

import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";

import { VaultLockError } from "./session-vault-errors.js";

/** Max time a writer will wait to acquire the file lock before giving up. */
export const LOCK_TIMEOUT_MS = 5_000;

/** Poll interval when waiting on a held lock. */
export const LOCK_RETRY_INTERVAL_MS = 25;

/** Stale-lock threshold — if a lock file is older than this, assume crash. */
export const LOCK_STALE_MS = 30_000;

/**
 * Acquire an exclusive write lock via O_EXCL on `{vaultPath}.lock`. Yields
 * the event loop between retries (no busy-spin) up to `LOCK_TIMEOUT_MS`.
 * Locks older than `LOCK_STALE_MS` are considered orphaned (the holding
 * process crashed) and stolen with a pid-verification handshake so two
 * concurrent stealers can't both claim ownership.
 *
 * Returns a release function. Releasing is idempotent and swallows ENOENT
 * (the lock file may have been stolen by another process after we already
 * finished our critical section — that's fine; the lockfile, not the fd,
 * is what matters).
 */
export async function acquireWriteLock(vaultPath: string): Promise<() => void> {
  const lockPath = `${vaultPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const ourPid = process.pid;
  const ourToken = `${ourPid}`;

  while (Date.now() < deadline) {
    // Attempt the happy path: create-exclusive.
    try {
      const fd = openSync(lockPath, "wx");
      try {
        // Write our pid so stale-lock stealing can verify ownership.
        writeFileSync(lockPath, ourToken);
      } catch {
        // Best-effort; even if we can't write pid, we still hold the lock.
      }
      // closeSync can throw on exotic filesystems; the lockfile — not the fd —
      // is what matters, so swallow errors here. The release closure unlinks
      // the file regardless (M2).
      try {
        closeSync(fd);
      } catch {
        // Non-fatal.
      }
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // Lock file may have been removed by stale-lock stealing in another
          // process; ignore — our critical section is over regardless.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // EEXIST: someone holds it. Check for staleness.
      try {
        const lockStat = statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          // Stale. Steal with a write-and-verify handshake so two racing
          // stealers can't both claim ownership. Whoever's token survives
          // the read-back wins.
          try {
            unlinkSync(lockPath);
          } catch {
            // Another process may have already stolen it; loop and retry.
            continue;
          }
          try {
            const fd = openSync(lockPath, "wx");
            try {
              writeFileSync(lockPath, ourToken);
            } catch {
              // Non-fatal; proceed to verification.
            }
            try {
              closeSync(fd);
            } catch {
              // Non-fatal.
            }
            // Verification: read back and confirm our token is there. If a
            // racer wrote first we'll see their token and back off.
            try {
              const recorded = readFileSync(lockPath, "utf8").trim();
              if (recorded !== ourToken) {
                // We lost the steal race; loop and retry normally.
                continue;
              }
            } catch {
              // Read failed — treat as loss and retry.
              continue;
            }
            return () => {
              try {
                unlinkSync(lockPath);
              } catch {
                // Same rationale as happy-path release.
              }
            };
          } catch (stealErr) {
            if ((stealErr as NodeJS.ErrnoException).code === "EEXIST") {
              // Another process stole it between our unlink and open; retry.
              continue;
            }
            throw stealErr;
          }
        }
      } catch {
        // statSync failed — lock was just released, or racing cleanup.
        // Fall through to sleep-and-retry.
      }

      // Held by a non-stale writer. Yield the event loop — do NOT busy-spin
      // (C1). This allows every other async task on this event loop to run
      // while we wait.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, LOCK_RETRY_INTERVAL_MS),
      );
    }
  }

  throw new VaultLockError(
    `Timed out after ${LOCK_TIMEOUT_MS}ms waiting for vault write lock at ${lockPath}`,
  );
}
