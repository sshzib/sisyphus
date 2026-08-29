# Hosted dashboard

The hosted dashboard has demo and authenticated modes. If all hosted-auth settings are absent, the app uses labeled sample data from a `Demo workspace`. If only some settings are present or any setting is invalid, the app refuses the partial setup.

## Connect a control plane

Set these server-only variables:

- `SISYPHUS_WEB_API_URL` is the control-plane base URL.
- `SISYPHUS_WEB_ORIGIN` is the exact public origin of this Next.js app.
- `SISYPHUS_WEB_SESSION_KEY` is a base64-encoded 32-byte random key.

Generate a session key with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Production URLs must use HTTPS. Restart the app after you set the variables. Open the dashboard and enter a tenant access token in the connection form.

## Session security

The connection form posts to the same-origin Next.js server. The server checks the configured origin, validates the token with the control plane, and encrypts the token with AES-256-GCM. The browser receives an `HttpOnly`, `SameSite=Strict` cookie. Production cookies also use `Secure` and the `__Host-` prefix.

Browser requests call the same-origin server proxy. The browser never receives the bearer token after the exchange. Skill restoration also requires the exact configured origin and a per-session CSRF token.

Never put a bearer token or an administrator credential in a `NEXT_PUBLIC_*` variable. Next.js includes referenced public variables in browser JavaScript. Rotating `SISYPHUS_WEB_SESSION_KEY` invalidates all hosted sessions.

## Dashboard data boundaries

The hosted dashboard never receives full prompts, outputs, transcripts, tool payloads,
or deterministic evaluator stdout and stderr. The worker stores those values in its
encrypted local evidence vault. Cloud evidence excerpts are empty by default. A local
or signed policy must enable `redacted-excerpts`, select the permitted sources, and set
the maximum character count before an excerpt can appear in a cloud record.

The dashboard ranks agents only within an exact comparison cohort. The cohort includes
the runtime, runtime profile, adapter installation, runtime version, adapter version,
full capability snapshot, attribution class, and enforcement class. A change to any
input starts a new ranking.

Team quarantine uses the canonical skill-version ID instead. It intentionally combines
eligible verified outcomes from different runtimes. Before the service checks the
quarantine window, it keeps only the latest completion for each run and logical work
item.

The authenticated dashboard depends on the control plane's PostgreSQL deployment.
`pnpm verify` skips live migration and row-level security checks unless
`SISYPHUS_TEST_DATABASE_URL` points to a disposable PostgreSQL database. Run that live
suite for the target deployment before treating its migration and tenant isolation as
verified.
