import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, CredentialResolver } from "./auth.js";
import { createApp } from "./app.js";
import { createInMemoryRepository, demoCredentials } from "./repository.js";

const openApps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("external user authentication", () => {
  it("falls back to a verified user resolver without changing device credentials", async () => {
    const externalCredentialResolver: CredentialResolver = {
      resolveCredential: vi.fn(async (token: string): Promise<AuthContext | undefined> =>
        token === "header.payload.signature"
          ? {
              kind: "user",
              tenantId: "tenant-acme",
              subjectId: "supabase-user",
              role: "viewer",
            }
          : undefined,
      ),
    };
    const app = await createApp({
      repository: createInMemoryRepository(),
      externalCredentialResolver,
    });
    openApps.push(app);

    const userResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: { authorization: "Bearer header.payload.signature" },
    });
    expect(userResponse.statusCode).toBe(200);
    expect(externalCredentialResolver.resolveCredential).toHaveBeenCalledWith(
      "header.payload.signature",
    );

    const deviceResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: { authorization: `Bearer ${demoCredentials.acmeDevice}` },
    });
    expect(deviceResponse.statusCode).toBe(200);
  });
});
