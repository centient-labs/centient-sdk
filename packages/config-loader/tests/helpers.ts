/**
 * In-memory test doubles for the injectable `FileSystem` / `EnvProvider`.
 *
 * The fake fs models a flat path -> content map plus a set of directory paths
 * and a per-path mode map, which is enough to exercise existence, read/write,
 * recursive mkdir, chmod, and the 0o700 permission assertions without ever
 * touching real disk.
 */

import { dirname } from "node:path";

import type { EnvProvider, FileSystem } from "../src/types.js";

export interface MemFs extends FileSystem {
  /** Seed or overwrite a file's content directly. */
  setFile(path: string, content: string): void;
  /** Seed a directory directly (recursive). */
  setDir(path: string): void;
  /** Inspect the recorded mode for a path (undefined if never set). */
  modeOf(path: string): number | undefined;
  /** Read a file's content directly (test assertion convenience). */
  contentOf(path: string): string | undefined;
}

export function createMemFs(): MemFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const modes = new Map<string, number>();

  function addDirTree(path: string): void {
    let current = path;
    while (current && !dirs.has(current)) {
      dirs.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return {
    existsSync: (path) => files.has(path) || dirs.has(path),
    readFileSync: (path) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    writeFileSync: (path, data, mode) => {
      addDirTree(dirname(path));
      files.set(path, data);
      if (mode !== undefined) {
        modes.set(path, mode);
      }
    },
    mkdirSync: (path, mode) => {
      addDirTree(path);
      if (mode !== undefined) {
        modes.set(path, mode);
      }
    },
    chmodSync: (path, mode) => {
      modes.set(path, mode);
    },
    isDirectory: (path) => dirs.has(path),
    setFile: (path, content) => {
      addDirTree(dirname(path));
      files.set(path, content);
    },
    setDir: (path) => addDirTree(path),
    modeOf: (path) => modes.get(path),
    contentOf: (path) => files.get(path),
  };
}

export function createMemEnv(values: Record<string, string | undefined> = {}): EnvProvider {
  return {
    get: (name) => values[name],
  };
}
