import { describe, expect, it } from "vitest";
import {
  csrfTokenForAccessToken,
  parseHostedConfiguration,
  requestPassesMutationGuards,
} from "./lib/hosted-auth";
import {
  parseAuthEmail,
  parseEmailPassword,
  parsePasswordUpdate,
  parseSignUpCredentials,
  safeAuthContinuation,
} from "./lib/auth-input";
import {
  createDevelopmentAdminSession,
  csrfTokenForDevelopmentAdminSession,
  developmentAdminCredentialsAreValid,
  verifyDevelopmentAdminSession,
} from "./lib/development-admin";

const configuredInput = {
  apiUrl: "https://control.example.test",
  publicOrigin: "https://sisyphus.example.test",
  supabaseUrl: "https://project-ref.supabase.co",
  supabasePublishableKey: "sb_publishable_test-key-for-browser-auth",
  nodeEnv: "production",
} as const;

describe("hosted Supabase authentication", () => {
  it("requires the control-plane and Supabase settings as one complete unit", () => {
    expect(
      parseHostedConfiguration({
        apiUrl: undefined,
        publicOrigin: undefined,
        supabaseUrl: undefined,
        supabasePublishableKey: undefined,
        nodeEnv: "development",
      }),
    ).toEqual({ kind: "unconfigured" });

    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        supabasePublishableKey: undefined,
      }),
    ).toThrow(/must all be set/u);
  });

  it("normalizes configured URLs and never requires a Supabase secret key", () => {
    expect(
      parseHostedConfiguration({
        ...configuredInput,
        apiUrl: `${configuredInput.apiUrl}/`,
        publicOrigin: `${configuredInput.publicOrigin}/dashboard`,
        supabaseUrl: `${configuredInput.supabaseUrl}/`,
      }),
    ).toEqual({
      kind: "configured",
      apiUrl: configuredInput.apiUrl,
      developmentAdmin: { kind: "disabled" },
      publicOrigin: configuredInput.publicOrigin,
      supabaseUrl: configuredInput.supabaseUrl,
      supabasePublishableKey: configuredInput.supabasePublishableKey,
    });
  });

  it("refuses insecure hosted endpoints", () => {
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        apiUrl: "http://control.example.test",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        publicOrigin: "http://sisyphus.example.test",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        supabaseUrl: "http://project-ref.supabase.co",
      }),
    ).toThrow(/HTTPS/u);
  });

  it("allows HTTP loopback only for the local web and control-plane origins", () => {
    expect(
      parseHostedConfiguration({
        ...configuredInput,
        apiUrl: "http://127.0.0.1:7330",
        publicOrigin: "http://localhost:3000",
        nodeEnv: "development",
      }),
    ).toMatchObject({
      kind: "configured",
      apiUrl: "http://127.0.0.1:7330",
      publicOrigin: "http://localhost:3000",
    });
  });

  it("enables the known local admin only with complete loopback development settings", () => {
    expect(
      parseHostedConfiguration({
        ...configuredInput,
        apiUrl: "http://127.0.0.1:7330",
        developmentAdminApiToken: "demo-admin",
        developmentAdminEnabled: "true",
        developmentAdminSessionSecret: "a".repeat(64),
        nodeEnv: "development",
        publicOrigin: "http://localhost:3000",
      }),
    ).toMatchObject({
      developmentAdmin: {
        kind: "enabled",
        apiToken: "demo-admin",
        sessionSecret: "a".repeat(64),
      },
    });
  });

  it("refuses partial, remote, or non-development admin settings", () => {
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        developmentAdminEnabled: "true",
      }),
    ).toThrow(/must be set together/u);
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        developmentAdminApiToken: "demo-admin",
        developmentAdminEnabled: "true",
        developmentAdminSessionSecret: "a".repeat(64),
      }),
    ).toThrow(/only in development/u);
    expect(() =>
      parseHostedConfiguration({
        ...configuredInput,
        developmentAdminApiToken: "demo-admin",
        developmentAdminEnabled: "true",
        developmentAdminSessionSecret: "a".repeat(64),
        nodeEnv: "development",
      }),
    ).toThrow(/loopback/u);
  });

  it("derives a stable CSRF token without exposing the Supabase access token", () => {
    const accessToken = "header.payload.signature";
    const csrfToken = csrfTokenForAccessToken(accessToken);

    expect(csrfToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(csrfToken).not.toContain(accessToken);
    expect(csrfTokenForAccessToken(accessToken)).toBe(csrfToken);
    expect(csrfTokenForAccessToken("other.payload.signature")).not.toBe(
      csrfToken,
    );
  });

  it("signs, expires, and process-binds local admin sessions", () => {
    const now = new Date("2026-08-30T08:00:00.000Z");
    const sessionSecret = "b".repeat(64);
    const sessionProof = createDevelopmentAdminSession({
      now,
      processBootId: "boot-one",
      publicOrigin: "http://localhost:3000",
      sessionSecret,
    });
    const verified = verifyDevelopmentAdminSession(sessionProof, {
      now: new Date("2026-08-30T08:00:01.000Z"),
      processBootId: "boot-one",
      publicOrigin: "http://localhost:3000",
      sessionSecret,
    });

    expect(verified).toBeDefined();
    expect(
      verifyDevelopmentAdminSession(sessionProof + "tampered", {
        now,
        processBootId: "boot-one",
        publicOrigin: "http://localhost:3000",
        sessionSecret,
      }),
    ).toBeUndefined();
    expect(
      verifyDevelopmentAdminSession(sessionProof, {
        now,
        processBootId: "boot-two",
        publicOrigin: "http://localhost:3000",
        sessionSecret,
      }),
    ).toBeUndefined();
    expect(
      verifyDevelopmentAdminSession(sessionProof, {
        now: new Date("2026-08-30T16:00:01.000Z"),
        processBootId: "boot-one",
        publicOrigin: "http://localhost:3000",
        sessionSecret,
      }),
    ).toBeUndefined();
    expect(
      csrfTokenForDevelopmentAdminSession({
        processBootId: "boot-one",
        sessionId: verified?.sessionId ?? "",
        sessionSecret,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("accepts only the exact local admin credentials", () => {
    expect(
      developmentAdminCredentialsAreValid({
        username: "admin",
        password: "admin",
      }),
    ).toBe(true);
    expect(
      developmentAdminCredentialsAreValid({
        username: "admin",
        password: "Admin",
      }),
    ).toBe(false);
    expect(
      developmentAdminCredentialsAreValid({
        username: "admin@example.com",
        password: "admin",
      }),
    ).toBe(false);
  });

  it("normalizes valid credentials and rejects weak or malformed input", () => {
    expect(
      parseEmailPassword({ email: "  USER@Example.COM ", password: "correct horse" }),
    ).toEqual({ email: "user@example.com", password: "correct horse" });
    expect(() =>
      parseEmailPassword({ email: "not-an-email", password: "correct horse" }),
    ).toThrow();
    expect(() =>
      parseEmailPassword({ email: "user@example.com", password: "short" }),
    ).toThrow();
    expect(
      parseSignUpCredentials({
        email: "  USER@Example.COM ",
        name: "  Ada Lovelace  ",
        password: "correct horse",
      }),
    ).toEqual({
      email: "user@example.com",
      name: "Ada Lovelace",
      password: "correct horse",
    });
    expect(() =>
      parseSignUpCredentials({
        email: "user@example.com",
        name: "   ",
        password: "correct horse",
      }),
    ).toThrow();
  });

  it("validates password recovery input without allowing open redirects", () => {
    expect(parseAuthEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(() => parseAuthEmail("not-an-email")).toThrow();
    expect(
      parsePasswordUpdate({
        password: "correct horse",
        passwordConfirmation: "correct horse",
      }),
    ).toEqual({
      password: "correct horse",
      passwordConfirmation: "correct horse",
    });
    expect(() =>
      parsePasswordUpdate({
        password: "correct horse",
        passwordConfirmation: "different horse",
      }),
    ).toThrow(/match/u);
    expect(safeAuthContinuation("/auth/update-password")).toBe(
      "/auth/update-password",
    );
    expect(safeAuthContinuation("https://attacker.example.test")).toBeUndefined();
    expect(safeAuthContinuation("//attacker.example.test")).toBeUndefined();
  });

  it("rejects mismatched origins, untrusted fetch metadata, and invalid CSRF tokens", () => {
    const csrfToken = "a".repeat(64);
    const headers = new Headers({
      Origin: configuredInput.publicOrigin,
      "Sec-Fetch-Site": "same-origin",
      "X-Sisyphus-CSRF": csrfToken,
    });
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: configuredInput.publicOrigin,
        csrfToken,
      }),
    ).toBe(true);
    headers.set("Origin", "https://attacker.example.test");
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: configuredInput.publicOrigin,
        csrfToken,
      }),
    ).toBe(false);
    headers.set("Origin", configuredInput.publicOrigin);
    headers.set("X-Sisyphus-CSRF", "b".repeat(64));
    expect(
      requestPassesMutationGuards({
        headers,
        publicOrigin: configuredInput.publicOrigin,
        csrfToken,
      }),
    ).toBe(false);
  });
});
