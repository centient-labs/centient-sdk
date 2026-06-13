# @centient/config-loader

Layered configuration resolution for Centient packages. Resolves a single value
per key across four layers — **environment variables > project config file >
user config file > defaults** — with caching, non-fatal warnings, write-back to
the user layer, tilde-app path helpers, and walk-up project-root discovery.

Zero runtime dependencies. The filesystem, environment, home directory, and
logger are all injectable, so the whole loader is testable without touching real
disk or process state.

## What this package does NOT do

It **resolves and layers** — it does **not validate domain shapes**. Validation
schemas stay in the consumer. If you need an env string coerced into a typed
value before it participates in precedence, supply a per-key `EnvCoercer`; that
is the only place the loader inspects a value's shape.

## Installation

```bash
npm install @centient/config-loader
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/config-loader --workspace
```

## Precedence

Highest to lowest. The first layer that supplies a key wins, and the resolved
value carries its source for diagnostics.

| Priority | Layer | Source |
|----------|-------|--------|
| 1 (highest) | `env` | Environment variables — **only** keys you bind via `envBindings` |
| 2 | `project` | `.{appName}.json`, located by walking up from `cwd` |
| 3 | `user` | `~/.{appName}/config.json` |
| 4 (lowest) | `default` | The `defaults` option |

### No silent fallthrough

A config file that **exists but cannot be parsed** is a hard `ConfigError` —
never a silent skip to the next layer (no-silent-degradation principle). A
**missing** file is a legitimate empty layer. An `EnvCoercer` that throws on a
malformed env override is likewise a `ConfigError`, not a dropped value.

## Quick Start

```typescript
import { createConfigLoader } from "@centient/config-loader";

const loader = createConfigLoader({
  appName: "centient",
  defaults: {
    "engram.url": "http://localhost:3100",
    "engram.timeoutMs": 10000,
  },
  envBindings: {
    "engram.url": { env: "ENGRAM_URL" },
    "engram.timeoutMs": {
      env: "CENTIENT_ENGRAM_TIMEOUT_MS",
      coerce: (raw) => {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`must be a non-negative integer; got "${raw}"`);
        }
        return n;
      },
    },
  },
});

// Highest-precedence value for a dotted key.
const url = loader.get<string>("engram.url");

// ...with provenance ("env" | "project" | "user" | "default").
const resolved = loader.getResolved<number>("engram.timeoutMs");
// => { value: 10000, source: "default" }
```

### Keys are dotted; files are nested

Defaults use a flat dotted keyspace; config files use ordinary nested JSON. The
loader flattens files to the same dotted keys before layering, so a default and
a nested file value for the same logical key always collide correctly.

```jsonc
// ~/.centient/config.json
{ "engram": { "url": "http://user-host:3100" } }
// resolves the key "engram.url"
```

### Environment-reference expansion

String values inside config files support `${VAR}` and `${VAR:-default}`
expansion. An empty env var is treated as unset and falls back to the default.

```jsonc
{ "logs": { "path": "${CENTIENT_LOGS:-~/.centient/logs}" } }
```

## Write-back

`write()` merges a partial (flat or nested) over the current **user** config
file and persists it. The app home is created `0o700`, the file written `0o600`,
and unrelated keys are preserved. Env-sourced values are never written —
write-back targets the user layer only.

```typescript
loader.write({ "engram.apiKey": "...", "engram.userId": "u-1" });
```

## Path helpers

```typescript
import { resolveAppHome, ensureAppHome, expandTilde } from "@centient/config-loader";

// Resolve ~/.centient (or a CENTIENT_HOME override).
const home = resolveAppHome({ appName: "centient", homeDir });

// Create it 0o700, or tighten it if it already exists with looser bits.
ensureAppHome(fs, home);

expandTilde("~/data", "/home/u"); // -> "/home/u/data"
```

## Project-root discovery

`discoverProjectRoot` walks up from a start directory looking for the project
config file, any configured marker (default `[".git"]`), or a `package.json`
with a `workspaces` field. Returns `{ root, configPath }`, both `null` when
nothing matches before the filesystem root.

```typescript
import { discoverProjectRoot, createNodeFileSystem } from "@centient/config-loader";

const { root, configPath } = discoverProjectRoot(createNodeFileSystem(), {
  startDir: process.cwd(),
  configFilename: ".centient.json",
  markers: [".git"],
});
```

## Caching

Resolution is computed once and cached. Call `reload()` to recompute after a
file changes; `write()` invalidates the cache automatically.

## Testing your integration

Inject in-memory `fs`/`env` (and a fixed `homeDir`/`cwd`) to make resolution
fully deterministic:

```typescript
const loader = createConfigLoader({
  appName: "centient",
  fs: myInMemoryFs,
  env: { get: (n) => myEnv[n] },
  homeDir: "/home/tester",
  cwd: "/proj",
});
```

## API

| Export | Kind | Purpose |
|--------|------|---------|
| `createConfigLoader(options)` | factory | Build a layered loader |
| `ConfigLoader` | type | `get` / `getResolved` / `has` / `snapshot` / `reload` / `write` |
| `ConfigError`, `ConfigErrorCode` | error | Typed resolution failures |
| `discoverProjectRoot` | fn | Walk-up project-root discovery |
| `expandTilde`, `resolveAppHome`, `ensureAppHome` | fn | Tilde-app path helpers |
| `expandEnvRefs`, `expandEnvRefsDeep` | fn | `${VAR}` expansion |
| `flatten`, `unflatten` | fn | Dotted-key <-> nested conversion |
| `createNodeFileSystem`, `createProcessEnv` | fn | Default Node adapters |
| `APP_HOME_MODE` (`0o700`), `CONFIG_FILE_MODE` (`0o600`) | const | Enforced perms |

## License

MIT
