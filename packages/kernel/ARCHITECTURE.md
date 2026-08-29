# Kernel design

## Problem

The kernel must make one durable decision for each normalized runtime event. A stop decision can also consume a retry and change one skill version's standing. Those effects must agree even when a hook is replayed or two attempts finish close together.

## Usage

```ts
const kernel = createInMemoryKernel({
  deterministicEvaluators: [testEvaluator],
  judge,
});

const decision = await kernel.supervise(observation, constraint);
```

Callers parse vendor data into `HookObservation` before this call. They do not coordinate evaluation, retry, or quarantine steps themselves.

## Shape

`SupervisionKernel.supervise` is the deep interface. Evaluation happens outside the short storage transaction. The transaction rechecks the event ID, reads the current retry and skill state, reduces the assessment to a decision, and records every state change together. The in-memory store implements that transaction port for tests and the local worker.

The domain package owns normalized records and Zod parsers. The adapter kit owns vendor-boundary contracts and conformance checks. Neither the domain nor kernel imports vendor types.

## Synthesis decision

Two shapes were compared. The chosen design uses one transactional reducer. The alternative split retry and skill standing into separate repositories, which made the caller coordinate two writes and exposed partial-failure handling. Keeping the transaction callback synchronous also prevents a slow judge call from holding the state lock.

## Tradeoffs accepted

- The transaction port is aimed at a single local worker in exchange for a small, atomic interface.
- Evaluation may run twice under a truly concurrent replay, but only one result can commit. Stored counters and sanctions remain idempotent.
- Runtime adapters must normalize evidence before supervision in exchange for keeping vendor payloads out of persisted domain records.

## Alternatives considered

Separate work-item and skill-standing aggregates lost because a terminal attempt changes both and requires a coordinator. An event log with projections lost for v1 because callers would need projection freshness rules merely to return a hook decision.

## Open questions and risks

- A future multi-process worker will need a database implementation whose transaction provides the same synchronous read-and-write semantics.

## Next implementation step

Implement a SQLite transaction adapter against the `SupervisionStore` contract when the local worker adds durable storage.
