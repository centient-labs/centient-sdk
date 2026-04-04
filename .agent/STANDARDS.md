# Project Standards

## Design Philosophy

See `DESIGN-PHILOSOPHY.md` for the tiered principle system (14 principles across 3 tiers) that guides all architectural decisions. When principles conflict, refer to the tension resolution table.

## Critical Rules

> **See `../CLAUDE.md` § Critical Rules** — that file is the canonical source.
> Do not duplicate the rules here.

## TypeScript Standards

- Strict mode enabled, all strict flags on
- ES2022 target, NodeNext module resolution
- ESM-only (no CommonJS)
- No `any` types — use `unknown` for truly unknown
- Declaration maps and source maps required
- Node.js >= 20.0.0

## Code Quality

- Keep functions small and focused (P9: Composability)
- Prefer explicit over implicit (P5: Least Surprise)
- Handle errors at boundaries, never swallow silently (P2: No Silent Degradation)
- Write self-documenting code
- Return errors, don't throw them (see `patterns/error-handling.md`)

## API Design

- Same inputs produce same outputs (P5: Least Surprise)
- Write operations are idempotent (P8: Idempotency)
- Surface confidence and method, not just results (P10: Honest Uncertainty)
- Simple case simple, scale detail with complexity (P7: Progressive Disclosure)
- See `patterns/api-design.md` for full guidance

## Package Publishing

- All packages published under `@centient` npm scope
- Use Changesets for versioning — never bump versions manually
- Turbo orchestrates build order via `dependsOn: ["^build"]`
- WAL depends on logger (workspace protocol)

## Testing

- Vitest for all TypeScript packages
- Co-locate tests with source or in `tests/` directory
- Integration tests excluded from default run (vitest.config.ts)
- Coverage via @vitest/coverage-v8

## Cost Awareness (P11)

- Caching and deduplication are requirements, not optimizations
- Batch repeated operations instead of N+1 calls
- Track external API costs

## Documentation

- Update docs when changing behavior
- Record architectural decisions in ADRs, reference principles by number
- Keep README current
- Update CHANGELOG via changesets

## See Also

- `DESIGN-PHILOSOPHY.md` - Tiered design principles and tension resolution
- `constraints/security.md` - Security requirements (P14)
- `constraints/observability.md` - Logging, audit, cost tracking (P4, P11, P12, P13)
- `procedures/commits.md` - Commit workflow
- `patterns/error-handling.md` - Error handling (P2, P8, P10)
- `patterns/api-design.md` - API design (P5, P6, P7, P8, P9)

## Issue Tracking

Work is tracked via GitHub Issues, aggregated in the org project board: https://github.com/orgs/centient-labs/projects/1

**When you find a bug or issue you can't fix in the current task:**
```bash
gh issue create -R centient-labs/<this-repo> \
  --title "description" \
  --label "type/bug,priority/P2" \
  --project "Centient Labs"
```

**When your PR fixes an existing issue:**
Include `Closes #N` or `Fixes #N` in the PR body or commit message.

**Labels:**
- Type: `type/bug`, `type/feature`, `type/chore`, `type/docs`
- Priority: `priority/P0` (blocking), `priority/P1` (high), `priority/P2` (medium), `priority/P3` (low)
- Scope: `scope/infrastructure`, `scope/governance`, `scope/api`, `scope/pipeline`

**Full workflow:** See `support/standards/project-management.md`
