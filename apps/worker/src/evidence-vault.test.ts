import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EncryptedEvidenceVault } from "./evidence-vault.js";

describe("EncryptedEvidenceVault", () => {
  it("round-trips evidence without writing plaintext to disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-vault-"));
    const vault = new EncryptedEvidenceVault({
      directory,
      key: randomBytes(32),
    });

    const evidence = "secret source code: const token = 'never-upload-this'";
    const record = await vault.store({ evidence, redactedExcerpt: "secret source code: [redacted]" });

    await expect(vault.read(record.handle)).resolves.toBe(evidence);
    const encrypted = await readFile(join(directory, `${record.handle}.evidence`));
    expect(encrypted.toString("utf8")).not.toContain("never-upload-this");
    expect(record.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects evidence encrypted with another device key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-vault-"));
    const first = new EncryptedEvidenceVault({ directory, key: randomBytes(32) });
    const second = new EncryptedEvidenceVault({ directory, key: randomBytes(32) });
    const record = await first.store({ evidence: "private", redactedExcerpt: "[redacted]" });

    await expect(second.read(record.handle)).rejects.toThrow();
  });
});

