---
"@centient/events": minor
---

feat(events): built-in JSONL log rotation for `createJsonlSubscriber` / `createEventStream`

The JSONL subscriber appended forever — a 601 MB un-rotated `maintainer.jsonl`
was observed in production (#132). Rotation now lives next to the writer that
causes the growth, as an **opt-in** `rotation` option:

```ts
createEventStream<MyEvent>({ rotation: { maxSizeBytes: 100 * 1024 * 1024, maxFiles: 5 } });
createJsonlSubscriber<MyEvent>(path, { rotation: {} }); // {} = rotate with the defaults
```

- **Default off.** Omitting `rotation` leaves the log un-rotated, exactly as
  before. `EventStreamOptions.rotation` sets the default for subscribers created
  via `stream.jsonl()`; a per-call `jsonl(path, { rotation })` overrides it.
  Override is decided by **key presence**, not value, so
  `jsonl(path, { rotation: undefined })` switches rotation off for that one
  subscriber under a stream-wide default — the way to keep a log that must not
  be renamed (an external tailer, a compliance capture) out of the policy.
- **Rename, not copy-truncate.** The subscriber holds no persistent file
  descriptor (each flush is a discrete `O_APPEND` `appendFile`), so a rename is
  race-free against the writer — pre-rename flushes land whole lines in the
  rotated file and the next flush recreates the canonical path. Copy-truncate
  would lose everything written in its copy→truncate window.
- **Checked at a flush boundary**, immediately before the append. No periodic
  timer is needed, and a batch of lines is never split across two files.
- **Boot-time rotation** for a file left oversized by a previous process, seeded
  onto the flush chain so no append can race ahead of the rename.
- **Bounded retention.** `maxSizeBytes` defaults to 100 MiB, `maxFiles` to 5.
  Rotated names are `<file>.<UTC stamp>[-N]`, and the retention match is
  **anchored** to that exact shape — operator-made siblings
  (`events.jsonl.old`, `events.jsonl.1`, a hand-renamed
  `2026.06.13.events.jsonl`) are never swept.
- **Failures are logged, never thrown** (P2). Rotation is hygiene; a full disk
  or a read-only directory surfaces as a `warn` through the injected
  `EventsLogger` and the stream keeps running. Invalid settings are the one
  exception: they throw a `TypeError` at construction rather than being silently
  clamped.

Also adds `JsonlSubscriberOptions.clock` — a clock seam supplying both the `_ts`
stamp and rotated file names, so rotation is testable without wall-clock
dependence. `EventStream.jsonl()` now takes an optional second argument
(`JsonlSubscriberOptions`); the one-argument call is unchanged.

Config knob names and defaults map 1:1 onto the consumer-side mitigation shipped
in mbot#1569, so that seam-level implementation can be dropped for this one
without a config break.
