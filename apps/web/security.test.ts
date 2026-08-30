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
  it("exposes only the Supabase publishable configuration to browser code", async () => {
    const sourceFiles = (
      await Promise.all([
        applicationSources(new URL("./app/", import.meta.url)),
        applicationSources(new URL("./lib/", import.meta.url)),
      ])
    ).flat();
    const sources = await Promise.all(
      sourceFiles.map(async (sourceFile) => readFile(sourceFile, "utf8")),
    );
    const applicationSource = sources.join("\n");

    const publicEnvironmentReferences = [
      ...applicationSource.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/gu),
    ].map((match) => match[1]);
    expect(new Set(publicEnvironmentReferences)).toEqual(
      new Set([
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
      ]),
    );
    expect(applicationSource).not.toMatch(/SUPABASE_(?:SECRET|SERVICE_ROLE)/u);
    expect(applicationSource).not.toContain("SISYPHUS_WEB_SESSION_KEY");
    expect(applicationSource).not.toContain("Tenant access token");
    expect(applicationSource).not.toContain("createHttpDataClient");
    expect(applicationSource).not.toMatch(/from\s+["']@sisyphus\/ui["']/u);
  });
});
