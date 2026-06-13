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

export type { WalLogger } from "./logging.js";

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
  WALCleanupResult,
  WALCleanupFailure,
  ReplayOptions,
  DeadLetterPayload,
  ReplayResult,
  ReplayEntryResult,
  ReplayAndCompactResult,
  WALExecutor,
} from "./types.js";
