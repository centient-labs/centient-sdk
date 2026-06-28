<!-- migrated from .agent/constraints/security.md repo-specific region (ADR-005) -->
## Repo-specific (migrated — review)

<!-- Migrated from the repo's prior (older-template) security.md during the
     P16 sync. The generic sections below are superseded by the canonical
     content above and kept only for the npm-publishing rules specific to
     this package; trim the redundant parts on review. -->

# Security Constraints

Principles: P14 (Secure by Default), P12 (Auditability)

## Default Posture: Read-Only (P14)

External integrations are read-only unless explicitly configured for writes. Write operations require intentional approval flows — never escalate access implicitly.

## Secrets

### Never commit secrets
- API keys, tokens, passwords
- Private keys, certificates
- Database connection strings with credentials

### Use environment variables
```bash
# Good - reference from environment
DATABASE_URL=${DATABASE_URL}

# Bad - hardcoded
DATABASE_URL=postgres://user:password@host/db
```

### Required files
- `.env.example` - Template with placeholder values
- `.env` - Actual values (gitignored)

## Input Validation

### Validate at system boundaries (P14)
- API request handlers
- CLI argument parsing
- File uploads
- User-provided URLs

Internal code trusts its own data structures. Trust is established at ingestion, then carried forward.

### Sanitize paths
```typescript
// Good - resolve and verify
const resolved = path.resolve(userPath);
if (!resolved.startsWith(allowedBase)) {
  throw new Error('Invalid path');
}

// Bad - direct use
fs.readFile(userPath);
```

## Mutation Traceability (P12)

Every write operation must be auditable:
- Who requested the change
- What was changed (before/after)
- When it occurred
- Why (context, trigger)

This is a security requirement, not just compliance. Audit trails detect unauthorized changes and enable incident response.

## Cloud CLI Safety

### Blocked commands (without explicit permission)
- `fly deploy`, `fly secrets`
- `aws`, `gcloud`, `az`
- `vercel`, `netlify`
- `terraform apply`, `pulumi up`

### Allowed read-only operations
- `fly status`, `fly logs`
- Status checks and log viewing

## Dependency Security

- Review new dependencies before adding
- Keep dependencies updated
- Use lockfiles (package-lock.json, yarn.lock, etc.)
- Check for known vulnerabilities (`npm audit`)

## npm Publishing Security

- Never publish with embedded secrets
- Use npm provenance for supply chain integrity
- Changesets action handles publishing (not manual `npm publish`)
