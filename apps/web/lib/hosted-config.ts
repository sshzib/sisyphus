import { z } from "zod";

const HostedSettingsSchema = z
  .object({
    apiUrl: z.url(),
    publicOrigin: z.url(),
    supabaseUrl: z.url(),
    supabasePublishableKey: z
      .string()
      .trim()
      .min(20)
      .max(512)
      .regex(/^sb_publishable_[A-Za-z0-9_-]+$/u),
    nodeEnv: z.enum(["development", "production", "test"]),
  })
  .strict();

export type HostedConfiguration =
  | { readonly kind: "unconfigured" }
  | {
      readonly kind: "configured";
      readonly apiUrl: string;
      readonly developmentAdmin:
        | { readonly kind: "disabled" }
        | {
            readonly kind: "enabled";
            readonly apiToken: "demo-admin";
            readonly sessionSecret: string;
          };
      readonly publicOrigin: string;
      readonly supabaseUrl: string;
      readonly supabasePublishableKey: string;
    };

export function parseHostedConfiguration(input: {
  apiUrl: string | undefined;
  developmentAdminApiToken?: string | undefined;
  developmentAdminEnabled?: string | undefined;
  developmentAdminSessionSecret?: string | undefined;
  publicOrigin: string | undefined;
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
  nodeEnv: string | undefined;
}): HostedConfiguration {
  const configuredValues = [
    input.apiUrl,
    input.publicOrigin,
    input.supabaseUrl,
    input.supabasePublishableKey,
  ];
  if (configuredValues.every((value) => value === undefined)) {
    return { kind: "unconfigured" };
  }
  if (configuredValues.some((value) => value === undefined)) {
    throw new Error(
      "SISYPHUS_WEB_API_URL, SISYPHUS_WEB_ORIGIN, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must all be set.",
    );
  }

  const settings = HostedSettingsSchema.parse({
    apiUrl: input.apiUrl,
    publicOrigin: input.publicOrigin,
    supabaseUrl: input.supabaseUrl,
    supabasePublishableKey: input.supabasePublishableKey,
    nodeEnv: input.nodeEnv ?? "production",
  });
  const apiUrl = new URL(settings.apiUrl);
  const publicOrigin = new URL(settings.publicOrigin);
  const supabaseUrl = new URL(settings.supabaseUrl);
  for (const [label, url] of [
    ["control-plane", apiUrl],
    ["public", publicOrigin],
    ["Supabase", supabaseUrl],
  ] as const) {
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error(
        `The ${label} URL cannot contain credentials, a query, or a fragment.`,
      );
    }
  }
  if (supabaseUrl.protocol !== "https:") {
    throw new Error("The Supabase project URL must use HTTPS.");
  }
  if (
    settings.nodeEnv === "production" &&
    (apiUrl.protocol !== "https:" || publicOrigin.protocol !== "https:")
  ) {
    throw new Error("Production control-plane and public URLs must use HTTPS.");
  }
  if (
    !new Set(["http:", "https:"]).has(apiUrl.protocol) ||
    !new Set(["http:", "https:"]).has(publicOrigin.protocol)
  ) {
    throw new Error("The control-plane and public URLs must use HTTP or HTTPS.");
  }
  const developmentAdminValues = [
    input.developmentAdminEnabled?.trim() || undefined,
    input.developmentAdminSessionSecret?.trim() || undefined,
    input.developmentAdminApiToken?.trim() || undefined,
  ];
  const developmentAdmin =
    developmentAdminValues.every((value) => value === undefined)
      ? ({ kind: "disabled" } as const)
      : parseDevelopmentAdminConfiguration({
          apiToken: developmentAdminValues[2],
          apiUrl,
          enabled: developmentAdminValues[0],
          nodeEnv: settings.nodeEnv,
          publicOrigin,
          sessionSecret: developmentAdminValues[1],
        });

  return {
    kind: "configured",
    apiUrl: apiUrl.toString().replace(/\/$/u, ""),
    developmentAdmin,
    publicOrigin: publicOrigin.origin,
    supabaseUrl: supabaseUrl.origin,
    supabasePublishableKey: settings.supabasePublishableKey,
  };
}

function parseDevelopmentAdminConfiguration(input: {
  apiToken: string | undefined;
  apiUrl: URL;
  enabled: string | undefined;
  nodeEnv: "development" | "production" | "test";
  publicOrigin: URL;
  sessionSecret: string | undefined;
}): Extract<
  Extract<HostedConfiguration, { kind: "configured" }>["developmentAdmin"],
  { kind: "enabled" }
> {
  if (
    input.enabled === undefined ||
    input.sessionSecret === undefined ||
    input.apiToken === undefined
  ) {
    throw new Error(
      "The development admin flag, session secret, and API token must be set together.",
    );
  }
  if (input.enabled !== "true") {
    throw new Error("The development admin flag must be true when configured.");
  }
  if (input.nodeEnv !== "development") {
    throw new Error(
      "The development admin login is available only in development.",
    );
  }
  if (!isLoopback(input.apiUrl) || !isLoopback(input.publicOrigin)) {
    throw new Error(
      "The development admin login requires loopback web and API origins.",
    );
  }
  if (input.apiToken !== "demo-admin") {
    throw new Error(
      "The development admin API token must select the local admin credential.",
    );
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.sessionSecret)) {
    throw new Error(
      "The development admin session secret must be 32 random bytes encoded as hexadecimal.",
    );
  }
  return {
    kind: "enabled",
    apiToken: input.apiToken,
    sessionSecret: input.sessionSecret,
  };
}

function isLoopback(url: URL): boolean {
  return new Set(["localhost", "127.0.0.1", "[::1]"]).has(
    url.hostname.toLowerCase(),
  );
}

export function loadHostedConfiguration(): HostedConfiguration {
  return parseHostedConfiguration({
    apiUrl: process.env.SISYPHUS_WEB_API_URL,
    developmentAdminApiToken:
      process.env.SISYPHUS_WEB_DEV_ADMIN_API_TOKEN,
    developmentAdminEnabled:
      process.env.SISYPHUS_WEB_DEV_ADMIN_ENABLED,
    developmentAdminSessionSecret:
      process.env.SISYPHUS_WEB_DEV_ADMIN_SESSION_SECRET,
    publicOrigin: process.env.SISYPHUS_WEB_ORIGIN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    nodeEnv: process.env.NODE_ENV,
  });
}
