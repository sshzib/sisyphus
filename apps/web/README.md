# Hosted dashboard

The hosted dashboard has demo and authenticated modes. If all hosted-auth settings are absent, the app uses labeled sample data. If only some settings are present or any setting is invalid, the app refuses the partial setup.

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
