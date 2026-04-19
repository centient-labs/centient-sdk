# @centient/logger

Structured logging infrastructure for Centient packages. Provides structured logging with transport abstraction, context management, path/data sanitization, and audit event logging.

## Installation

```bash
npm install @centient/logger
```

Or with pnpm:

```bash
pnpm add @centient/logger
```

## Quick Start

```typescript
import { createLogger, ConsoleTransport } from "@centient/logger";

const logger = createLogger({ service: "my-service" });

// Simple message
logger.info("Application started");

// With context
logger.info({ userId: "123", action: "login" }, "User logged in");

// Error logging
logger.error({ err: new Error("Connection failed") }, "Database error");
```

### Reserved top-level fields

The logger reserves these field names for its own top-level entry shape and strips them if you pass them in context: `service`, `component`, `tool`, plus the always-computed `timestamp` / `level` / `message` / `pid` / `hostname`.

**Every other field name — including `version` — is yours.** Pass whatever makes sense for your domain. When you want per-line service version in logs, a common convention in the centient-labs ecosystem is `appVersion` (used by `@centient-labs/daemon`); `version`, `schemaVersion`, `buildSha` etc. are all valid too. Pick the name that's unambiguous to your log consumer.

> Prior to v1.0.0, `version` was silently reserved by the logger — any `version` in your context would be replaced with the logger-instance version (usually `"0.0.0"`). That reservation has been removed. See [issue #36](https://github.com/centient-labs/centient-sdk/issues/36).

> **AuditWriter note:** `AuditWriter` (also exported from this package) emits its own top-level `version` field on emitted audit events. That value is the **audit-event schema version** maintained internally by the writer, not a user context field — distinct from the `Logger` reservation policy above. If you're reading raw audit records and see a `version` key, it's the audit schema, not anything the caller passed.

## API

### Logger

The core logger interface provides six log levels: `trace`, `debug`, `info`, `warn`, `error`, and `fatal`.

#### `createLogger(options: LoggerOptions): Logger`

Create a new logger instance.

```typescript
import { createLogger } from "@centient/logger";

const logger = createLogger({
  service: "my-service",      // Required: service name
  level: "info",              // Optional: minimum level (default from LOG_LEVEL env)
  transport: new ConsoleTransport(), // Optional: output transport
  context: { env: "prod" },   // Optional: base context for all entries
});
```

#### `createComponentLogger(service, component, options?): Logger`

Create a logger with a specific component name.

```typescript
import { createComponentLogger } from "@centient/logger";

const logger = createComponentLogger("my-service", "database");
logger.info("Connection established");
// Output: ... INFO  [database] Connection established
```

#### `createToolLogger(service, toolName, options?): Logger`

Create a logger for MCP tools.

```typescript
import { createToolLogger } from "@centient/logger";

const logger = createToolLogger("centient", "search_patterns");
logger.debug({ query: "authentication" }, "Searching patterns");
```

#### `createSessionLogger(service, sessionId, projectPath, options?): Logger`

Create a logger with session context.

```typescript
import { createSessionLogger } from "@centient/logger";

const logger = createSessionLogger(
  "centient",
  "session-abc123",
  "/Users/dev/project"  // Path will be sanitized to ~/project
);
```

#### Logger Methods

All loggers support these methods:

```typescript
interface Logger {
  trace(message: string): void;
  trace(context: LogContext, message: string): void;
  debug(message: string): void;
  debug(context: LogContext, message: string): void;
  info(message: string): void;
  info(context: LogContext, message: string): void;
  warn(message: string): void;
  warn(context: LogContext, message: string): void;
  error(message: string): void;
  error(context: LogContext, message: string): void;
  fatal(message: string): void;
  fatal(context: LogContext, message: string): void;
  child(context: LogContext): Logger;
  close(): Promise<void>;
}
```

#### Child Loggers

Create child loggers that inherit parent context:

```typescript
const logger = createLogger({ service: "api" });
const requestLogger = logger.child({ requestId: "req-123" });

requestLogger.info("Processing request");
// All logs include requestId automatically
```

### Transports

#### ConsoleTransport

Writes to stderr with pretty or JSON formatting.

```typescript
import { ConsoleTransport } from "@centient/logger";

// Auto-detect format (pretty in development, JSON in production)
const transport = new ConsoleTransport();

// Force pretty output
const prettyTransport = new ConsoleTransport({ pretty: true });

// Force JSON output
const jsonTransport = new ConsoleTransport({ pretty: false });
```

#### FileTransport

Writes to a file with buffering and automatic rotation.

```typescript
import { FileTransport } from "@centient/logger";

const transport = new FileTransport({
  filePath: "/var/log/my-app.jsonl",  // Required: log file path
  maxSize: 50 * 1024 * 1024,          // Optional: 50MB rotation threshold
  maxFiles: 5,                         // Optional: rotated files to keep
  flushIntervalMs: 1000,               // Optional: buffer flush interval
  maxBufferSize: 100,                  // Optional: max buffered entries
});
```

#### NullTransport

Discards all output. Useful for testing or disabling logging.

```typescript
import { NullTransport } from "@centient/logger";

const transport = new NullTransport();
```

### AuditWriter

Write-only audit event logging for security and compliance.

```typescript
import { createAuditWriter } from "@centient/logger";

const auditWriter = createAuditWriter({
  version: "1.0.0",
  auditDir: "~/.engram/audit",        // Optional: default location
  maxFileSizeBytes: 50 * 1024 * 1024, // Optional: 50MB rotation
  retentionDays: 90,                   // Optional: cleanup threshold
});

// Log an audit event
const eventId = await auditWriter.log(
  "pattern_load",           // Event type
  "load_skill",             // Tool name
  "success",                // Outcome: "success" | "failure" | "partial"
  150,                      // Duration in ms
  {
    input: { skillId: "database/rls-policy" },
    output: { resultCount: 1 },
    projectPath: "/Users/dev/project",  // Will be sanitized
    context: { patternId: "database/rls-policy", version: "1.0.0" },
  }
);
```

#### Audit Event Types

```typescript
type AuditEventType =
  | "pattern_search" | "pattern_load" | "pattern_find" | "pattern_sign"
  | "skill_execute" | "pattern_index"
  | "pattern_version_create" | "pattern_version_deprecate"
  | "artifact_search" | "artifact_load" | "artifact_code_extract"
  | "session_start" | "session_note" | "session_search" | "session_finalize"
  | "research_plan" | "consultation"
  | "branch_create" | "branch_close"
  | "tool_call";
```

### Sanitization

Functions for removing sensitive data from logs.

#### `sanitizePath(filePath: string): string`

Replace home directory paths with `~`.

```typescript
import { sanitizePath } from "@centient/logger";

sanitizePath("/Users/john/project/file.ts");
// Returns: "~/project/file.ts"
```

#### `sanitizeError(error: unknown): string`

Extract and sanitize error messages.

```typescript
import { sanitizeError } from "@centient/logger";

try {
  // operation
} catch (error) {
  const safeMessage = sanitizeError(error);
}
```

#### `sanitizeForLogging(obj: T): T`

Recursively sanitize an object, redacting sensitive fields and API keys.

```typescript
import { sanitizeForLogging } from "@centient/logger";

const sanitized = sanitizeForLogging({
  apiKey: "sk-1234567890abcdefghijklmnop",
  projectPath: "/Users/john/projects/test",
  config: { password: "secret123" },
});
// Returns:
// {
//   apiKey: "[REDACTED]",
//   projectPath: "~/projects/test",
//   config: { password: "[REDACTED]" }
// }
```

#### `isSensitiveFieldName(fieldName: string): boolean`

Check if a field name indicates sensitive data.

```typescript
import { isSensitiveFieldName } from "@centient/logger";

isSensitiveFieldName("password");     // true
isSensitiveFieldName("userPassword"); // true
isSensitiveFieldName("api_key");      // true
isSensitiveFieldName("username");     // false
```

#### `createSanitizedErrorResponse(code, error, duration)`

Create a standardized sanitized error response.

```typescript
import { createSanitizedErrorResponse } from "@centient/logger";

return createSanitizedErrorResponse("FILE_READ_ERROR", error, 45);
// Returns:
// {
//   success: false,
//   error: { code: "FILE_READ_ERROR", message: "..." },
//   metadata: { tokensUsed: 0, duration: 45 }
// }
```

### Testing Utilities

#### `createTestLogger(component?, context?): TestLoggerResult`

Create a logger that captures output for test assertions.

```typescript
import { createTestLogger } from "@centient/logger";

const { logger, getEntries, getOutput, clear } = createTestLogger("my-component");

logger.info({ action: "test" }, "Test message");

const entries = getEntries();
expect(entries[0].message).toBe("Test message");
expect(entries[0].action).toBe("test");

clear(); // Reset for next test
```

#### `CaptureTransport`

Transport that stores log entries for inspection.

```typescript
import { CaptureTransport, createLogger } from "@centient/logger";

const transport = new CaptureTransport();
const logger = createLogger({ service: "test", transport });

logger.warn("Warning message");

expect(transport.hasMessage("Warning")).toBe(true);
expect(transport.getEntriesByLevel("warn")).toHaveLength(1);
```

#### `createSilentLogger(service?): Logger`

Create a logger that discards all output.

```typescript
import { createSilentLogger } from "@centient/logger";

const logger = createSilentLogger("test");
logger.info("This goes nowhere"); // No output
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | `info` |
| `LOG_PRETTY` | Force pretty (`true`) or JSON (`false`) output | Auto-detect |
| `NODE_ENV` | When `production`, defaults to JSON output | - |

### Log Entry Structure

All log entries follow this structure:

```typescript
interface LogEntry {
  timestamp: string;   // ISO 8601 timestamp
  level: LogLevel;     // trace, debug, info, warn, error, fatal
  component: string;   // Component name
  message: string;     // Log message
  service: string;     // Service name
  version: string;     // Service version
  pid: number;         // Process ID
  hostname: string;    // Machine hostname
  [key: string]: unknown; // Additional context
}
```

### Log Levels

| Level | Value | Use Case |
|-------|-------|----------|
| `trace` | 10 | Detailed debugging, function entry/exit |
| `debug` | 20 | Debugging information |
| `info` | 30 | Normal operational messages |
| `warn` | 40 | Warning conditions |
| `error` | 50 | Error conditions |
| `fatal` | 60 | Critical errors requiring shutdown |

## License

MIT
