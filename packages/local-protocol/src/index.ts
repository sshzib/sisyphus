import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const LocalChallengeChannelSchema = z.enum(["hook", "mcp", "desktop"]);
export type LocalChallengeChannel = z.infer<typeof LocalChallengeChannelSchema>;

export const LocalChallengeNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);
export type LocalChallengeNonce = z.infer<typeof LocalChallengeNonceSchema>;

export const LocalChallengeProofSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);
export type LocalChallengeProof = z.infer<typeof LocalChallengeProofSchema>;

export const LocalChallengeResponseSchema = z
  .object({
    channel: LocalChallengeChannelSchema,
    nonce: LocalChallengeNonceSchema,
    proof: LocalChallengeProofSchema,
  })
  .strict();
export type LocalChallengeResponse = z.infer<typeof LocalChallengeResponseSchema>;

function challengeMessage(channel: LocalChallengeChannel, nonce: LocalChallengeNonce): string {
  return `sisyphus-local-challenge-v1\u0000${channel}\u0000${nonce}`;
}

export function createLocalChallengeNonce(): LocalChallengeNonce {
  return LocalChallengeNonceSchema.parse(randomBytes(32).toString("base64url"));
}

export function signLocalChallenge(input: {
  readonly channel: LocalChallengeChannel;
  readonly nonce: LocalChallengeNonce;
  readonly token: string;
}): LocalChallengeProof {
  const token = Buffer.from(input.token, "base64url");
  if (token.byteLength < 32) throw new Error("Local challenge tokens require 32 bytes.");
  return LocalChallengeProofSchema.parse(
    createHmac("sha256", token)
      .update(challengeMessage(input.channel, input.nonce), "utf8")
      .digest("base64url"),
  );
}

export function verifyLocalChallenge(input: {
  readonly response: unknown;
  readonly channel: LocalChallengeChannel;
  readonly nonce: LocalChallengeNonce;
  readonly token: string;
}): boolean {
  const parsed = LocalChallengeResponseSchema.safeParse(input.response);
  if (
    !parsed.success ||
    parsed.data.channel !== input.channel ||
    parsed.data.nonce !== input.nonce
  ) {
    return false;
  }
  const expected = signLocalChallenge({
    channel: input.channel,
    nonce: input.nonce,
    token: input.token,
  });
  const suppliedBytes = Buffer.from(parsed.data.proof, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}
