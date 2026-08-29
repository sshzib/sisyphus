import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function applicationSources(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const child = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        return applicationSources(new URL(`${entry.name}/`, directory));
      }
      return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [child] : [];
    }),
  );
  return sources.flat();
}

describe("hosted dashboard authentication boundary", () => {
  it("does not compile public environment credentials into the browser", async () => {
    const sourceFiles = await applicationSources(new URL("./app/", import.meta.url));
    const sources = await Promise.all(
      sourceFiles.map(async (sourceFile) => readFile(sourceFile, "utf8")),
    );
    const applicationSource = sources.join("\n");

    expect(applicationSource).not.toContain("process.env.NEXT_PUBLIC");
    expect(applicationSource).not.toContain("createHttpDataClient");
    expect(applicationSource).not.toMatch(/from\s+["']@sisyphus\/ui["']/u);
  });
});
