# Security Constraints

Principles: P15 (Secure by Default), P16 (Authority Outside the Sandbox)

## Trust Boundary

Derived from **P16 (Authority Outside the Sandbox)** in `DESIGN-PHILOSOPHY.md`.
This rule applies to any component that executes untrusted input. A repo that
runs untrusted input adds its concrete instantiation (which process is the
sandbox, which credentials are at stake, where the protected domain lives)
under `## Repo-specific`; a repo that never executes untrusted input inherits
the principle without an instantiation.

**The sandbox is whatever executes untrusted input** — PR- or agent-authored
code (build scripts, tests, package hooks), LLM output that can trigger tools
or privileged actions, and data/control inputs that can cause execution or
mutation: MCP tool arguments, webhook payloads, deserialized artifacts,
workflow/config files, package metadata, and template-expansion inputs.
Isolation (containers, VMs) protects the host *from* that code; it does **not**
protect secrets *co-resident with* it. Absent a separately enforced
intra-sandbox boundary (a sidecar secret broker in a distinct isolation
context, a distinct UID/namespace, one-shot brokered credentials, nested
sandboxing), assume anything inside the sandbox is reachable by the untrusted
input it processes — including read-only-mounted secrets and any scoped token
(assume a token is exfiltratable the moment it enters the sandbox). The trust
question is never "is this in-sandbox process trustworthy?" but "what else
shares the sandbox?"

Therefore:

- **High-value credentials** — long-lived, cross-repo, able to mint other
  credentials, write a protected branch, sign commits, deploy/release/publish,
  or persist governance state — live in a **protected trust domain that never
  executes untrusted input** (a host process, a sidecar broker, a separate
  runner). Never in the sandbox.
- **Privileged, irreversible actions** — commit signing, merge to a protected
  branch, deploy/release/publish, governance-state mutation — execute in that
  protected domain, not the sandbox.
- **Sandboxed components receive only** low-authority, scoped, short-lived,
  revocable tokens — and because even those are assumed exfiltratable, the
  token itself must not grant a privileged action.

**"Protected" is a positive requirement, not just "outside the sandbox."** The
protected domain is separately isolated from the sandbox's filesystem,
environment, process namespace, and credential material, and it accepts only
constrained, policy-checked requests from the sandbox — never raw untrusted
code, templates, deserialization payloads, or arbitrary command arguments. A
broker that sits beside the sandbox but shares its filesystem/env, or that
forwards unconstrained requests, is not a protected domain.

**Litmus test:** Does this credential or privileged action live in a domain
that executes untrusted input? If yes, it is on the wrong side of the boundary.

## Secrets

### Never commit

- API keys, tokens, passwords
- Private keys, certificates
- Database connection strings with credentials
- OAuth tokens, refresh tokens, session IDs

### .gitignore patterns

```gitignore
# Secrets — never commit
*.env
*.env.*
config.local.json
**/secrets/**
*.pem
*.key
```

### Reference from environment, never hardcode

```bash
# Good
DATABASE_URL=${DATABASE_URL}

# Bad
DATABASE_URL=postgres://user:password@host/db
```

```typescript
// Bad — hardcoded
const API_KEY = "sk-abc123...";

// Bad — logging secrets
console.error(`Using API key: ${apiKey}`);

// Good — from config
const { apiKey } = getConfig();
```

### Required files

- `.env.example` — template with placeholder values (committed)
- `.env` — actual values (gitignored)

### Pre-commit check

```bash
git diff --staged | grep -iE "(api_key|password|secret|token|credential)" && echo "WARNING: possible secrets detected"
```

## Input Validation

### Validate at system boundaries

- API request handlers
- CLI argument parsing
- File uploads
- User-provided URLs
- MCP tool arguments

### Path sanitization

```typescript
import path from "path";

function validatePath(userPath: string, allowedBase: string): boolean {
  const resolved = path.resolve(allowedBase, userPath);
  return resolved.startsWith(allowedBase);
}

// Usage
if (!validatePath(requestedFile, projectRoot)) {
  return errorResponse("INVALID_PATH", "Path outside allowed directory");
}
```

### Sanitize home-directory paths in output

```typescript
function sanitizePath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// Bad — exposes username
console.error(`File not found: /Users/john/project/file.txt`);

// Good — sanitized
console.error(`File not found: ${sanitizePath(absolutePath)}`);
```

## Error Sanitization

Never expose stack traces, queries, or internal paths in error responses:

```typescript
// Bad
return { error: { message: error.stack } };

// Good
return {
  error: {
    code: "INTERNAL_ERROR",
    message: sanitizeError(error),
  },
};
```

## Cloud CLI Restrictions

**AI assistants must NOT execute cloud deployment commands.** Deployments are
human-initiated only. Blocked unless the human explicitly invokes:

| CLI | Service |
|-----|---------|
| `fly`, `flyctl` | Fly.io |
| `vercel` | Vercel |
| `aws` | Amazon Web Services |
| `gcloud` | Google Cloud |
| `az` | Microsoft Azure |
| `firebase` | Firebase |
| `supabase` | Supabase |
| `wrangler` | Cloudflare Workers |
| `terraform apply`, `pulumi up` | IaC apply |

Read-only operations (`fly status`, `fly logs`) are allowed. Apply/deploy
operations require human invocation.

## Dependency Security

- Review new dependencies before adding
- Keep dependencies updated
- Always commit lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `uv.lock`)

## GitHub Actions

See `support/standards/ci-security-policy.md` for the full policy. Summary:

- Pin all third-party actions to a full commit SHA, never a tag
- Never hardcode secrets in workflow files
- Use least-privilege `permissions:` in workflow files

## Security Checklist

Before committing:

- [ ] No API keys or secrets in code
- [ ] No hardcoded credentials
- [ ] Paths sanitized in error messages
- [ ] User input validated at boundaries
- [ ] Error messages don't expose internals
- [ ] Sensitive fields redacted in logs

## Reporting Security Issues

If you discover a security vulnerability:

1. Do NOT create a public issue
2. Contact maintainers directly
3. Allow reasonable time for fix before disclosure

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
