import { describe, expect, it, vi } from "vitest";

import { probeCodexRuntimeVersion } from "../src/index.js";

describe("Codex runtime probing", () => {
  it("uses an explicitly installed runtime version without spawning a command", async () => {
    const execute = vi.fn();

    await expect(
      probeCodexRuntimeVersion({
        environment: { SISYPHUS_CODEX_RUNTIME_VERSION: "0.99.0" },
        execute,
      }),
    ).resolves.toBe("0.99.0");
    expect(execute).not.toHaveBeenCalled();
  });

  it("extracts a concrete version from the Codex executable", async () => {
    await expect(
      probeCodexRuntimeVersion({
        environment: {},
        platform: "linux",
        execute: async (command, arguments_) => {
          expect(command).toBe("codex");
          expect(arguments_).toEqual(["--version"]);
          return { stdout: "codex-cli 1.2.3\n" };
        },
      }),
    ).resolves.toBe("1.2.3");
  });

  it("uses the Windows command processor for npm command shims", async () => {
    await expect(
      probeCodexRuntimeVersion({
        environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        platform: "win32",
        execute: async (command, arguments_) => {
          expect(command).toBe("C:\\Windows\\System32\\cmd.exe");
          expect(arguments_).toEqual(["/d", "/s", "/c", "codex --version"]);
          return { stdout: "codex-cli 1.2.3\n" };
        },
      }),
    ).resolves.toBe("1.2.3");
  });

  it("rejects unknown and unversioned probe results", async () => {
    await expect(
      probeCodexRuntimeVersion({
        environment: { SISYPHUS_CODEX_RUNTIME_VERSION: "unknown" },
        execute: vi.fn(),
      }),
    ).rejects.toThrow("concrete Codex runtime version");
    await expect(
      probeCodexRuntimeVersion({
        environment: {},
        platform: "linux",
        execute: async () => ({ stdout: "codex development build" }),
      }),
    ).rejects.toThrow("versioned output");
  });
});
