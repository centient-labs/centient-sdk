export { runProcess } from "./run.js";

export { ProcError, isProcError } from "./error.js";
export type { ProcErrorContext } from "./error.js";

export {
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_MAX_BYTES,
} from "./types.js";

export type {
  Clock,
  ProcErrorKind,
  ProcResult,
  RunOptions,
  SpawnImpl,
  TimerHandle,
} from "./types.js";
