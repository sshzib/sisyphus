import { resolve } from "node:path";

import { z } from "zod";

import { ProvisionedDeviceTokenSchema } from "./device-secrets.js";

const ManagedWorkerEnvironmentSchema = z.object({
  SISYPHUS_POLICY_FILE: z.string().trim().min(1).max(32_767).optional(),
  SISYPHUS_CONTROL_PLANE_URL: z.string().url().optional(),
  SISYPHUS_DEVICE_TOKEN: ProvisionedDeviceTokenSchema.optional(),
  SISYPHUS_TENANT_ID: z.string().trim().min(1).max(512).optional(),
  SISYPHUS_DEVICE_ID: z.string().trim().min(1).max(512).optional(),
  SISYPHUS_ADAPTER_INSTALLATION_ID: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional(),
  SISYPHUS_RUNTIME_PROFILE: z.literal("local").optional(),
  SISYPHUS_ADAPTER_CONFIGURATION_DIGEST: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  SISYPHUS_POLICY_PUBLIC_KEYS: z.string().trim().min(1).max(128_000).optional(),
});

interface CloudManagedIdentity {
  readonly policyFile: string;
  readonly controlPlaneUrl: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly adapterInstallationId: string;
  readonly runtimeProfile: "local";
  readonly adapterConfigurationDigest: string;
  readonly serializedPolicyPublicKeys: string;
}

export type ParsedManagedWorkerProvisioning =
  | { readonly kind: "offline-default" }
  | { readonly kind: "local-policy"; readonly policyFile: string }
  | (CloudManagedIdentity & {
      readonly kind: "cloud-managed";
      readonly deviceCredential:
        | { readonly kind: "provided"; readonly value: string }
        | { readonly kind: "stored" };
    });

export type ManagedWorkerProvisioning =
  | { readonly kind: "offline-default" }
  | { readonly kind: "local-policy"; readonly policyFile: string }
  | (CloudManagedIdentity & {
      readonly kind: "cloud-managed";
      readonly deviceToken: string;
    });

const managedIdentityEnvironmentNames = [
  "SISYPHUS_CONTROL_PLANE_URL",
  "SISYPHUS_TENANT_ID",
  "SISYPHUS_DEVICE_ID",
  "SISYPHUS_ADAPTER_INSTALLATION_ID",
  "SISYPHUS_RUNTIME_PROFILE",
  "SISYPHUS_ADAPTER_CONFIGURATION_DIGEST",
  "SISYPHUS_POLICY_PUBLIC_KEYS",
] as const;

function normalizedControlPlaneUrl(source: string): string {
  const endpoint = new URL(source);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]).has(
    endpoint.hostname,
  );
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new Error("SISYPHUS_CONTROL_PLANE_URL must use HTTPS or loopback HTTP.");
  }
  if (
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("SISYPHUS_CONTROL_PLANE_URL must contain an origin only.");
  }
  return endpoint.origin;
}

function serializedPolicyPublicKeys(source: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch (error: unknown) {
    throw new Error("SISYPHUS_POLICY_PUBLIC_KEYS must be a JSON object.", {
      cause: error,
    });
  }
  const keys = z
    .record(z.string().trim().min(1).max(256), z.string().trim().min(1).max(32_000))
    .refine((value) => Object.keys(value).length > 0, {
      message: "Cloud-managed provisioning requires at least one trusted policy key.",
    })
    .parse(decoded);
  return JSON.stringify(keys);
}

export function parseManagedWorkerProvisioning(
  environment: Readonly<Record<string, string | undefined>>,
): ParsedManagedWorkerProvisioning {
  const source = ManagedWorkerEnvironmentSchema.parse(environment);
  const hasManagedIdentity =
    source.SISYPHUS_DEVICE_TOKEN !== undefined ||
    managedIdentityEnvironmentNames.some((name) => source[name] !== undefined);
  if (!hasManagedIdentity) {
    return source.SISYPHUS_POLICY_FILE === undefined
      ? { kind: "offline-default" }
      : {
          kind: "local-policy",
          policyFile: resolve(source.SISYPHUS_POLICY_FILE),
        };
  }

  const missing = [
    ...(source.SISYPHUS_POLICY_FILE === undefined ? ["SISYPHUS_POLICY_FILE"] : []),
    ...managedIdentityEnvironmentNames.filter((name) => source[name] === undefined),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Cloud-managed worker provisioning is incomplete. Set ${missing.join(", ")}.`,
    );
  }

  const policyFile = source.SISYPHUS_POLICY_FILE;
  const controlPlaneUrl = source.SISYPHUS_CONTROL_PLANE_URL;
  const tenantId = source.SISYPHUS_TENANT_ID;
  const deviceId = source.SISYPHUS_DEVICE_ID;
  const adapterInstallationId = source.SISYPHUS_ADAPTER_INSTALLATION_ID;
  const runtimeProfile = source.SISYPHUS_RUNTIME_PROFILE;
  const adapterConfigurationDigest = source.SISYPHUS_ADAPTER_CONFIGURATION_DIGEST;
  const policyPublicKeys = source.SISYPHUS_POLICY_PUBLIC_KEYS;
  if (
    policyFile === undefined ||
    controlPlaneUrl === undefined ||
    tenantId === undefined ||
    deviceId === undefined ||
    adapterInstallationId === undefined ||
    runtimeProfile === undefined ||
    adapterConfigurationDigest === undefined ||
    policyPublicKeys === undefined
  ) {
    throw new Error("Cloud-managed worker provisioning lost a required value.");
  }

  return {
    kind: "cloud-managed",
    policyFile: resolve(policyFile),
    controlPlaneUrl: normalizedControlPlaneUrl(controlPlaneUrl),
    tenantId,
    deviceId,
    adapterInstallationId,
    runtimeProfile,
    adapterConfigurationDigest,
    serializedPolicyPublicKeys: serializedPolicyPublicKeys(policyPublicKeys),
    deviceCredential:
      source.SISYPHUS_DEVICE_TOKEN === undefined
        ? { kind: "stored" }
        : { kind: "provided", value: source.SISYPHUS_DEVICE_TOKEN },
  };
}

export async function resolveManagedWorkerProvisioning(input: {
  readonly configuration: ParsedManagedWorkerProvisioning;
  readonly loadDeviceToken: () => Promise<string | undefined>;
  readonly persistDeviceToken: (value: string) => Promise<string>;
}): Promise<ManagedWorkerProvisioning> {
  if (input.configuration.kind !== "cloud-managed") return input.configuration;
  const deviceToken =
    input.configuration.deviceCredential.kind === "provided"
      ? await input.persistDeviceToken(input.configuration.deviceCredential.value)
      : await input.loadDeviceToken();
  if (deviceToken === undefined) {
    throw new Error(
      "Cloud-managed worker provisioning requires a device token from enrollment or encrypted device storage.",
    );
  }
  const {
    deviceCredential: _deviceCredential,
    ...configuration
  } = input.configuration;
  return {
    ...configuration,
    deviceToken: ProvisionedDeviceTokenSchema.parse(deviceToken),
  };
}

export function managedWorkerChildEnvironment(
  provisioning: ManagedWorkerProvisioning,
): Readonly<Record<string, string>> {
  if (provisioning.kind === "offline-default") return {};
  if (provisioning.kind === "local-policy") {
    return { SISYPHUS_POLICY_FILE: provisioning.policyFile };
  }
  return {
    SISYPHUS_POLICY_FILE: provisioning.policyFile,
    SISYPHUS_CONTROL_PLANE_URL: provisioning.controlPlaneUrl,
    SISYPHUS_DEVICE_TOKEN: provisioning.deviceToken,
    SISYPHUS_TENANT_ID: provisioning.tenantId,
    SISYPHUS_DEVICE_ID: provisioning.deviceId,
    SISYPHUS_ADAPTER_INSTALLATION_ID: provisioning.adapterInstallationId,
    SISYPHUS_RUNTIME_PROFILE: provisioning.runtimeProfile,
    SISYPHUS_ADAPTER_CONFIGURATION_DIGEST:
      provisioning.adapterConfigurationDigest,
    SISYPHUS_POLICY_PUBLIC_KEYS: provisioning.serializedPolicyPublicKeys,
  };
}
