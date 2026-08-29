import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop renderer credential boundary", () => {
  it("does not compile API bearer credentials into renderer JavaScript", async () => {
    const [source, preload] = await Promise.all([
      readFile(new URL("./renderer/main.tsx", import.meta.url), "utf8"),
      readFile(new URL("./preload.ts", import.meta.url), "utf8"),
    ]);
    const rendererBoundary = `${source}\n${preload}`;

    expect(rendererBoundary).not.toContain("VITE_SISYPHUS_DEMO_TOKEN");
    expect(rendererBoundary).not.toContain("createHttpDataClient");
    expect(rendererBoundary).not.toContain("SISYPHUS_DEVICE_TOKEN");
    expect(rendererBoundary).not.toContain("SISYPHUS_POLICY_PUBLIC_KEYS");
    expect(rendererBoundary).not.toContain("SISYPHUS_CONTROL_PLANE_URL");
    expect(source).not.toContain("setInterval");
    expect(source).toContain("useState<SisyphusDataClient>()");
  });
});
