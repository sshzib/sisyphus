import { describe, expect, it } from "vitest";

import { isLoopbackAddress } from "./local-auth.js";

describe("local worker network boundary", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts loopback peer %s",
    (address) => expect(isLoopbackAddress(address)).toBe(true),
  );

  it.each([undefined, "0.0.0.0", "192.168.1.20", "::ffff:192.168.1.20"])(
    "rejects non-loopback peer %s",
    (address) => expect(isLoopbackAddress(address)).toBe(false),
  );
});
