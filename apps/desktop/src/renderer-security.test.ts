import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop renderer credential boundary", () => {
  it("does not compile API bearer credentials into renderer JavaScript", async () => {
    const source = await readFile(
      new URL("./renderer/main.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("VITE_SISYPHUS_DEMO_TOKEN");
    expect(source).not.toContain("createHttpDataClient");
  });
});
