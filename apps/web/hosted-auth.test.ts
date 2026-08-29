import { describe, expect, it } from "vitest";
import {
  createHostedSession,
  openHostedSession,
  parseHostedConfiguration,
  requestPassesMutationGuards,
} from "./lib/hosted-auth";

const sessionKey = Buffer.alloc(32, 7).toString("base64");

describe("hosted web authentication", () => {
  it("uses demo mode only when all server authentication settings are absent", () => {
    expect(
      parseHostedConfiguration({
        apiUrl: undefined,
        publicOrigin: undefined,
        sessionKey: undefined,
        nodeEnv: "development",
      }),
    ).toEqual({ kind: "demo" });

    expect(() =>
      parseHostedConfiguration({
        apiUrl: "https://control.example.test",
        publicOrigin: undefined,
        sessionKey,
        nodeEnv: "production",
      }),
    ).toThrow(/all be set/u);
  });

  it("refuses insecure production origins and control-plane URLs", () => {
    expect(() =>
      parseHostedConfiguration({
        apiUrl: "http://control.example.test",
        publicOrigin: "https://sisyphus.example.test",
        sessionKey,
        nodeEnv: "production",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseHostedConfiguration({
        apiUrl: "http://127.0.0.1:7330",
        publicOrigin: "http://127.0.0.1:3000",
        sessionKey,
        nodeEnv: undefined,
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseHostedConfiguration({
        apiUrl: "https://control.example.test",
        publicOrigin: "http://sisyphus.example.test",
        sessionKey,
        nodeEnv: "production",
      }),
    ).toThrow(/HTTPS/u);
  });

  it("encrypts a bearer credential and rejects tampering or expiry", () => {
    const configuration = parseHostedConfiguration({
      apiUrl: "https://control.example.test/",
      publicOrigin: "https://sisyphus.example.test/",
      sessionKey,
      nodeEnv: "production",
    });
    if (configuration.kind !== "configured") throw new Error("Expected configured mode.");

    const created = createHostedSession({
      bearerToken: "tenant-admin-token",
      configuration,
      now: 1_000,
    });
    expect(created.cookieValue).not.toContain("tenant-admin-token");
    expect(
      openHostedSession({
        cookieValue: created.cookieValue,
        configuration,
        now: 1_001,
      }),
    ).toEqual(created.session);

    const cookieParts = created.cookieValue.split(".");
    const ciphertext = cookieParts[3];
    if (ciphertext === undefined) throw new Error("Missing encrypted session payload.");
    cookieParts[3] = `${ciphertext.startsWith("x") ? "y" : "x"}${ciphertext.slice(1)}`;
    const tampered = cookieParts.join(".");
    expect(
      openHostedSession({ cookieValue: tampered, configuration, now: 1_001 }),
    ).toBeUndefined();
    expect(
      openHostedSession({
        cookieValue: created.cookieValue,
        configuration,
        now: created.session.expiresAt,
      }),
    ).toBeUndefined();
    const otherOrigin = parseHostedConfiguration({
      apiUrl: "https://control.example.test/",
      publicOrigin: "https://other.example.test/",
      sessionKey,
      nodeEnv: "production",
    });
    if (otherOrigin.kind !== "configured") throw new Error("Expected configured mode.");
    expect(
      openHostedSession({
        cookieValue: created.cookieValue,
        configuration: otherOrigin,
        now: 1_001,
      }),
    ).toBeUndefined();
  });

  it("keeps the largest accepted credential inside common cookie limits", () => {
    const configuration = parseHostedConfiguration({
      apiUrl: "https://control.example.test/",
      publicOrigin: "https://sisyphus.example.test/",
      sessionKey,
      nodeEnv: "production",
    });
    if (configuration.kind !== "configured") throw new Error("Expected configured mode.");

    const created = createHostedSession({
      bearerToken: "a".repeat(2048),
      configuration,
      now: 1_000,
    });
    expect(Buffer.byteLength(created.cookieValue, "utf8")).toBeLessThan(4_096);
  });

  it("requires the configured origin, same-origin fetch metadata, and CSRF token", () => {
    const csrfToken = "a".repeat(64);
    const headers = new Headers({
      Origin: "https://sisyphus.example.test",
      "Sec-Fetch-Site": "same-origin",
      "X-Sisyphus-CSRF": csrfToken,
    });
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: "https://sisyphus.example.test",
        csrfToken,
      }),
    ).toBe(true);
    headers.set("Origin", "https://attacker.example.test");
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: "https://sisyphus.example.test",
        csrfToken,
      }),
    ).toBe(false);
    headers.set("Origin", "https://sisyphus.example.test");
    headers.set("X-Sisyphus-CSRF", "b".repeat(64));
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: "https://sisyphus.example.test",
        csrfToken,
      }),
    ).toBe(false);
    headers.set("X-Sisyphus-CSRF", csrfToken);
    headers.delete("Sec-Fetch-Site");
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: "https://sisyphus.example.test",
        csrfToken,
      }),
    ).toBe(false);
  });
});
