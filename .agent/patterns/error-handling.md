<!-- cl-sync src=f14cdcfb -->
# Error Handling Pattern

Principles: P2 (No Silent Degradation), P8 (Idempotency), P11 (Explicit Uncertainty)

## Core Rule

**Return errors, don't throw them** (where language allows).

Explicit error handling makes control flow visible and forces callers to
handle failures.

## No Silent Degradation (P2)

Every error path must be distinguishable from a success path:

```typescript
// Good — caller can tell what happened
{ ok: false, error: { code: "DB_TIMEOUT", message: "Database unreachable" } }
{ ok: true, value: [], method: "fallback_cache" }  // degraded but truthful

// Bad — "no results" is ambiguous
{ results: [] }  // is this empty or broken?
```

**Rule:** Never return empty results when the operation failed. Surface the
failure mode.

## Structured Error Format

Errors should include:

- **code** — machine-readable identifier (e.g., `USER_NOT_FOUND`)
- **message** — human-readable description
- **component** — where the error originated (optional)
- **recovery** — what the caller should do (optional)

## Result Type Pattern

### TypeScript / JavaScript

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function findUser(id: string): Result<User, AppError> {
  const user = db.find(id);
  if (!user) {
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `User ${id} not found` } };
  }
  return { ok: true, value: user };
}
```

### Go

```go
func FindUser(id string) (*User, error) {
    user, err := db.Find(id)
    if err != nil {
        return nil, fmt.Errorf("finding user %s: %w", id, err)
    }
    return user, nil
}
```

### Python

```python
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")

@dataclass
class Ok(Generic[T]):
    value: T
    ok: bool = True

@dataclass
class Err:
    code: str
    message: str
    ok: bool = False

Result = Ok[T] | Err
```

## Idempotent Error Handling (P8)

Write operations that encounter duplicates are **not errors**:

```typescript
// Good — acknowledges the no-op
{ ok: true, value: existing, status: "already_exists" }

// Bad — throws on duplicate (non-exceptional condition)
throw new Error("duplicate key");
```

## Explicit Uncertainty (P11)

Distinguish between confirmed absence and uncertain absence:

```typescript
// Confirmed: we checked and it's not there
{ ok: true, value: null, searched: true }

// Uncertain: we couldn't check
{ ok: false, error: { code: "SERVICE_UNAVAILABLE" } }
```

## Guidelines

1. Handle errors at system boundaries (API endpoints, CLI commands)
2. Log errors with context at the boundary — never swallow silently
3. Wrap errors with additional context when propagating
4. Use typed errors for expected failure cases
5. Surface fallback paths: if using a cache instead of live data, say so
6. Distinguish "not found" from "couldn't look"

Repo-specific additions: see `error-handling-local.md` (loaded alongside this file).
