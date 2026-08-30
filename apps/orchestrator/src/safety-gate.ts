import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";

const PackageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type SafetyFinding = {
  category: "dependency" | "script" | "secret" | "filesystem" | "network" | "source";
  severity: "warning" | "critical";
  detail: string;
};

export type SafetyReport = {
  passed: boolean;
  findings: readonly SafetyFinding[];
  packageManager: "npm" | "pnpm" | "none";
  executionPlan: "package" | "static-site";
  commands: {
    build: boolean;
    dev: boolean;
    test: boolean;
    lint: boolean;
  };
};

const allowedScripts = new Set(["build", "dev", "test", "test:e2e", "lint", "typecheck"]);
const forbiddenScriptPattern = /(?:^|\s)(?:rm|del|rmdir|curl|wget|powershell|cmd|bash|sh|chmod|chown|sudo|docker|git)\b|[;&|`]|\$\(|>\s*\S/iu;
const credentialPattern = /\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}|sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/u;
const unsafeSourcePattern = /(?:node:child_process|from\s+["']child_process|require\(["']child_process|\beval\s*\(|\bFunction\s*\(|process\.binding\s*\()/u;
const hostFilesystemPattern = /(?:node:fs|from\s+["']fs|require\(["']fs)/u;
const outboundNetworkPattern = /(?:node:https|node:http|from\s+["']https?|require\(["']https?)/u;

export async function scanWorkspace(workspace: string): Promise<SafetyReport> {
  const findings: SafetyFinding[] = [];
  const files = await sourceFiles(workspace, findings);
  const packageJsonPath = join(workspace, "package.json");
  if (!files.includes("package.json")) {
    await inspectSources(workspace, files, findings);
    if (!isStaticSite(files)) {
      findings.push({
        category: "dependency",
        severity: "critical",
        detail: "The generated project has neither package.json nor a static index.html entry point, so Sisyphus cannot determine a safe execution plan.",
      });
    }
    return {
      passed: !findings.some((finding) => finding.severity === "critical"),
      findings,
      packageManager: "none",
      executionPlan: "static-site",
      commands: { build: false, dev: false, test: false, lint: false },
    };
  }

  const manifest = PackageJsonSchema.safeParse(
    parseJson(await readFile(packageJsonPath, "utf8")),
  );
  if (!manifest.success) {
    findings.push({
      category: "dependency",
      severity: "critical",
      detail: "package.json is not a valid manifest for the sandbox policy.",
    });
  } else {
    inspectManifest(manifest.data, findings);
  }

  const hasPnpm = files.includes("pnpm-lock.yaml");
  const hasNpm = files.includes("package-lock.json");
  const dependencyFreeStaticProject =
    manifest.success && isDependencyFreeStaticManifest(manifest.data);
  if (dependencyFreeStaticProject && !isStaticSite(files)) {
    findings.push({
      category: "dependency",
      severity: "critical",
      detail: "A dependency-free static project must include index.html as its safe entry point.",
    });
  }
  if (hasPnpm === hasNpm && !dependencyFreeStaticProject) {
    findings.push({
      category: "dependency",
      severity: "critical",
      detail: "Exactly one supported lockfile (pnpm-lock.yaml or package-lock.json) is required.",
    });
  }
  await inspectSources(workspace, files, findings);
  const scripts = manifest.success ? manifest.data.scripts ?? {} : {};
  return {
    passed: !findings.some((finding) => finding.severity === "critical"),
    findings,
    packageManager: hasPnpm ? "pnpm" : "npm",
    executionPlan: dependencyFreeStaticProject ? "static-site" : "package",
    commands: {
      build: scripts.build !== undefined,
      dev: scripts.dev !== undefined,
      test: scripts.test !== undefined,
      lint: scripts.lint !== undefined || scripts.typecheck !== undefined,
    },
  };
}

function isStaticSite(files: readonly string[]): boolean {
  return files.includes("index.html");
}

async function inspectSources(
  workspace: string,
  files: readonly string[],
  findings: SafetyFinding[],
): Promise<void> {
  for (const file of files) {
    if (file === "package.json") continue;
    const content = await readFile(join(workspace, file), "utf8");
    inspectSource(file, content, findings);
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isDependencyFreeStaticManifest(manifest: z.infer<typeof PackageJsonSchema>): boolean {
  return (
    Object.keys(manifest.scripts ?? {}).length === 0 &&
    Object.keys(manifest.dependencies ?? {}).length === 0 &&
    Object.keys(manifest.devDependencies ?? {}).length === 0
  );
}

function inspectManifest(
  manifest: z.infer<typeof PackageJsonSchema>,
  findings: SafetyFinding[],
): void {
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    if (!allowedScripts.has(name)) {
      findings.push({
        category: "script",
        severity: "critical",
        detail: `The ${name} lifecycle script is not allowed in the generated sandbox project.`,
      });
      continue;
    }
    if (forbiddenScriptPattern.test(script)) {
      findings.push({
        category: "script",
        severity: "critical",
        detail: `The ${name} script contains a forbidden command form.`,
      });
    }
  }
  for (const version of Object.values({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  })) {
    if (/^(?:file:|git\+|https?:|github:|gitlab:)/iu.test(version)) {
      findings.push({
        category: "dependency",
        severity: "critical",
        detail: "Dependencies must resolve from the configured package registry, not local paths or arbitrary Git/HTTP sources.",
      });
      break;
    }
  }
}

function inspectSource(file: string, content: string, findings: SafetyFinding[]): void {
  if (file === ".sisyphus" || file.startsWith(".sisyphus/")) {
    findings.push({
      category: "source",
      severity: "critical",
      detail: "The .sisyphus control directory is reserved for the trusted sandbox runner.",
    });
  }
  if (credentialPattern.test(content)) {
    findings.push({
      category: "secret",
      severity: "critical",
      detail: `Credential-shaped content was found in ${file}.`,
    });
  }
  if (unsafeSourcePattern.test(content)) {
    findings.push({
      category: "source",
      severity: "critical",
      detail: `Unsafe process execution or dynamic evaluation was found in ${file}.`,
    });
  }
  if (hostFilesystemPattern.test(content)) {
    findings.push({
      category: "filesystem",
      severity: "critical",
      detail: `Host filesystem access was found in ${file}.`,
    });
  }
  if (outboundNetworkPattern.test(content)) {
    findings.push({
      category: "network",
      severity: "warning",
      detail: `Outbound network code was found in ${file}; CodeBuild egress must remain registry-only for the MVP.`,
    });
  }
}

async function sourceFiles(root: string, findings: SafetyFinding[]): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", "build", ".next"].includes(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        findings.push({
          category: "filesystem",
          severity: "critical",
          detail: `Symbolic links are not allowed (${relativePath}).`,
        });
        continue;
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) continue;
      if (metadata.size > 1_000_000) {
        findings.push({
          category: "source",
          severity: "critical",
          detail: `A generated source file exceeds the 1 MB policy limit (${relativePath}).`,
        });
        continue;
      }
      output.push(relativePath);
    }
  }
  await visit(root);
  return output;
}
