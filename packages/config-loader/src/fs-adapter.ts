/**
 * Default Node-backed adapters for the injectable `FileSystem` and
 * `EnvProvider` surfaces. Splitting these out keeps the core resolver free of
 * any direct `node:fs` / `process` references, which is what makes the loader
 * exhaustively testable with in-memory fakes.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  statSync,
} from "node:fs";

import type { EnvProvider, FileSystem } from "./types.js";

/** Build a `FileSystem` backed by `node:fs`. */
export function createNodeFileSystem(): FileSystem {
  return {
    existsSync: (path) => existsSync(path),
    readFileSync: (path) => readFileSync(path, "utf-8"),
    writeFileSync: (path, data, mode) => {
      writeFileSync(path, data, mode === undefined ? "utf-8" : { encoding: "utf-8", mode });
    },
    mkdirSync: (path, mode) => {
      mkdirSync(path, mode === undefined ? { recursive: true } : { recursive: true, mode });
    },
    chmodSync: (path, mode) => chmodSync(path, mode),
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

/** Build an `EnvProvider` backed by `process.env`. */
export function createProcessEnv(): EnvProvider {
  return {
    get: (name) => process.env[name],
  };
}
