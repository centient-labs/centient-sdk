<!-- cl-sync src=45e004cb -->
# API Design Pattern

Principles: P5 (Least Surprise), P6 (Single Source of Truth), P7 (Progressive Disclosure), P8 (Idempotency), P9 (Composability)

## Response Contract

Every API response should let the caller understand what happened:

```typescript
// Good — caller knows what happened
{ ok: true, value: data, method: "exact_match" }
{ ok: false, error: { code: "NOT_FOUND", message: "..." } }

// Bad — caller can't tell if empty means "none exist" or "lookup failed"
{ results: [] }
```

## Idempotent Writes

Write operations should be safely repeatable:

```typescript
// Good — acknowledges no-op
async function createUser(email: string): Result<User> {
  const existing = await db.findByEmail(email);
  if (existing) {
    return { ok: true, value: existing, status: "already_exists" };
  }
  const user = await db.create({ email });
  return { ok: true, value: user, status: "created" };
}

// Bad — throws on duplicate, forcing caller to handle non-exceptional condition
async function createUser(email: string): User {
  return db.create({ email }); // throws "duplicate key" on retry
}
```

## Progressive Disclosure

The simple case should be simple. Scale detail with complexity:

```typescript
// Simple case — minimal response
{ ok: true, value: user }

// Ambiguous case — surface alternatives
{ ok: true, value: bestMatch, confidence: 0.72, alternatives: [...] }

// Error case — actionable detail
{ ok: false, error: { code: "VALIDATION", message: "...", field: "email" } }
```

## Single Source of Truth

- One authoritative store per data type
- Validate at system boundaries; trust internal data structures
- When sources disagree, surface the conflict — don't pick a winner silently
- Echo interpreted parameters so callers see what the system understood

## Composability

- Functions do one thing well
- Different responsibilities stay separate (search vs transform vs format)
- Same responsibility can be batched (search 20 items in one call)
- Callers compose workflows; functions don't assume context

Repo-specific additions: see `api-design-local.md` (loaded alongside this file).
