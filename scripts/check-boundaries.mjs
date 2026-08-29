import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryRoot);
const protectedRoots = ["packages/domain", "packages/kernel"];
const forbiddenPatterns = [
  /from\s+["'][^"']*(?:codex|claude|cursor|opencode)[^"']*["']/iu,
  /import\s*\([^)]*(?:codex|claude|cursor|opencode)[^)]*\)/iu,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return [path];
    }),
  );
  return files.flat();
}

const violations = [];

for (const root of protectedRoots) {
  const rootPath = fileURLToPath(new URL(`${root}/`, repositoryRoot));
  let files;
  try {
    files = await sourceFiles(rootPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }

  for (const path of files.filter((file) => [".ts", ".tsx"].includes(extname(file)))) {
    const source = await readFile(path, "utf8");
    if (forbiddenPatterns.some((pattern) => pattern.test(source))) {
      violations.push(relative(repositoryPath, path));
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Runtime-neutral packages import runtime-specific code:\n${violations.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Runtime boundary check passed.\n");
}
