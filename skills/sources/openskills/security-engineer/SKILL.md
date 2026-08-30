---
name: security-engineer
description: Expert application and infrastructure security guidance. Use when the user asks about OWASP Top 10, JWT review, RBAC, OAuth, threat modeling, SSRF, CSRF, XSS, or secret management.
---

# Security Engineering

Approach every security task as an engineer who has read real incident post-mortems and knows that most breaches are not exotic zero-days — they are OWASP Top 10 vulnerabilities that were known, understood, and skipped. Security is not a phase at the end of development. It is a design constraint applied from the first line of code.

---

## Step 0: Threat Model Before You Build

Before writing security controls, understand what you are protecting:

1. **What are the assets?** User data, credentials, financial records, proprietary algorithms — name them
2. **Who are the threat actors?** External attackers, malicious insiders, compromised dependencies, misconfigured services
3. **What are the attack surfaces?** API endpoints, authentication flows, file uploads, third-party integrations, admin interfaces
4. **What are the trust boundaries?** Where does data cross from untrusted to trusted? Every boundary needs validation
5. **What is the impact of a breach?** Data exposure, financial loss, regulatory penalty, reputational damage — prioritise controls by impact

Use STRIDE as a thinking tool: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege. For each component, ask which STRIDE categories apply.

---

## OWASP Top 10 — Mandatory Defenses

### A01 — Broken Access Control
- Deny by default — every resource is protected unless explicitly made public
- Verify ownership on every request — a user accessing `/api/documents/123` must own document 123
- Implement RBAC at the middleware layer — roles and permissions enforced before business logic runs
- Never trust client-supplied IDs for access decisions without server-side verification
- Log all access control failures — they are reconnaissance signals

### A02 — Cryptographic Failures
- Enforce HTTPS everywhere — redirect HTTP to HTTPS; HSTS header with long max-age
- Encrypt sensitive data at rest — AES-256 minimum
- Never store passwords in plaintext or with reversible encryption — bcrypt (cost ≥ 12) or argon2id
- Never store credit card numbers, SSNs, or equivalent PII unless absolutely required — tokenise instead
- Use strong, modern TLS — TLS 1.2 minimum, TLS 1.3 preferred; disable weak cipher suites

### A03 — Injection
- Parameterized queries for all database access — never interpolate user input into SQL
- Use an ORM as the default — raw queries only when performance requires it, with parameterization enforced
- Validate and sanitize all input at the API boundary — reject malformed input before it reaches business logic
- HTML-encode output in templates — use a templating engine that auto-escapes by default
- Avoid `eval()`, `exec()`, `os.system()`, shell interpolation with user data

### A04 — Insecure Design
- Security requirements belong in the design phase — add them to acceptance criteria, not as post-hoc patches
- Rate limit authentication endpoints — brute force is not sophisticated; stopping it is not optional
- Implement account lockout after repeated failed attempts with exponential backoff
- Multi-factor authentication for admin accounts and sensitive operations

### A05 — Security Misconfiguration
- Security headers on every HTTP response:
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```
- CORS: whitelist specific origins — never `Access-Control-Allow-Origin: *` for credentialed requests
- Disable debug endpoints, stack traces, and verbose error messages in production
- Remove default credentials and unused accounts before deploying
- Review cloud storage permissions — S3 buckets and blob containers are public by accident more often than by design

### A06 — Vulnerable and Outdated Components
- Dependency scanning in CI — `npm audit`, `pip audit`, Snyk, Dependabot
- Pin dependency versions — floating versions pull in breaking or vulnerable updates silently
- Review dependency changelogs before updating — automated updates can introduce breaking changes
- Remove unused dependencies — every dependency is an attack surface

### A07 — Identification and Authentication Failures
- JWT best practices (see JWT section below)
- Session tokens: cryptographically random, minimum 128 bits of entropy
- Invalidate sessions on logout — do not rely on token expiry alone
- Invalidate all sessions on password change
- Implement account lockout: 5 failed attempts → temporary lockout → exponential backoff
- Never log authentication tokens, passwords, or session identifiers

### A08 — Software and Data Integrity Failures
- Verify integrity of downloaded artifacts in CI — checksums, signatures
- Do not deserialize untrusted data without schema validation — avoid `pickle`, `eval`, unsafe YAML loaders
- Use subresource integrity (SRI) for CDN-hosted scripts
- Sign build artifacts and container images; verify signatures at deploy time

### A09 — Security Logging and Monitoring Failures
- Log all authentication events: success, failure, lockout, password reset
- Log all access control failures
- Log all admin actions
- Ship logs to a system the attacker cannot reach — a compromised server should not be able to erase its own audit trail
- Alert on: multiple failed logins, privilege escalation attempts, access to sensitive endpoints outside business hours

### A10 — Server-Side Request Forgery (SSRF)
- Validate and whitelist URLs before making server-side HTTP requests
- Reject requests to private IP ranges (10.x.x.x, 172.16.x.x, 192.168.x.x, 169.254.x.x, localhost)
- Use an allow-list of permitted external domains — not a block-list
- Never pass user-controlled data directly to HTTP clients, DNS resolvers, or file loaders

---

## JWT Review Checklist

When reviewing or implementing JWTs:

- [ ] Algorithm explicitly specified and validated — reject `alg: none`; use RS256 or ES256 for multi-service; HS256 only when the secret is shared safely
- [ ] Signature verified on every request — never decode without verifying
- [ ] `exp` claim present and validated — short-lived access tokens (15 minutes); longer refresh tokens (7-30 days)
- [ ] `iss` (issuer) and `aud` (audience) claims validated — prevent token reuse across services
- [ ] Refresh tokens rotated on use — a refresh token used twice indicates theft; invalidate both
- [ ] Refresh tokens stored securely — httpOnly cookie, not localStorage
- [ ] Token revocation strategy defined — short expiry is the simplest; token blacklist for immediate revocation needs
- [ ] Sensitive data not in the payload — JWTs are base64-encoded, not encrypted; do not store PII in claims

---

## OAuth 2.0 / OIDC

- Use the **Authorization Code flow with PKCE** for all user-facing applications — never the Implicit flow
- Use the **Client Credentials flow** for service-to-service authentication
- Validate the `state` parameter to prevent CSRF on the callback
- Validate `id_token` signature, `iss`, `aud`, `exp`, and `nonce`
- Store tokens in httpOnly cookies — not in JavaScript-accessible storage
- Request minimal scopes — principle of least privilege applies to OAuth scopes
- Validate redirect URIs strictly — registered URIs only, no open redirects

---

## RBAC Design

Role-Based Access Control done correctly:

1. **Define roles at the domain level** — not "admin/user" but "billing-admin", "content-editor", "read-only-viewer"
2. **Permissions are the unit of access control** — roles are collections of permissions; check permissions, not roles in business logic
3. **Deny by default** — a missing permission entry means no access
4. **Enforce at the middleware layer** — permission checks happen before handlers run, not inside them
5. **Resource ownership is a permission** — `order:read:own` (can read own orders) vs `order:read:any` (admin can read all orders)
6. **Audit permission assignments** — who granted this role, when, and why

```
User → has Roles → Roles contain Permissions → Permissions gate Resources
```

Never check roles in business logic. Check permissions. Roles are a UI concern.

---

## XSS Prevention

- React, Vue, Angular auto-escape by default — do not use `dangerouslySetInnerHTML` / `v-html` with untrusted content
- Sanitize HTML with DOMPurify before rendering any user-generated rich text
- Content Security Policy blocks inline scripts and untrusted sources — implement it
- `HttpOnly` flag on session cookies — JavaScript cannot read them
- `SameSite=Strict` or `SameSite=Lax` on all cookies

---

## CSRF Prevention

- `SameSite=Strict` on session cookies prevents CSRF for modern browsers
- For APIs: require a custom request header (e.g., `X-Requested-With: XMLHttpRequest`) — cross-origin requests cannot set custom headers
- For traditional form submissions: double-submit cookie or synchronizer token pattern
- Verify `Origin` and `Referer` headers on state-changing requests as a secondary check

---

## Secret Management

**Never:**
- Hardcode secrets in source code
- Commit `.env` files to version control
- Log secrets, tokens, or API keys
- Pass secrets as command-line arguments (visible in process list)
- Store secrets in environment variables on shared CI runners without scoping

**Always:**
- Use a secrets manager in production: AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, Doppler
- Rotate secrets on a schedule and immediately after any suspected exposure
- Scope secrets to the minimum surface — a service that reads from one bucket does not need write access
- Audit secret access — who accessed what secret, when

**In CI/CD:**
- Use platform-native secret storage (GitHub Secrets, GitLab CI Variables)
- Mask secret values in logs — configure the CI platform to redact known secret patterns
- Use short-lived credentials where possible — OIDC-based cloud authentication instead of long-lived keys

---

## Bundled Resources

Read [threat-model.md](./references/threat-model.md) when scoping a security review. Run `python scripts/scan_secrets.py <path>` only as a local, read-only first pass; confirm every finding manually and use dedicated secret-scanning tooling in CI.

## Definition of Done — Security Work

- [ ] Threat model documented for the feature or service
- [ ] OWASP Top 10 defenses applied relevant to the surface area
- [ ] All inputs validated and sanitized at the boundary
- [ ] Authentication and authorization enforced on every protected endpoint
- [ ] Secrets in a secrets manager — not in source code or environment files committed to git
- [ ] Security headers configured on all HTTP responses
- [ ] Dependency scan passing in CI
- [ ] Security logging in place for auth events and access control failures
- [ ] JWT/OAuth implementation reviewed against the checklist
