import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  HostedBearerCredentialSchema,
  HostedCsrfTokenSchema,
  HostedSessionPayloadSchema,
  HostedWebServerSettingsSchema,
  type HostedSessionPayload,
} from "@sisyphus/ui/contracts";

const sessionLifetimeMs = 8 * 60 * 60 * 1_000;
function authenticatedData(
  configuration: Extract<HostedConfiguration, { kind: "configured" }>,
): Buffer {
  return Buffer.from(
    `sisyphus-hosted-session:v1:${configuration.publicOrigin}`,
    "utf8",
  );
}

export type HostedConfiguration =
  | { readonly kind: "demo" }
  | {
      readonly kind: "configured";
      readonly apiUrl: string;
      readonly publicOrigin: string;
      readonly sessionKey: Buffer;
      readonly secureCookie: boolean;
    };

export function parseHostedConfiguration(input: {
  apiUrl: string | undefined;
  publicOrigin: string | undefined;
  sessionKey: string | undefined;
  nodeEnv: string | undefined;
}): HostedConfiguration {
  const configuredValues = [input.apiUrl, input.publicOrigin, input.sessionKey];
  if (configuredValues.every((value) => value === undefined)) {
    return { kind: "demo" };
  }
  if (configuredValues.some((value) => value === undefined)) {
    throw new Error(
      "SISYPHUS_WEB_API_URL, SISYPHUS_WEB_ORIGIN, and SISYPHUS_WEB_SESSION_KEY must all be set.",
    );
  }

  const settings = HostedWebServerSettingsSchema.parse({
    apiUrl: input.apiUrl,
    publicOrigin: input.publicOrigin,
    sessionKey: input.sessionKey,
    nodeEnv: input.nodeEnv ?? "production",
  });
  const apiUrl = new URL(settings.apiUrl);
  const sessionKey = Buffer.from(settings.sessionKey, "base64");
  if (sessionKey.byteLength !== 32) {
    throw new Error("SISYPHUS_WEB_SESSION_KEY must decode to exactly 32 bytes.");
  }

  return {
    kind: "configured",
    apiUrl: apiUrl.toString().replace(/\/$/u, ""),
    publicOrigin: new URL(settings.publicOrigin).origin,
    sessionKey,
    secureCookie: settings.nodeEnv === "production",
  };
}

export function loadHostedConfiguration(): HostedConfiguration {
  return parseHostedConfiguration({
    apiUrl: process.env.SISYPHUS_WEB_API_URL,
    publicOrigin: process.env.SISYPHUS_WEB_ORIGIN,
    sessionKey: process.env.SISYPHUS_WEB_SESSION_KEY,
    nodeEnv: process.env.NODE_ENV,
  });
}

export function hostedSessionCookieName(
  configuration: Extract<HostedConfiguration, { kind: "configured" }>,
): string {
  return configuration.secureCookie
    ? "__Host-sisyphus_session"
    : "sisyphus_session";
}

export function createHostedSession(input: {
  bearerToken: string;
  configuration: Extract<HostedConfiguration, { kind: "configured" }>;
  now?: number;
}): { readonly cookieValue: string; readonly session: HostedSessionPayload } {
  const credential = HostedBearerCredentialSchema.parse({ token: input.bearerToken });
  const now = input.now ?? Date.now();
  const session = HostedSessionPayloadSchema.parse({
    version: 1,
    bearerToken: credential.token,
    csrfToken: randomBytes(32).toString("hex"),
    expiresAt: now + sessionLifetimeMs,
  });
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    input.configuration.sessionKey,
    initializationVector,
  );
  cipher.setAAD(authenticatedData(input.configuration));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return {
    cookieValue: [
      "v1",
      initializationVector.toString("base64url"),
      authenticationTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join("."),
    session,
  };
}

export function openHostedSession(input: {
  cookieValue: string;
  configuration: Extract<HostedConfiguration, { kind: "configured" }>;
  now?: number;
}): HostedSessionPayload | undefined {
  const parts = input.cookieValue.split(".");
  const version = parts[0];
  const encodedInitializationVector = parts[1];
  const encodedAuthenticationTag = parts[2];
  const encodedCiphertext = parts[3];
  if (
    parts.length !== 4 ||
    version !== "v1" ||
    encodedInitializationVector === undefined ||
    encodedAuthenticationTag === undefined ||
    encodedCiphertext === undefined
  ) {
    return undefined;
  }

  try {
    const initializationVector = Buffer.from(
      encodedInitializationVector,
      "base64url",
    );
    const authenticationTag = Buffer.from(encodedAuthenticationTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (
      initializationVector.byteLength !== 12 ||
      authenticationTag.byteLength !== 16 ||
      ciphertext.byteLength === 0
    ) {
      return undefined;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      input.configuration.sessionKey,
      initializationVector,
    );
    decipher.setAAD(authenticatedData(input.configuration));
    decipher.setAuthTag(authenticationTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsedJson: unknown = JSON.parse(plaintext);
    const session = HostedSessionPayloadSchema.safeParse(parsedJson);
    if (!session.success || session.data.expiresAt <= (input.now ?? Date.now())) {
      return undefined;
    }
    return session.data;
  } catch {
    return undefined;
  }
}

export function requestPassesMutationGuards(input: {
  headers: Headers;
  publicOrigin: string;
  csrfToken: string;
}): boolean {
  if (!requestHasTrustedOrigin(input)) {
    return false;
  }
  const providedToken = input.headers.get("x-sisyphus-csrf");
  const expected = HostedCsrfTokenSchema.safeParse(input.csrfToken);
  const provided = HostedCsrfTokenSchema.safeParse(providedToken);
  if (!expected.success || !provided.success) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected.data, "hex"),
    Buffer.from(provided.data, "hex"),
  );
}

export function requestHasTrustedOrigin(input: {
  headers: Headers;
  publicOrigin: string;
}): boolean {
  return (
    input.headers.get("origin") === input.publicOrigin &&
    input.headers.get("sec-fetch-site") === "same-origin"
  );
}
