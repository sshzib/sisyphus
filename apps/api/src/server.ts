import { createApp } from "./app.js";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { FileEngineeringEventJournal } from "./engineering-event-journal.js";
import { InMemoryEngineeringTaskStore } from "./engineering-store.js";
import { Ed25519PolicyBundleSigner } from "./policy-bundle.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";
import {
  parseServerEnvironment,
  selectServerRepository,
} from "./server-config.js";
import { createSupabaseCredentialResolver } from "./supabase-auth.js";

const environment = parseServerEnvironment(process.env);

const secretCipher =
  environment.secretEncryptionKey === undefined
    ? new AesGcmSecretCipher()
    : AesGcmSecretCipher.fromBase64(
        environment.secretEncryptionKey,
      );
const policyBundleSigner =
  environment.policySigningKey === undefined
    ? Ed25519PolicyBundleSigner.generate(environment.policyKeyId)
    : Ed25519PolicyBundleSigner.fromPem({
        keyId: environment.policyKeyId,
        privateKeyPem: Buffer.from(
          environment.policySigningKey,
          "base64",
        ).toString("utf8"),
      });
const repository = await selectServerRepository({ environment, secretCipher });
const externalCredentialResolver =
  environment.supabaseAuth.kind === "enabled"
    ? createSupabaseCredentialResolver({
        projectUrl: environment.supabaseAuth.projectUrl,
        ...(environment.supabaseAuth.defaultTenantId === undefined
          ? {}
          : { defaultTenantId: environment.supabaseAuth.defaultTenantId }),
        defaultRole: environment.supabaseAuth.defaultRole,
      })
    : undefined;

const app = await createApp({
  logger: environment.nodeEnvironment !== "test",
  corsOrigins: [environment.webOrigin],
  repository,
  ...(externalCredentialResolver === undefined
    ? {}
    : { externalCredentialResolver }),
  policyBundleSigner,
  engineeringTaskStore: new InMemoryEngineeringTaskStore(
    new FileEngineeringEventJournal(
      resolve(homedir(), "Desktop", "Sisyphus Executions", "logs", "engineering-events.jsonl"),
    ),
  ),
  ...(environment.orchestratorToken === undefined
    ? {}
    : { orchestratorToken: environment.orchestratorToken }),
});

await app.listen({
  host: environment.host,
  port: environment.port,
});
