# Local workforce execution design

## Problem

The local demo starts the API and OpenRouter workforce worker without AWS configuration. The worker correctly completes planning, isolated branch work, integration, review, and safety scanning, then marks the task blocked because CodeBuild is unavailable. The Overview also reads legacy runtime operations in its observed-operations panel, while the actual engineering workforce lives in a separate engineering projection.

## Usage

```ts
await new WorkforceExecution({
  controlPlane,
  workspaces,
  openRouter,
  executor,
  publish,
  recordSkillOutcome,
}).run(task);
```

The executor receives an already integrated workspace and its completed safety report. In local mode it accepts only a dependency-free static site. It starts a trusted loopback static server, verifies the served entry point over HTTP, records structured evidence, then closes the server. It never executes generated commands, package scripts, Node programs, or dependency installers on the host.

## Shape

`ProjectExecutor` owns a single execution decision. It exposes an execution identifier, detected local port, structured checks, and a pass or fail result. `CodeBuildSandbox` remains the cloud implementation. `LocalStaticExecutor` is the local implementation.

`WorkforceExecution` keeps planning, branches, integration, targeted retry, and scoring. It chooses the executor after the existing safety scan. A local static run progresses to approval without AWS. A package project remains blocked by local policy because it needs an isolated package runner, not because AWS is absent.

The existing flat plan remains for this increment. Roles remain dynamic. One implementation owner receives each non-overlapping domain. Assurance roles run concurrently after integration and write evidence reports only. This gives a simple page a small real workforce, and allows a larger request to hire up to twelve relevant roles without sending all available skills to every model.

The Overview stores an agent selection as `{ taskId, agentId }`. It derives active engineering agents from the existing engineering projection rather than copying them into the legacy runtime feed. A selected agent shows the existing typed task, requirement, model, selected skills, activity, score, branch, files, commit, and evidence. Task events stay task-level until the event schema has explicit agent subjects.

## Synthesis decision

The local executor interface is the base design. It hides the difference between a local static verification run and CodeBuild behind one result contract. The existing `sandbox` summary field stays temporarily so the API and UI do not need a breaking migration. Its label in the UI says `Local execution` whenever the run identifier is local.

The wave-graph proposal was not added in this increment. It is the right next step once advisory agents must feed plans into builders. The current flat plan already has isolated branches, one ownership check per implementation domain, concurrent build work, concurrent post-integration reviews, targeted retries, and selected skill injection. Adding a second planning system now would duplicate those mechanisms.

## Tradeoffs accepted

- Local verification proves that a static artifact can be safely served and health-checked. It does not execute generated browser JavaScript or package scripts.
- Review agents wait for integrated source. Showing them as working before source exists would be misleading.
- The skill registry continues to load only the selected `SKILL.md` files. It does not concatenate the library into every prompt.
- The current event journal records safe task events. Per-agent event filtering will become precise when events add an explicit subject field.

## Next implementation step

Add the executor contract and local static executor, then use the existing worker flow to project its real result.
