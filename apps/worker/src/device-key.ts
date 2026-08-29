export interface DeviceKeyProvider {
  load(): Promise<Uint8Array>;
}

interface EnvironmentDeviceKeyProviderInput {
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export class EnvironmentDeviceKeyProvider implements DeviceKeyProvider {
  readonly #environment: Readonly<Record<string, string | undefined>>;

  constructor(input: EnvironmentDeviceKeyProviderInput) {
    this.#environment = input.environment;
  }

  async load(): Promise<Uint8Array> {
    const encoded = this.#environment["SISYPHUS_EVIDENCE_KEY"];
    if (encoded === undefined || encoded.trim() === "") {
      throw new Error(
        "SISYPHUS_EVIDENCE_KEY is required. The Electron shell must load it from the OS credential store before starting the worker.",
      );
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32) {
      throw new Error("SISYPHUS_EVIDENCE_KEY must decode to exactly 32 bytes.");
    }
    return key;
  }
}

