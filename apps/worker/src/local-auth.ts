import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { z } from "zod";

export const LocalBearerTokenSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{43,128}$/u,
    "Local worker tokens must encode at least 32 random bytes as base64url.",
  )
  .brand<"LocalBearerToken">();
export type LocalBearerToken = z.infer<typeof LocalBearerTokenSchema>;

export function parseLocalBearerToken(input: unknown): LocalBearerToken {
  return LocalBearerTokenSchema.parse(input);
}

function isIpv4Loopback(address: string): boolean {
  const segments = address.split(".");
  if (segments.length !== 4 || segments[0] !== "127") return false;
  return segments.every((segment) => {
    if (!/^\d{1,3}$/u.test(segment)) return false;
    const value = Number(segment);
    return value >= 0 && value <= 255;
  });
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  if (address === "::1") return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return isIpv4Loopback(ipv4);
}

export function bearerTokensMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export type LocalAuthorization =
  | { readonly kind: "authorized" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "non-loopback" };

export function authorizeLocalRequest(
  request: IncomingMessage,
  expectedToken: LocalBearerToken,
): LocalAuthorization {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return { kind: "non-loopback" };
  }
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return { kind: "unauthorized" };
  }
  const supplied = authorization.slice("Bearer ".length);
  return bearerTokensMatch(supplied, expectedToken)
    ? { kind: "authorized" }
    : { kind: "unauthorized" };
}
