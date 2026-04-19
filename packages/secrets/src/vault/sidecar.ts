/**
 * Sidecar — rollback-protection metadata file I/O.
 *
 * Extracted from session-vault.ts (M3). The sidecar lives next to the vault
 * and stores the highest vault version ever observed; a subsequent open that
 * sees a lower version triggers rollback detection. Corrupt vs missing is
 * distinguished so callers can report meaningfully (L5).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** File mode for vault and sidecar files (POSIX). */
export const VAULT_FILE_MODE = 0o600;

/** Directory mode for the vault/sidecar parent directory (POSIX). */
export const VAULT_DIR_MODE = 0o700;

export interface SidecarContent {
  /** Highest vault version ever successfully observed. Monotonic. */
  highestSeenVersion: number;
}

/**
 * Read sidecar content. Returns null in two distinguishable cases:
 *   - file does not exist (silent — caller drives the missing-sidecar path),
 *   - file exists but is corrupt (emits a stderr warning — filesystem damage
 *     or partial write; caller treats as missing and auto-reinitializes).
 */
export function readSidecar(path: string): SidecarContent | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    process.stderr.write(
      `[secrets] WARNING: sidecar file ${path} exists but could not be read; treating as missing.\n`,
    );
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${path} is corrupt (not a JSON object); treating as missing.\n`,
      );
      return null;
    }
    const v = (parsed as { highestSeenVersion?: unknown }).highestSeenVersion;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${path} is corrupt (invalid highestSeenVersion); treating as missing.\n`,
      );
      return null;
    }
    return { highestSeenVersion: v };
  } catch {
    process.stderr.write(
      `[secrets] WARNING: sidecar file ${path} is corrupt (JSON parse failed); treating as missing.\n`,
    );
    return null;
  }
}

/**
 * Atomically write the sidecar with mode 0600. Uses temp-file-then-rename
 * so a crash during the write can't leave a half-written sidecar that would
 * fail JSON parse on the next open.
 */
export function writeSidecar(path: string, content: SidecarContent): void {
  mkdirSync(dirname(path), { recursive: true, mode: VAULT_DIR_MODE });
  const tmpPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(content), { mode: VAULT_FILE_MODE });
  renameSync(tmpPath, path);
}

/**
 * Check sidecar file mode; warn on stderr if not 0600.
 * Symmetric to the vault-file permission check — a world-readable sidecar
 * leaks version-number side-channel (write frequency, rollback attempts) and
 * signals that filesystem permissions around the vault are broken.
 */
export function checkSidecarPerms(path: string): void {
  if (!existsSync(path)) return;
  try {
    const st = statSync(path);
    const worldOrGroup = st.mode & 0o077;
    if (worldOrGroup !== 0) {
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${path} has permissive mode ` +
          `${(st.mode & 0o777).toString(8).padStart(3, "0")}; expected 600. ` +
          `Fix with: chmod 600 ${path}\n`,
      );
    }
  } catch {
    // Stat failure is handled by subsequent read attempts.
  }
}
