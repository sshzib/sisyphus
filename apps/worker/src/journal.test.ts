import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ActivationLeaseAuthority } from "./activation-lease.js";
import { LocalJournal } from "./journal.js";

const firstEnvelopeDigest = "a".repeat(64);
const evidence = { handle: "evidence-handle-1", digest: "b".repeat(64) };

function decisionRecord(eventId: string, decision: unknown) {
  return {
    eventId,
    decision,
    envelopeDigest: firstEnvelopeDigest,
    receivedAt: "2026-08-29T10:00:00.000Z",
    evidence,
    cloudEvent: { kind: "evaluation-recorded", tenantId: "tenant-1" },
  };
}

describe("LocalJournal", () => {
  it("commits one decision and outbox record for a replayed event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });

    const first = journal.recordDecision(
      decisionRecord("event-1", { kind: "allow-stop" }),
    );
    const replay = journal.recordDecision(
      decisionRecord("event-1", {
        kind: "retry",
        feedback: "should not replace the first decision",
      }),
    );

    expect(replay).toEqual(first);
    expect(journal.pendingOutbox()).toHaveLength(1);
    journal.close();
  });

  it("acknowledges outbox records idempotently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    const recorded = journal.recordDecision(
      decisionRecord("event-2", { kind: "allow-tool" }),
    );

    journal.acknowledge(recorded.outboxId);
    journal.acknowledge(recorded.outboxId);

    expect(journal.pendingOutbox()).toEqual([]);
    journal.close();
  });

  it("returns a persisted decision before a replay reaches the kernel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const path = join(directory, "worker.db");
    const firstProcess = new LocalJournal({ path });
    const recorded = firstProcess.recordDecision(
      decisionRecord("event-replayed-after-restart", {
        kind: "retry",
        retryOrdinal: 1,
      }),
    );
    firstProcess.close();

    const restartedProcess = new LocalJournal({ path });

    expect(restartedProcess.decisionFor("event-replayed-after-restart")).toEqual(recorded);
    expect(restartedProcess.decisionFor("event-not-seen")).toBeUndefined();
    restartedProcess.close();
  });

  it("rejects an event-id replay whose full envelope digest changed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    journal.recordDecision(decisionRecord("event-collision", { kind: "allow" }));

    expect(() =>
      journal.recordDecision({
        ...decisionRecord("event-collision", { kind: "allow" }),
        envelopeDigest: "c".repeat(64),
      }),
    ).toThrow("different envelope");
    journal.close();
  });

  it("keeps the first worker receipt time for an idempotent event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });

    const first = journal.recordEventReceipt({
      eventId: "event-receipt",
      envelopeDigest: firstEnvelopeDigest,
      receivedAt: "2026-08-29T10:00:00.000Z",
    });
    const replay = journal.recordEventReceipt({
      eventId: "event-receipt",
      envelopeDigest: firstEnvelopeDigest,
      receivedAt: "2026-08-29T10:01:00.000Z",
    });

    expect(replay).toEqual(first);
    expect(replay.receivedAt).toBe("2026-08-29T10:00:00.000Z");
    journal.close();
  });

  it("indexes encrypted evidence by event without putting its handle in the outbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    journal.recordDecision(decisionRecord("event-with-evidence", { kind: "allow" }));

    expect(journal.evidenceFor("event-with-evidence")).toEqual(evidence);
    expect(JSON.stringify(journal.pendingOutbox())).not.toContain(evidence.handle);
    journal.close();
  });

  it("persists a decision-issued lease and consumes it exactly once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    const authority = new ActivationLeaseAuthority({ key: new Uint8Array(32).fill(7) });
    const issued = authority.issue({
      promptEventId: "prompt-event-1",
      runId: "run-1",
      workItemId: "work-1",
      skillVersionId: "skill-version-1",
      issuedAt: "2026-08-29T10:00:00.000Z",
      expiresAt: "2026-08-29T10:05:00.000Z",
    });
    const recorded = journal.recordDecision({
      ...decisionRecord("prompt-event-1", { kind: "prompt-decision" }),
      activationLease: issued.record,
    });

    expect(recorded.activationLease).toEqual(issued.record);
    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: authority.digest(issued.lease.activationLeaseId),
        skillVersionId: "skill-version-1",
        consumedAt: "2026-08-29T10:01:00.000Z",
      }),
    ).toMatchObject({ runId: "run-1", workItemId: "work-1" });
    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: authority.digest(issued.lease.activationLeaseId),
        skillVersionId: "skill-version-1",
        consumedAt: "2026-08-29T10:01:01.000Z",
      }),
    ).toBeUndefined();
    expect(journal.activationFor({ runId: "run-1", workItemId: "work-1" })).toMatchObject({
      skillVersionId: "skill-version-1",
      consumedAt: "2026-08-29T10:01:00.000Z",
    });
    journal.close();
  });

  it("does not consume a forged, mismatched, or expired lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    const authority = new ActivationLeaseAuthority({ key: new Uint8Array(32).fill(8) });
    const issued = authority.issue({
      promptEventId: "prompt-event-2",
      runId: "run-2",
      workItemId: "work-2",
      skillVersionId: "skill-version-2",
      issuedAt: "2026-08-29T10:00:00.000Z",
      expiresAt: "2026-08-29T10:05:00.000Z",
    });
    journal.recordDecision({
      ...decisionRecord("prompt-event-2", { kind: "prompt-decision" }),
      activationLease: issued.record,
    });

    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: authority.digest("forged-lease"),
        skillVersionId: "skill-version-2",
        consumedAt: "2026-08-29T10:01:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: authority.digest(issued.lease.activationLeaseId),
        skillVersionId: "different-skill-version",
        consumedAt: "2026-08-29T10:01:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: authority.digest(issued.lease.activationLeaseId),
        skillVersionId: "skill-version-2",
        consumedAt: "2026-08-29T10:05:00.000Z",
      }),
    ).toBeUndefined();
    journal.close();
  });

  it("persists idempotent attempts and monotonic policy bundle state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-journal-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });

    expect(
      journal.recordCompletionAttempt({
        eventId: "attempt-1",
        runId: "run-1",
        workItemId: "work-1",
      }),
    ).toBe(1);
    expect(
      journal.recordCompletionAttempt({
        eventId: "attempt-2",
        runId: "run-1",
        workItemId: "work-1",
      }),
    ).toBe(2);
    expect(
      journal.recordCompletionAttempt({
        eventId: "attempt-1",
        runId: "run-1",
        workItemId: "work-1",
      }),
    ).toBe(1);

    const state = {
      revision: 2,
      payloadDigest: "f".repeat(64),
      dispositionRevision: 1,
    };
    journal.recordPolicyBundleState(state);
    expect(journal.policyBundleState()).toEqual(state);
    expect(() =>
      journal.recordPolicyBundleState({
        revision: 1,
        payloadDigest: "e".repeat(64),
        dispositionRevision: 1,
      }),
    ).toThrow("roll back");
    journal.close();
  });
});
