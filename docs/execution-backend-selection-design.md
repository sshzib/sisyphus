# Execution backend selection

## Problem

The control plane can stop engineering work, but the orchestrator used one executor for every tenant when it started. A demo needs an AWS CodeBuild option and a local fallback without running generated commands on the host.

## Usage

An administrator stops execution, selects **AWS sandbox** or **Local static fallback**, and starts execution. The next leased task carries the selected backend. The orchestrator uses that backend for the whole task.

```ts
await client.stopEngineeringExecution();
await client.setEngineeringExecutionBackend({ backend: "local-static" });
await client.startEngineeringExecution();
```

The local fallback accepts only a safety-approved static site. It serves the artifact on loopback and checks delivery and health. It does not run generated package scripts on the host.

## Shape

`EngineeringExecutionState` owns both the run state and the backend selection. Its `generation` fences leases, so a worker cannot continue after a stop. A lease copies the selected backend. The orchestrator chooses an executor from that lease instead of from a process-wide default.

The public interface has one backend mutation and the existing start and stop mutations. The store rejects a backend change while execution is running. This keeps a task on one executor and makes the stop, select, start order explicit.

The API parses the backend request and enforces the administrator role. The worker receives a typed backend value in its internal lease. Executor selection stays inside the orchestrator.

## Synthesis decision

I used the existing tenant execution gate as the base. The arena review preferred it because it matches the current TypeScript store, routes, dashboard contracts, and generation fence. I kept the review's cancellation rule: stopping an active CodeBuild task calls `StopBuild` during the next permit check.

I rejected a global `SISYPHUS_EXECUTION_MODE` switch because it cannot support different tenant selections or carry a selection safely into a queued task. I also rejected arbitrary local command execution because a generated project would then run outside the AWS sandbox.

## Tradeoffs accepted

- The local fallback supports static sites only. This keeps generated commands out of the host process.
- A CodeBuild selection requires the orchestrator's AWS configuration. If it is missing, the task records a clear blocked result and does not fall back silently.
- The in-memory control state resets to stopped after the API restarts. This prototype remains fail-closed.

## Verification

The store tests cover selection while stopped, rejection while running, lease propagation, and generation fencing. The configuration tests cover local-only and AWS-enabled workers. The dashboard build confirms that the administrator can select the backend before starting execution.
