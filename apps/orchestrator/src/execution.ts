import { z } from "zod";

export const ExecutionBackendSchema = z.enum(["local-static", "codebuild"]);
export type ExecutionBackend = z.infer<typeof ExecutionBackendSchema>;

export const ExecutionResultSchema = z
  .object({
    version: z.literal(1),
    passed: z.boolean(),
    detectedPort: z.number().int().min(1).max(65_535).nullable(),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(160),
            status: z.enum(["passed", "failed", "skipped"]),
            exitCode: z.number().int().nullable(),
            durationMs: z.number().int().nonnegative(),
            stdout: z.string().max(24_000),
            stderr: z.string().max(24_000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export type ProjectExecution = {
  readonly backend: ExecutionBackend;
  readonly executionId: string;
  readonly result: ExecutionResult | undefined;
};

export interface ProjectExecutor {
  readonly backend: ExecutionBackend;

  execute(input: {
    readonly taskId: string;
    readonly integrationCommit: string;
    readonly workspace: string;
    readonly expectedPlan: "package" | "static-site";
    readonly onExecutionStarted?: (input: {
      readonly backend: ExecutionBackend;
      readonly executionId: string;
      readonly detectedPort: number | null;
    }) => Promise<void>;
  }): Promise<ProjectExecution>;
}
