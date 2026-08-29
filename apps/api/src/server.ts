import { createApp } from "./app.js";
import { Ed25519PolicyBundleSigner } from "./policy-bundle.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";
import {
  parseServerEnvironment,
  selectServerRepository,
} from "./server-config.js";

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

const app = await createApp({
  logger: environment.nodeEnvironment !== "test",
  corsOrigins: [environment.webOrigin],
  repository,
  policyBundleSigner,
});

await app.listen({
  host: environment.host,
  port: environment.port,
});
