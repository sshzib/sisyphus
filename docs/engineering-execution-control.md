# Engineering execution control

The engineering workforce is stopped by default. A tenant administrator must start it before the orchestrator can lease work. Stopping it prevents new leases, invalidates every current lease, and marks affected operations blocked. The running worker checks its lease before paid model work and before starting or polling a sandbox build. A rejected check stops an active CodeBuild build on its next bounded poll.

This control is tenant-scoped and uses a monotonically increasing generation number as a fence. A worker may continue only when its lease ID and generation still match a running control state. A stop changes the generation before affected work is released, so a stale worker cannot resume after a later start.

The dashboard exposes the state to all workspace members, but only tenant administrators can start or stop execution. Stopping a build requests cancellation; work already accepted by an external provider cannot be retroactively recalled. The interface reports this as a stop request rather than claiming instant termination.

Before starting execution, an administrator can choose **AWS sandbox** or **Local static fallback**. The selection is part of the tenant execution state and travels with each new lease. The AWS option submits work to the configured CodeBuild project. The local fallback serves and checks only safety-approved static sites on loopback. It never runs generated commands or package scripts on the host. Stop execution before changing the selection.

The initial implementation is intentionally process-local because engineering tasks are already held in the in-memory task store. It fails closed after an API restart. Before running more than one API instance or requiring restart durability, move the execution state, task lease, and generation fence into one transactional database record.

## Design decision

Three implementation shapes were compared: a tenant execution gate with a generation fence, a standalone controller service, and an executor-only switch. The tenant gate was selected because it protects the existing lease boundary before model and sandbox spending while keeping the UI, API, and worker on one authoritative state path. The controller-service option informed the bounded cancellation and post-registration checks; the executor-only option was rejected because it still permits model spend and stale orchestration work.
