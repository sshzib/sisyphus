# Configure hosted user authentication

The hosted dashboard uses Supabase Auth for human users. Next.js keeps the user
session in Supabase SSR cookies and sends dashboard requests through the
same-origin proxy. The Fastify API verifies each Supabase access token before it
creates a tenant-scoped `AuthContext`.

The dashboard does not accept tenant access tokens from users. Worker and device
tokens continue to use the existing control-plane credential resolver.

## Configure the Supabase project

In the Supabase dashboard, open **Authentication > URL Configuration**.

1. Set **Site URL** to `http://localhost:3000` for local development.
2. Add `http://localhost:3000/auth/complete` to **Redirect URLs**.
3. Keep email sign-up enabled.

The custom email hook creates signed-token links to `/auth/confirm`. Signup
links establish the session and open the dashboard. Recovery links establish a
recovery session and continue directly to `/auth/update-password`.

## Configure branded email delivery

Supabase's Send Email Hook calls `supabase/functions/send-auth-email`. The
function verifies the Standard Webhooks signature, then sends these published
Resend template aliases:

| Auth action | Resend template | Variables |
| --- | --- | --- |
| Signup | `email-verification` | `name`, `verification_code`, `verification_url` |
| Signup | `welcome-email` | `name`, `dashboard_url`, `unsubscribe_url`, `privacy_url` |
| Recovery | `password-reset` | `name`, `reset_url` |

Deploy the function with JWT verification disabled, as configured in
`supabase/config.toml`. Set these Edge Function secrets in Supabase:

```dotenv
RESEND_API_KEY=re_replace_me
SEND_EMAIL_HOOK_SECRET=v1,whsec_replace_me
SISYPHUS_WEB_ORIGIN=http://localhost:3000
SISYPHUS_AUTH_EMAIL_FROM=Sisyphus Ai <noreply@sisyphusai.site>
SISYPHUS_PRIVACY_URL=http://localhost:3000/privacy
SISYPHUS_UNSUBSCRIBE_URL=http://localhost:3000/unsubscribe
```

In **Authentication > Hooks**, configure the **Send Email** hook with:

```text
https://yjwtcrmodiwhofruqzrn.supabase.co/functions/v1/send-auth-email
```

Use the same `SEND_EMAIL_HOOK_SECRET` in the hook and Edge Function. Keep the
Email Provider enabled. The hook replaces SMTP delivery while enabled. This
prototype intentionally supports the signup and recovery actions used by the
app; do not enable magic-link, invite, email-change, or reauthentication flows
until templates for those actions exist.

To send and inspect all three hosted templates against Resend's delivery test
addresses, run:

```powershell
$env:RESEND_API_KEY="re_replace_me"
$env:SISYPHUS_AUTH_EMAIL_FROM="Sisyphus Ai <noreply@sisyphusai.site>"
node scripts/verify-resend-auth-email.mjs
```

## Configure the web app

Create `apps/web/.env.local`:

```dotenv
SISYPHUS_WEB_API_URL=http://127.0.0.1:7330
SISYPHUS_WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
```

The publishable key is designed for browser use. Never put a Supabase secret key
or service-role key in a `NEXT_PUBLIC_*` variable.

## Configure the API

Set these variables in the shell that starts `@sisyphus/api`:

```dotenv
SISYPHUS_SUPABASE_URL=https://your-project.supabase.co
SISYPHUS_SUPABASE_DEFAULT_TENANT_ID=tenant-acme
SISYPHUS_SUPABASE_DEFAULT_ROLE=viewer
```

`SISYPHUS_SUPABASE_DEFAULT_TENANT_ID` is a prototype setting. When it is set,
every verified Supabase user without Sisyphus claims receives that tenant and
role. Omit the default tenant in a shared deployment. Assign
`sisyphus_tenant_id` and `sisyphus_role` in the user's trusted
`app_metadata` instead. Valid Sisyphus roles are `admin`, `member`, and
`viewer`.

The API ignores `user_metadata` for authorization.

## Start and check the flow

Start the API and the web app:

```sh
pnpm --filter @sisyphus/api dev
pnpm --filter @sisyphus/web dev
```

Open `http://localhost:3000`. Create an account, confirm the email, and sign
in. Then request a password reset and save a new password. The overview
dashboard opens only after both Supabase and the Sisyphus API accept the user
session.

## Security boundaries

The API validates the JWT signature, `ES256` algorithm, issuer, audience,
expiry, and subject against the Supabase project JWKS. Tenant and role values
come from trusted `app_metadata` or the explicit API default. The browser
cannot submit a tenant ID or role.

Browser data requests stay on the Next.js origin. State-changing proxy routes
also require the configured origin and a CSRF token derived from the verified
access token.

The hosted dashboard never receives full prompts, outputs, transcripts, tool
payloads, or deterministic evaluator output. The worker keeps those values in
its encrypted local evidence vault.
