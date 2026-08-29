import { describe, expect, it } from "vitest";

import {
  createLocalChallengeNonce,
  signLocalChallenge,
  verifyLocalChallenge,
} from "../src/index.js";

const token = "challenge_token_0123456789abcdefghijklmnopqrstuvwxyz";

describe("local worker challenge", () => {
  it("binds a proof to its channel, nonce, and secret", () => {
    const nonce = createLocalChallengeNonce();
    const response = {
      channel: "hook" as const,
      nonce,
      proof: signLocalChallenge({ channel: "hook", nonce, token }),
    };

    expect(verifyLocalChallenge({ response, channel: "hook", nonce, token })).toBe(true);
    expect(
      verifyLocalChallenge({ response, channel: "desktop", nonce, token }),
    ).toBe(false);
    expect(
      verifyLocalChallenge({
        response,
        channel: "hook",
        nonce,
        token: `x${token.slice(1)}`,
      }),
    ).toBe(false);
  });
});
