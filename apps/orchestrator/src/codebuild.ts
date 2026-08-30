import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import {
  BatchGetBuildsCommand,
  CodeBuildClient,
  StartBuildCommand,
  StopBuildCommand,
} from "@aws-sdk/client-codebuild";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { OrchestratorConfiguration } from "./config.js";
import {
  ExecutionResultSchema,
  EngineeringExecutionStoppedError,
  type ExecutionResult,
  type ProjectExecution,
  type ProjectExecutor,
} from "./execution.js";

export class CodeBuildSandbox implements ProjectExecutor {
  public readonly backend = "codebuild";
  readonly #codeBuild: CodeBuildClient;
  readonly #s3: S3Client;

  public constructor(
    private readonly configuration: NonNullable<OrchestratorConfiguration["codebuild"]>,
  ) {
    this.#codeBuild = new CodeBuildClient({ region: configuration.region });
    this.#s3 = new S3Client({ region: configuration.region });
  }

  public async execute(input: Parameters<ProjectExecutor["execute"]>[0]): Promise<ProjectExecution> {
    await this.#assertStillRunning(input.shouldContinue);
    const sourceDigest = await archiveWorkspace(input.workspace);
    const archivePath = sourceDigest.archivePath;
    const runId = `sandbox-${randomUUID()}`;
    const sourceKey = `${trimSlashes(this.configuration.inputPrefix)}/${input.taskId}/${input.integrationCommit}-${sourceDigest.digest}.zip`;
    const resultKey = `${trimSlashes(this.configuration.resultPrefix)}/${input.taskId}/${runId}.json`;
    try {
      await this.#s3.send(
        new PutObjectCommand({
          Bucket: this.configuration.artifactBucket,
          Key: sourceKey,
          Body: createReadStream(archivePath),
          ContentType: "application/zip",
          Metadata: { "sisyphus-source-digest": sourceDigest.digest },
        }),
      );
      await this.#assertStillRunning(input.shouldContinue);
      const started = await this.#codeBuild.send(
        new StartBuildCommand({
          projectName: this.configuration.projectName,
          // This location is constructed from configured, scoped prefixes.
          // The CodeBuild project still owns the trusted buildspec; generated
          // work cannot choose commands through StartBuild.
          sourceTypeOverride: "S3",
          sourceLocationOverride: `${this.configuration.artifactBucket}/${sourceKey}`,
          environmentVariablesOverride: [
            { name: "SISYPHUS_INPUT_BUCKET", value: this.configuration.artifactBucket, type: "PLAINTEXT" },
            { name: "SISYPHUS_INPUT_KEY", value: sourceKey, type: "PLAINTEXT" },
            { name: "SISYPHUS_RESULT_BUCKET", value: this.configuration.artifactBucket, type: "PLAINTEXT" },
            { name: "SISYPHUS_RESULT_KEY", value: resultKey, type: "PLAINTEXT" },
            { name: "SISYPHUS_SOURCE_DIGEST", value: sourceDigest.digest, type: "PLAINTEXT" },
            { name: "SISYPHUS_RUN_ID", value: runId, type: "PLAINTEXT" },
            { name: "SISYPHUS_TASK_ID", value: input.taskId, type: "PLAINTEXT" },
          ],
        }),
      );
      const buildId = started.build?.id;
      if (buildId === undefined) {
        throw new Error("CodeBuild accepted the request without returning a build ID.");
      }
      try {
        await this.#assertStillRunning(input.shouldContinue);
      } catch (error: unknown) {
        await this.#stopBuild(buildId);
        throw error;
      }
      try {
        await input.onExecutionStarted?.({
          backend: this.backend,
          executionId: buildId,
          detectedPort: null,
        });
      } catch (error: unknown) {
        await this.#stopBuild(buildId);
        throw error;
      }
      await this.#waitForCompletion(buildId, input.shouldContinue);
      return {
        backend: this.backend,
        executionId: buildId,
        result: await this.#readResult(resultKey),
      };
    } finally {
      await rm(archivePath, { force: true });
    }
  }

  async #waitForCompletion(
    buildId: string,
    shouldContinue: (() => Promise<boolean>) | undefined,
  ): Promise<void> {
    const deadline = Date.now() + 20 * 60 * 1_000;
    while (Date.now() < deadline) {
      try {
        await this.#assertStillRunning(shouldContinue);
      } catch (error: unknown) {
        await this.#stopBuild(buildId);
        throw error;
      }
      const response = await this.#codeBuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = response.builds?.[0];
      if (build?.buildComplete) return;
      await wait(5_000);
    }
    throw new Error("CodeBuild did not complete before the orchestrator deadline.");
  }

  async #assertStillRunning(shouldContinue: (() => Promise<boolean>) | undefined): Promise<void> {
    if (shouldContinue !== undefined && !(await shouldContinue())) {
      throw new EngineeringExecutionStoppedError();
    }
  }

  async #stopBuild(buildId: string): Promise<void> {
    await this.#codeBuild.send(new StopBuildCommand({ id: buildId })).catch(() => undefined);
  }

  async #readResult(key: string): Promise<ExecutionResult | undefined> {
    try {
      const response = await this.#s3.send(
        new GetObjectCommand({ Bucket: this.configuration.artifactBucket, Key: key }),
      );
      const body = response.Body;
      if (body === undefined) return undefined;
      return ExecutionResultSchema.parse(JSON.parse(await body.transformToString()));
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === "object" &&
        "$metadata" in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return undefined;
      }
      throw error;
    }
  }
}

async function archiveWorkspace(workspace: string): Promise<{
  archivePath: string;
  digest: string;
}> {
  const archivePath = join(workspace, ".sisyphus-source.zip");
  const trustedRunner = await readFile(
    fileURLToPath(new URL("../../../infra/codebuild/runner.mjs", import.meta.url)),
    "utf8",
  );
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(archivePath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolvePromise);
    output.on("error", rejectPromise);
    archive.on("error", rejectPromise);
    archive.pipe(output);
    archive.glob("**/*", {
      cwd: workspace,
      dot: true,
      ignore: [".git/**", "node_modules/**", "dist/**", "build/**", ".next/**", ".sisyphus-source.zip"],
    });
    archive.append(trustedRunner, { name: ".sisyphus/runner.mjs", mode: 0o644 });
    void archive.finalize();
  });
  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  return { archivePath, digest };
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/gu, "");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
