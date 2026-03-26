/**
 * Null Transport
 *
 * Discards all log entries. Useful for testing or disabling logging.
 *
 * @module transports/NullTransport
 */

import type { Transport, LogEntry } from "../types.js";

/**
 * Transport that discards all log entries
 *
 * Use this transport when you want to completely disable logging output,
 * such as in tests where you don't want any log noise.
 */
export class NullTransport implements Transport {
  /**
   * Discard the log entry (no-op)
   */
  write(_entry: LogEntry): void {
    // Intentionally empty - discard all entries
  }

  /**
   * Flush is a no-op
   */
  async flush(): Promise<void> {
    // Nothing to flush
  }

  /**
   * Close is a no-op
   */
  async close(): Promise<void> {
    // Nothing to close
  }
}
