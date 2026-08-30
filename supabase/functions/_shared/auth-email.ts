const DEFAULT_SENDER = "Sisyphus Ai <noreply@sisyphusai.site>";
const DEFAULT_WEB_ORIGIN = "http://localhost:3000";

export const AUTH_EMAIL_TEMPLATE_ALIASES = {
  passwordReset: "password-reset",
  verification: "email-verification",
  welcome: "welcome-email",
} as const;

type AuthEmailAction = "recovery" | "signup";
type TemplateAlias = (typeof AUTH_EMAIL_TEMPLATE_ALIASES)[
  keyof typeof AUTH_EMAIL_TEMPLATE_ALIASES
];

export type AuthEmailConfiguration = Readonly<{
  hookSecret: string;
  privacyUrl: string;
  resendApiKey: string;
  sender: string;
  unsubscribeUrl: string;
  webOrigin: string;
}>;

export type AuthEmailConfigurationInput = Readonly<{
  hookSecret: string | undefined;
  privacyUrl: string | undefined;
  resendApiKey: string | undefined;
  sender: string | undefined;
  unsubscribeUrl: string | undefined;
  webOrigin: string | undefined;
}>;

export type AuthEmailHook = Readonly<{
  action: AuthEmailAction;
  email: string;
  name: string;
  token: string | undefined;
  tokenHash: string;
  userId: string;
}>;

type TemplateVariables = Readonly<Record<string, string>>;

export type PlannedAuthEmail = Readonly<{
  idempotencyKey: string;
  request: Readonly<{
    from: string;
    subject: string;
    tags: ReadonlyArray<Readonly<{ name: string; value: string }>>;
    template: Readonly<{
      id: TemplateAlias;
      variables: TemplateVariables;
    }>;
    to: readonly [string];
  }>;
}>;

export function parseAuthEmailConfiguration(
  input: AuthEmailConfigurationInput,
): AuthEmailConfiguration {
  const resendApiKey = requireString(
    input.resendApiKey,
    "RESEND_API_KEY",
    20,
    256,
  );
  if (!resendApiKey.startsWith("re_")) {
    throw new Error("RESEND_API_KEY must start with re_.");
  }

  const fullHookSecret = requireString(
    input.hookSecret,
    "SEND_EMAIL_HOOK_SECRET",
    24,
    512,
  );
  const hookSecretPrefix = "v1,whsec_";
  if (!fullHookSecret.startsWith(hookSecretPrefix)) {
    throw new Error("SEND_EMAIL_HOOK_SECRET has an invalid format.");
  }

  const webOrigin = parseWebOrigin(input.webOrigin ?? DEFAULT_WEB_ORIGIN);
  return {
    hookSecret: fullHookSecret.slice(hookSecretPrefix.length),
    privacyUrl: parseHttpUrl(
      input.privacyUrl ?? new URL("/privacy", webOrigin).toString(),
      "SISYPHUS_PRIVACY_URL",
    ),
    resendApiKey,
    sender: parseSender(input.sender ?? DEFAULT_SENDER),
    unsubscribeUrl: parseHttpUrl(
      input.unsubscribeUrl ?? new URL("/unsubscribe", webOrigin).toString(),
      "SISYPHUS_UNSUBSCRIBE_URL",
    ),
    webOrigin,
  };
}

export function parseAuthEmailHookPayload(input: unknown): AuthEmailHook {
  const payload = requireRecord(input, "hook payload");
  const user = requireRecord(payload.user, "hook user");
  const emailData = requireRecord(payload.email_data, "hook email_data");
  const rawAction = requireString(
    emailData.email_action_type,
    "email_action_type",
    1,
    64,
  );
  if (rawAction !== "signup" && rawAction !== "recovery") {
    throw new Error(`Unsupported email action: ${rawAction}.`);
  }

  const userId = requireString(user.id, "user.id", 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(userId)
  ) {
    throw new Error("user.id must be a UUID.");
  }

  const email = requireString(user.email, "user.email", 3, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("user.email must be a valid email address.");
  }

  const tokenHash = requireString(
    emailData.token_hash,
    "token_hash",
    16,
    2_000,
  );
  const token = rawAction === "signup"
    ? requireString(emailData.token, "token", 1, 256)
    : undefined;

  return {
    action: rawAction,
    email,
    name: readDisplayName(user.user_metadata),
    token,
    tokenHash,
    userId,
  };
}

export function planAuthEmails(
  hook: AuthEmailHook,
  configuration: AuthEmailConfiguration,
): PlannedAuthEmail[] {
  const confirmationUrl = new URL("/auth/confirm", configuration.webOrigin);
  confirmationUrl.searchParams.set("token_hash", hook.tokenHash);
  confirmationUrl.searchParams.set("type", hook.action);

  if (hook.action === "recovery") {
    return [
      plannedEmail({
        configuration,
        email: hook.email,
        idempotencyKey: `sisyphus/recovery/${hook.tokenHash}`,
        subject: "Reset your Sisyphus password",
        tag: "auth_recovery",
        template: AUTH_EMAIL_TEMPLATE_ALIASES.passwordReset,
        variables: {
          name: hook.name,
          reset_url: confirmationUrl.toString(),
        },
      }),
    ];
  }

  if (hook.token === undefined) {
    throw new Error("Signup email planning requires a verification token.");
  }

  return [
    plannedEmail({
      configuration,
      email: hook.email,
      idempotencyKey: `sisyphus/signup/${hook.tokenHash}`,
      subject: "Verify your Sisyphus email",
      tag: "auth_verification",
      template: AUTH_EMAIL_TEMPLATE_ALIASES.verification,
      variables: {
        name: hook.name,
        verification_code: hook.token,
        verification_url: confirmationUrl.toString(),
      },
    }),
    plannedEmail({
      configuration,
      email: hook.email,
      idempotencyKey: `sisyphus/welcome/${hook.userId}`,
      subject: "Welcome to Sisyphus",
      tag: "auth_welcome",
      template: AUTH_EMAIL_TEMPLATE_ALIASES.welcome,
      variables: {
        dashboard_url: new URL("/", configuration.webOrigin).toString(),
        name: hook.name,
        privacy_url: configuration.privacyUrl,
        unsubscribe_url: configuration.unsubscribeUrl,
      },
    }),
  ];
}

function plannedEmail(
  input: Readonly<{
    configuration: AuthEmailConfiguration;
    email: string;
    idempotencyKey: string;
    subject: string;
    tag: string;
    template: TemplateAlias;
    variables: TemplateVariables;
  }>,
): PlannedAuthEmail {
  return {
    idempotencyKey: input.idempotencyKey,
    request: {
      from: input.configuration.sender,
      subject: input.subject,
      tags: [
        { name: "category", value: input.tag },
        { name: "environment", value: "authentication" },
      ],
      template: {
        id: input.template,
        variables: input.variables,
      },
      to: [input.email],
    },
  };
}

function readDisplayName(input: unknown): string {
  if (!isRecord(input)) return "Developer";
  const candidate = typeof input.name === "string"
    ? input.name
    : typeof input.full_name === "string"
    ? input.full_name
    : undefined;
  if (candidate === undefined) return "Developer";
  const normalized = candidate.trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return "Developer";
  }
  return normalized;
}

function parseSender(input: string): string {
  const sender = input.trim();
  if (
    sender.length > 320 ||
    !/^Sisyphus(?: Ai)? <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/u.test(sender)
  ) {
    throw new Error(
      "SISYPHUS_AUTH_EMAIL_FROM must be a branded mailbox sender.",
    );
  }
  return sender;
}

function parseWebOrigin(input: string): string {
  const url = parseHttpUrl(input, "SISYPHUS_WEB_ORIGIN");
  const parsed = new URL(url);
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("SISYPHUS_WEB_ORIGIN must contain only an origin.");
  }
  return parsed.origin;
}

function parseHttpUrl(input: string, name: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${name} must not contain credentials.`);
  }
  const loopback = url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS or an HTTP loopback address.`);
  }
  return url.toString();
}

function requireString(
  input: unknown,
  name: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof input !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  const value = input.trim();
  if (value.length < minimumLength || value.length > maximumLength) {
    throw new Error(`${name} has an invalid length.`);
  }
  return value;
}

function requireRecord(input: unknown, name: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error(`${name} must be an object.`);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
