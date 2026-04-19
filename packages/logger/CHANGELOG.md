# @centient/logger

## 0.16.1

### Patch Changes

- b3afec7: `FileTransport` write-stream errors are no longer silently swallowed. Disk-full, EACCES, and other stream-level failures now surface to stderr with a `[FileTransport]` prefix so operators have a signal that logs are being lost. The process is not taken down; the transport behaves as before otherwise. This is the logger-of-last-resort path — writing to stderr avoids depending on the very transport that just failed.

## 0.16.0

### Minor Changes

- f678c29: Initial public release of @centient/logger, @centient/sdk, and @centient/wal.
  Extracted from centient monorepo for independent versioning and npm publishing.
