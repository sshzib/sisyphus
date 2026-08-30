# Sisyphus CodeBuild sandbox

Sisyphus sends an integrated, safety-scanned ZIP to a dedicated S3 prefix and
starts one dedicated CodeBuild project. The project must use this directory's
`buildspec.yml` as its immutable buildspec. Do not allow `buildspecOverride`
from callers.

The orchestrator supplies only a controlled S3 source override beneath
`engineering/input/` and result locations beneath `engineering/results/`. The
runner installs dependencies without lifecycle scripts, builds, starts a
development server when the project provides one, discovers its port from
process output, runs an HTTP health check, runs available tests and static
checks, writes structured results, and tears the server down.

## Identities

Use two distinct least-privilege identities:

- **Orchestrator identity**: `codebuild:StartBuild`,
  `codebuild:BatchGetBuilds`, and `codebuild:StopBuild` for this one project;
  `s3:PutObject` below `engineering/input/`; `s3:GetObject` below
  `engineering/results/`.
- **CodeBuild service role**: `s3:GetObject` below `engineering/input/` and
  `s3:PutObject` below `engineering/results/`, plus its own scoped CloudWatch
  Logs permissions.

Neither identity should have AWS root credentials, broad S3 access,
`iam:PassRole`, administrative permissions, or access to desktop secrets.
The desktop application has no AWS credentials: it talks only to the Sisyphus
control plane.

## Project configuration

Create a dedicated project in the same region as the artifact bucket. Configure
its source type as **S3**, enable `privilegedMode: false` unless a future,
reviewed workload needs it, and set this repository's `buildspec.yml` as the
project buildspec. Scope bucket policies to the input/result prefixes above.

Configure the orchestrator with environment variables, never checked-in
credentials:

```text
AWS_REGION=...
SISYPHUS_CODEBUILD_PROJECT=...
SISYPHUS_ARTIFACT_BUCKET=...
SISYPHUS_ARTIFACT_INPUT_PREFIX=engineering/input
SISYPHUS_ARTIFACT_RESULT_PREFIX=engineering/results
```

The AWS SDK obtains the orchestrator identity from the runtime's standard
credential provider chain. Prefer a workload role, such as an ECS task role,
over long-lived access keys.
