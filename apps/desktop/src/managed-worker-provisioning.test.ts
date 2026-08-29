import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  managedWorkerChildEnvironment,
  parseManagedWorkerProvisioning,
  resolveManagedWorkerProvisioning,
} from "./managed-worker-provisioning.js";

const completeManagedEnvironment = {
  SISYPHUS_POLICY_FILE: "examples/worker-policy.json",
  SISYPHUS_CONTROL_PLANE_URL: "https://control.example.test",
  SISYPHUS_DEVICE_TOKEN: "device-secret",
  SISYPHUS_TENANT_ID: "tenant-acme",
  SISYPHUS_DEVICE_ID: "device-delta",
  SISYPHUS_ADAPTER_INSTALLATION_ID: "installation-codex-local",
  SISYPHUS_RUNTIME_PROFILE: "local",
  SISYPHUS_ADAPTER_CONFIGURATION_DIGEST: "a".repeat(64),
  SISYPHUS_POLICY_PUBLIC_KEYS: JSON.stringify({ team: "public-key-pem" }),
} as const;

describe("managed worker provisioning", () => {
  it("uses offline defaults only when every policy setting is absent", () => {
    expect(parseManagedWorkerProvisioning({})).toEqual({
      kind: "offline-default",
    });
    expect(
      parseManagedWorkerProvisioning({
        SISYPHUS_POLICY_FILE: "examples/worker-policy.json",
      }),
    ).toEqual({
      kind: "local-policy",
      policyFile: resolve("examples/worker-policy.json"),
    });
    expect(
      managedWorkerChildEnvironment({
        kind: "local-policy",
        policyFile: resolve("examples/worker-policy.json"),
      }),
    ).toEqual({
      SISYPHUS_POLICY_FILE: resolve("examples/worker-policy.json"),
    });
    expect(managedWorkerChildEnvironment({ kind: "offline-default" })).toEqual(
      {},
    );
  });

  it("rejects every partial cloud-managed identity", () => {
    expect(() =>
      parseManagedWorkerProvisioning({
        SISYPHUS_POLICY_FILE: "examples/worker-policy.json",
        SISYPHUS_CONTROL_PLANE_URL: "https://control.example.test",
      }),
    ).toThrow(/SISYPHUS_TENANT_ID/u);
    expect(() =>
      parseManagedWorkerProvisioning({
        ...completeManagedEnvironment,
        SISYPHUS_POLICY_PUBLIC_KEYS: "{}",
      }),
    ).toThrow(/trusted policy key/u);
    expect(() =>
      parseManagedWorkerProvisioning({
        ...completeManagedEnvironment,
        SISYPHUS_CONTROL_PLANE_URL: "http://control.example.test",
      }),
    ).toThrow(/HTTPS or loopback HTTP/u);
  });

  it("passes the complete managed identity to the child and no unrelated values", async () => {
    const provisioning = await resolveManagedWorkerProvisioning({
      configuration: parseManagedWorkerProvisioning(completeManagedEnvironment),
      loadDeviceToken: async () => undefined,
      persistDeviceToken: async (value) => value,
    });

    expect(managedWorkerChildEnvironment(provisioning)).toEqual({
      SISYPHUS_POLICY_FILE: resolve("examples/worker-policy.json"),
      SISYPHUS_CONTROL_PLANE_URL: "https://control.example.test",
      SISYPHUS_DEVICE_TOKEN: "device-secret",
      SISYPHUS_TENANT_ID: "tenant-acme",
      SISYPHUS_DEVICE_ID: "device-delta",
      SISYPHUS_ADAPTER_INSTALLATION_ID: "installation-codex-local",
      SISYPHUS_RUNTIME_PROFILE: "local",
      SISYPHUS_ADAPTER_CONFIGURATION_DIGEST: "a".repeat(64),
      SISYPHUS_POLICY_PUBLIC_KEYS: JSON.stringify({ team: "public-key-pem" }),
    });
  });

  it("requires an encrypted stored token when managed identity omits the token", async () => {
    const { SISYPHUS_DEVICE_TOKEN: _token, ...environment } =
      completeManagedEnvironment;
    const configuration = parseManagedWorkerProvisioning(environment);

    await expect(
      resolveManagedWorkerProvisioning({
        configuration,
        loadDeviceToken: async () => undefined,
        persistDeviceToken: async (value) => value,
      }),
    ).rejects.toThrow(/device token/u);
    await expect(
      resolveManagedWorkerProvisioning({
        configuration,
        loadDeviceToken: async () => "stored-device-secret",
        persistDeviceToken: async (value) => value,
      }),
    ).resolves.toMatchObject({
      kind: "cloud-managed",
      deviceToken: "stored-device-secret",
    });
  });
});
