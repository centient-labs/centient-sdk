/**
 * Console Transport
 *
 * Writes log entries to stderr using either pretty or JSON format.
 *
 * @module transports/ConsoleTransport
 */

import type { Transport, LogEntry, ConsoleTransportOptions } from "../types.js";
import { formatPretty, formatJson, isPrettyEnabled } from "../format.js";

/**
 * Transport that writes log entries to stderr
 *
 * Uses pretty (colored) output by default in non-production environments,
 * and JSON output in production.
 */
export class ConsoleTransport implements Transport {
  private pretty: boolean;

  constructor(options: ConsoleTransportOptions = {}) {
    this.pretty = options.pretty ?? isPrettyEnabled();
  }

  /**
   * Write a log entry to stderr
   */
  write(entry: LogEntry): void {
    const formatted = this.pretty ? formatPretty(entry) : formatJson(entry);
    // Use console.error to write to stderr (avoids stdout which may be used for MCP)
    // eslint-disable-next-line no-console
    console.error(formatted);
  }

  /**
   * Flush is a no-op for console output
   */
  async flush(): Promise<void> {
    // Console output is synchronous, nothing to flush
  }

  /**
   * Close is a no-op for console output
   */
  async close(): Promise<void> {
    // Nothing to close
  }
}
