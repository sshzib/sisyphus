import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";
import {
  parseServerEnvironment,
  selectServerRepository,
} from "./server-config.js";

describe("production repository selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses an explicit in-memory production repository", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        SISYPHUS_REPOSITORY_MODE: "memory",
      }),
    ).toThrow(/Production cannot use the in-memory demo repository/u);
  });

  it("requires the Sisyphus database environment variable", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        SISYPHUS_REPOSITORY_MODE: "postgres",
      }),
    ).toThrow(/SISYPHUS_DATABASE_URL/u);
  });

  it("fails closed before a production process can expose demo credentials", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "production",
      SISYPHUS_REPOSITORY_MODE: "postgres",
      SISYPHUS_DATABASE_URL: "postgres://sisyphus:secret@127.0.0.1:5432/sisyphus",
    });
    expect(() =>
      selectServerRepository({
        environment,
        secretCipher: new AesGcmSecretCipher(),
      }),
    ).toThrow(/Production startup refused/u);
  });

  it("does not let production createApp construct its demo repository", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(createApp()).rejects.toThrow(
      /requires an explicit persistent ControlPlaneRepository/u,
    );
  });
});
