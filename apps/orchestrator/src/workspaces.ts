import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { AgentPatchProposal } from "@sisyphus/domain";

const execFileAsync = promisify(execFile);

export interface TaskWorkspace {
  readonly root: string;
  readonly repository: string;
  readonly baseCommit: string;
}

export interface AppliedAgentChange {
  readonly workspaceId: string;
  readonly branch: string;
  readonly filesChanged: readonly string[];
  readonly diffDigest: string;
  readonly commitId: string;
}

export interface ExecutionArchiveResult {
  readonly directory: string;
  readonly slot: number;
}

export interface ProjectContextFile {
  readonly path: string;
  readonly content: string;
}

export class WorkspaceManager {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly executionArchiveRoot: string,
  ) {}

  public async createTaskWorkspace(taskId: string): Promise<TaskWorkspace> {
    const safeTaskId = safeSegment(taskId, "task ID");
    await mkdir(this.workspaceRoot, { recursive: true });
    const root = await mkdtemp(join(this.workspaceRoot, `${safeTaskId}-`));
    const repository = join(root, "repository");
    await mkdir(repository);
    await runGit(repository, ["init", "--initial-branch=main"]);
    await writeFile(join(repository, ".gitignore"), "node_modules/\ndist/\n.env\n", "utf8");
    await writeFile(
      join(repository, "README.md"),
      "# Sisyphus generated project\n\nThis source bundle is evaluated only in the Sisyphus sandbox.\n",
      "utf8",
    );
    await runGit(repository, ["add", "--", ".gitignore", "README.md"]);
    await runGit(repository, [
      "-c",
      "user.name=Sisyphus Orchestrator",
      "-c",
      "user.email=orchestrator@sisyphus.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Initialize Sisyphus task workspace",
    ]);
    return { root, repository, baseCommit: await gitOutput(repository, ["rev-parse", "HEAD"]) };
  }

  public async applyAgentProposal(input: {
    task: TaskWorkspace;
    assignmentId: string;
    role: string;
    iteration: number;
    baseCommit?: string;
    proposal: AgentPatchProposal;
  }): Promise<AppliedAgentChange> {
    const safeAssignmentId = safeSegment(input.assignmentId, "assignment ID");
    const safeRole = safeSegment(input.role.replaceAll(" ", "-"), "role");
    const workspaceId = `workspace-${safeAssignmentId}-${input.iteration}`;
    const branch = `task/${safeAssignmentId}/${safeRole}/attempt-${input.iteration}`;
    const worktree = join(input.task.root, workspaceId);
    await runGit(input.task.repository, [
      "worktree",
      "add",
      "--detach",
      worktree,
      input.baseCommit ?? input.task.baseCommit,
    ]);
    try {
      await runGit(worktree, ["checkout", "-b", branch]);
      const filesChanged = input.proposal.files.map((file) => normalizeRelativePath(file.path));
      if (new Set(filesChanged).size !== filesChanged.length) {
        throw new Error("An agent proposal cannot contain the same file twice.");
      }
      for (const file of input.proposal.files) {
        const target = resolve(worktree, normalizeRelativePath(file.path));
        assertDescendant(worktree, target);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
      }
      await runGit(worktree, ["add", "--", ...filesChanged]);
      await runGit(worktree, [
        "-c",
        "user.name=Sisyphus Agent",
        "-c",
        "user.email=agent@sisyphus.invalid",
        "commit",
        "--no-gpg-sign",
        "-m",
        `Apply ${safeRole} assignment ${safeAssignmentId} attempt ${input.iteration}`,
      ]);
      const commitId = await gitOutput(worktree, ["rev-parse", "HEAD"]);
      const diff = await gitOutput(worktree, ["show", "--format=", "--binary", "HEAD"]);
      return {
        workspaceId,
        branch,
        filesChanged,
        diffDigest: createHash("sha256").update(diff, "utf8").digest("hex"),
        commitId,
      };
    } finally {
      await runGit(input.task.repository, ["worktree", "remove", "--force", worktree]);
    }
  }

  public async integrate(input: {
    task: TaskWorkspace;
    branches: readonly string[];
    baseCommit?: string;
  }): Promise<
    | { readonly kind: "integrated"; readonly workspace: string; readonly commitId: string }
    | {
        readonly kind: "conflict";
        readonly branch: string;
        readonly detail: string;
        readonly conflictingFiles: readonly string[];
        readonly baseCommit: string;
      }
  > {
    const integrationWorkspace = join(input.task.root, "integration");
    await runGit(input.task.repository, ["worktree", "remove", "--force", integrationWorkspace]).catch(
      () => undefined,
    );
    await rm(integrationWorkspace, { recursive: true, force: true, maxRetries: 2 });
    await runGit(input.task.repository, [
      "worktree",
      "add",
      "--detach",
      integrationWorkspace,
      input.baseCommit ?? input.task.baseCommit,
    ]);
    try {
      for (const branch of input.branches) {
        try {
          await runGit(integrationWorkspace, [
            "-c",
            "user.name=Sisyphus Integrator",
            "-c",
            "user.email=integrator@sisyphus.invalid",
            "merge",
            "--no-ff",
            "--no-edit",
            branch,
          ]);
        } catch (error: unknown) {
          const conflictingFiles = (await gitOutput(integrationWorkspace, [
            "diff",
            "--name-only",
            "--diff-filter=U",
          ]).catch(() => ""))
            .split(/\r?\n/gu)
            .filter((path) => path.length > 0);
          await runGit(integrationWorkspace, ["merge", "--abort"]).catch(() => undefined);
          return {
            kind: "conflict",
            branch,
            detail: error instanceof Error ? sanitizeGitFailure(error.message) : "Git reported a merge conflict.",
            conflictingFiles,
            baseCommit: await gitOutput(integrationWorkspace, ["rev-parse", "HEAD"]),
          };
        }
      }
      return {
        kind: "integrated",
        workspace: integrationWorkspace,
        commitId: await gitOutput(integrationWorkspace, ["rev-parse", "HEAD"]),
      };
    } catch (error: unknown) {
      await runGit(input.task.repository, ["worktree", "remove", "--force", integrationWorkspace]).catch(
        () => undefined,
      );
      throw error;
    }
  }

  public async cleanup(task: TaskWorkspace): Promise<void> {
    await access(task.root);
    await rm(task.root, { recursive: true, force: true, maxRetries: 3 });
  }

  public async archiveIntegration(integrationWorkspace: string): Promise<ExecutionArchiveResult> {
    await mkdir(this.executionArchiveRoot, { recursive: true });
    for (let slot = 1; slot <= Number.MAX_SAFE_INTEGER; slot += 1) {
      const destination = join(this.executionArchiveRoot, String(slot));
      try {
        await mkdir(destination);
      } catch (error: unknown) {
        if (isAlreadyExistsError(error)) continue;
        throw error;
      }
      try {
        const entries = await readdir(integrationWorkspace, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === ".git") continue;
          await cp(join(integrationWorkspace, entry.name), join(destination, entry.name), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
        return { directory: destination, slot };
      } catch (error: unknown) {
        await rm(destination, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
        throw error;
      }
    }
    throw new Error("No safe execution archive slot is available.");
  }

  public async readProjectContext(integrationWorkspace: string): Promise<readonly ProjectContextFile[]> {
    const files: ProjectContextFile[] = [];
    await collectProjectContext({
      root: integrationWorkspace,
      directory: integrationWorkspace,
      files,
      maximumFiles: 24,
      maximumCharacters: 60_000,
    });
    return files;
  }
}

async function runGit(cwd: string, arguments_: readonly string[]): Promise<void> {
  await execFileAsync("git", [...arguments_], {
    cwd,
    shell: false,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function gitOutput(cwd: string, arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...arguments_], {
    cwd,
    shell: false,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u.test(value)) {
    throw new Error(`The ${label} is not safe for a trusted Git workspace.`);
  }
  return value;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("Agent file paths must be safe relative paths.");
  }
  return normalized;
}

function assertDescendant(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error("Agent file path escapes its assigned workspace.");
  }
}

function sanitizeGitFailure(value: string): string {
  return value.replaceAll(/[\r\n]+/gu, " ").slice(0, 500);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function collectProjectContext(input: {
  readonly root: string;
  readonly directory: string;
  readonly files: ProjectContextFile[];
  readonly maximumFiles: number;
  readonly maximumCharacters: number;
}): Promise<void> {
  if (input.files.length >= input.maximumFiles) return;
  const entries = (await readdir(input.directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (input.files.length >= input.maximumFiles) return;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".env")) {
      continue;
    }
    const target = join(input.directory, entry.name);
    if (entry.isDirectory()) {
      await collectProjectContext({ ...input, directory: target });
      continue;
    }
    if (!entry.isFile() || !isReviewableSource(entry.name)) continue;
    const content = await readFile(target, "utf8");
    if (content.includes("\u0000")) continue;
    const existingCharacters = input.files.reduce((total, file) => total + file.content.length, 0);
    if (existingCharacters + content.length > input.maximumCharacters) continue;
    input.files.push({
      path: relative(input.root, target).replaceAll(sep, "/"),
      content,
    });
  }
}

function isReviewableSource(name: string): boolean {
  return /^(?:[A-Za-z0-9._-]+\.(?:html|css|js|jsx|ts|tsx|json|md)|package\.json)$/iu.test(name);
}
