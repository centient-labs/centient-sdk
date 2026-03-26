export {
  getWalPath,
  appendEntry,
  readEntries,
  confirmEntry,
  getUnconfirmedEntries,
  validateScopeId,
  compactWal,
  isWALEntry,
} from "./wal.js";

export { replayUnconfirmed, replayAndCompact } from "./replay.js";

export type {
  WALEntry,
  WALEntryType,
  WALEntryInput,
  WALAppendResult,
  WALConfirmResult,
  WALReadResult,
  WALValidationResult,
  WALCompactResult,
} from "./types.js";

export type {
  ReplayResult,
  ReplayEntryResult,
  ReplayAndCompactResult,
  WALExecutor,
} from "./replay.js";
