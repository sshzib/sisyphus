import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export const DEVELOPMENT_ADMIN_COOKIE_NAME =
  "sisyphus-development-admin";
export const DEVELOPMENT_ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

const DevelopmentAdminCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(128),
    password: z.string().min(1).max(128),
  })
  .strict();

const sessionIdPattern = /^[A-Za-z0-9_-]{24}$/u;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/u;
const allowedClockSkewSeconds = 30;

type DevelopmentAdminSession = {
  readonly sessionId: string;
  readonly sessionProof: string;
};

type DevelopmentAdminSessionInput = {
  readonly publicOrigin: string;
  readonly sessionSecret: string;
  readonly now?: Date;
  readonly processBootId?: string;
};

const processState = globalThis as typeof globalThis & {
  __sisyphusDevelopmentAdminBootId?: string;
};

function currentProcessBootId(): string {
  processState.__sisyphusDevelopmentAdminBootId ??=
    randomBytes(18).toString("base64url");
  return processState.__sisyphusDevelopmentAdminBootId;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function sessionSignature(input: {
  readonly payload: string;
  readonly processBootId: string;
  readonly publicOrigin: string;
  readonly sessionSecret: string;
}): string {
  return createHmac("sha256", input.sessionSecret)
    .update("sisyphus-development-admin-session:v1\0", "utf8")
    .update(input.processBootId, "utf8")
    .update("\0", "utf8")
    .update(input.publicOrigin, "utf8")
    .update("\0", "utf8")
    .update(input.payload, "utf8")
    .digest("base64url");
}

export function developmentAdminCredentialsAreValid(input: unknown): boolean {
  const credentials = DevelopmentAdminCredentialsSchema.safeParse(input);
  return (
    credentials.success &&
    safeEqual(credentials.data.username, "admin") &&
    safeEqual(credentials.data.password, "admin")
  );
}

export function createDevelopmentAdminSession(
  input: DevelopmentAdminSessionInput,
): string {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const expiresAt = issuedAt + DEVELOPMENT_ADMIN_SESSION_TTL_SECONDS;
  const sessionId = randomBytes(18).toString("base64url");
  const payload = ["v1", issuedAt, expiresAt, sessionId].join(".");
  const signature = sessionSignature({
    payload,
    processBootId: input.processBootId ?? currentProcessBootId(),
    publicOrigin: input.publicOrigin,
    sessionSecret: input.sessionSecret,
  });
  return [payload, signature].join(".");
}

export function verifyDevelopmentAdminSession(
  sessionProof: string | undefined,
  input: DevelopmentAdminSessionInput,
): DevelopmentAdminSession | undefined {
  if (sessionProof === undefined) {
    return undefined;
  }
  const parts = sessionProof.split(".");
  if (parts.length !== 5) {
    return undefined;
  }
  const [version, issuedAtText, expiresAtText, sessionId, signature] = parts;
  if (
    version !== "v1" ||
    issuedAtText === undefined ||
    expiresAtText === undefined ||
    sessionId === undefined ||
    signature === undefined ||
    !/^\d{10}$/u.test(issuedAtText) ||
    !/^\d{10}$/u.test(expiresAtText) ||
    !sessionIdPattern.test(sessionId) ||
    !signaturePattern.test(signature)
  ) {
    return undefined;
  }
  const issuedAt = Number(issuedAtText);
  const expiresAt = Number(expiresAtText);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + allowedClockSkewSeconds ||
    expiresAt <= now ||
    expiresAt - issuedAt !== DEVELOPMENT_ADMIN_SESSION_TTL_SECONDS
  ) {
    return undefined;
  }
  const payload = [version, issuedAtText, expiresAtText, sessionId].join(".");
  const expectedSignature = sessionSignature({
    payload,
    processBootId: input.processBootId ?? currentProcessBootId(),
    publicOrigin: input.publicOrigin,
    sessionSecret: input.sessionSecret,
  });
  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }
  return { sessionId, sessionProof };
}

export function csrfTokenForDevelopmentAdminSession(input: {
  readonly processBootId?: string;
  readonly sessionId: string;
  readonly sessionSecret: string;
}): string {
  return createHmac("sha256", input.sessionSecret)
    .update("sisyphus-development-admin-csrf:v1\0", "utf8")
    .update(input.processBootId ?? currentProcessBootId(), "utf8")
    .update("\0", "utf8")
    .update(input.sessionId, "utf8")
    .digest("hex");
}
