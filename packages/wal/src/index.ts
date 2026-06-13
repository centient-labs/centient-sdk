export {
  getWalPath,
  appendEntry,
  readEntries,
  confirmEntry,
  getUnconfirmedEntries,
  validateScopeId,
  compactWal,
  isWALEntry,
  cleanupOrphanedTempFiles,
} from "./wal.js";

export { replayUnconfirmed, replayAndCompact, clearRetryCounts } from "./replay.js";

export { atomicWrite, atomicAppendLine } from "./atomic-fs.js";

export type { AtomicWriteOptions } from "./atomic-fs.js";

export type {
  WALEntry,
  WALEntryType,
  WALEntryInput,
  WALAppendOptions,
  WALAppendResult,
  WALConfirmResult,
  WALReadResult,
  WALValidationResult,
  WALCompactResult,
  ReplayOptions,
  DeadLetterPayload,
  ReplayResult,
  ReplayEntryResult,
  ReplayAndCompactResult,
  WALExecutor,
} from "./types.js";
