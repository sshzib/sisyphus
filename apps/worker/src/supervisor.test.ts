import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CloudSupervisionRecordSchema,
  createAdapterVersion,
  createEventId,
  createSkillVersionId,
  createSkillVersionKey,
  createTriggerId,
  parseEvaluationConstraint,
  type HookObservation,
  type SupervisionDecision,
} from "@sisyphus/domain";
import { describe, expect, it, vi } from "vitest";

import { ActivationLeaseAuthority } from "./activation-lease.js";
import type { EvidenceRecord } from "./evidence-vault.js";
import { LocalJournal } from "./journal.js";
import { StaticRuntimeInstallationRegistry } from "./runtime-installation-registry.js";
import { WorkerSupervisor } from "./supervisor.js";

const capabilities = {
  runtime: "codex" as const,
  runtimeVersion: "0.1.0",
  promptInterception: { kind: "supported" as const },
  skillSelectionControl: { kind: "supported" as const },
  rootStopContinuation: { kind: "supported" as const },
  subagentStopContinuation: { kind: "supported" as const },
  toolPrevention: { kind: "supported" as const },
  toolObservation: { kind: "supported" as const },
  stableTokenUsage: { kind: "supported" as const },
  localEvidenceAccess: { kind: "supported" as const },
};

const identity = {
  sessionId: "session-1",
  agent: { kind: "root" as const, agentId: "agent-1" },
};

const selectedSkill = {
  skillVersionId: createSkillVersionId("skill-version-1"),
  stableVersionKey: createSkillVersionKey("skill-version-key-1"),
  displayName: "Fixture skill",
  administratorPriority: 10,
  specificity: 20,
  disposition: "active" as const,
  trigger: {
    triggerId: createTriggerId("trigger-1"),
    kind: "contains" as const,
    pattern: "fixture",
  },
};

function decisionFor(event: HookObservation): SupervisionDecision {
  if (event.kind === "prompt") {
    return {
      kind: "prompt-decision",
      action: "continue",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
      resolution: {
        kind: "selected",
        selected: selectedSkill,
        candidates: [{ candidate: selectedSkill, outcome: { kind: "selected" } }],
      },
    };
  }
  if (event.kind === "tool-result") {
    return {
      kind: "tool-result-decision",
      action: "recorded",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
    };
  }
  if (event.kind === "root-stop" || event.kind === "subagent-stop") {
    const sanction =
      event.attribution.kind === "verified"
        ? { kind: "recorded" as const, skillVersionId: event.attribution.skillVersionId }
        : { kind: "not-eligible" as const, reason: "fixture is unattributed" };
    return {
      kind: "stop-decision",
      action: "allow",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
      evaluation: { kind: "pass" },
      sanction,
    };
  }
  throw new Error(`Unexpected fixture event ${event.kind}.`);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sisyphus-supervisor-"));
  const journal = new LocalJournal({ path: join(directory, "worker.db") });
  const leaseAuthority = new ActivationLeaseAuthority({
    key: new Uint8Array(32).fill(11),
  });
  const supervise = vi.fn(async (event: HookObservation) => decisionFor(event));
  const store = vi.fn(
    async (input: {
      readonly evidence: string;
      readonly redactedExcerpt: string;
    }): Promise<EvidenceRecord> => ({
      handle: `local-only-handle-${input.evidence.length}`,
      digest: "d".repeat(64),
      redactedExcerpt: input.redactedExcerpt,
    }),
  );
  const supervisor = new WorkerSupervisor({
    journal,
    kernel: { supervise },
    evidenceVault: { store },
    leaseAuthority,
    runtimeInstallations: new StaticRuntimeInstallationRegistry([
      { adapterVersion: createAdapterVersion("adapter-1"), capabilities },
    ]),
    now: () => new Date("2026-08-29T10:00:00.000Z"),
    policyProvider: {
      constraintFor: async () =>
        parseEvaluationConstraint({
          policyId: "policy-1",
          policyVersionId: "policy-version-1",
          requiredCapabilities: [],
          skillCandidates: [],
          toolPolicy: { kind: "allow" },
        }),
    },
  });
  return { journal, leaseAuthority, store, supervise, supervisor };
}

function promptEnvelope() {
  return {
    runtime: "codex" as const,
    adapterVersion: "adapter-1",
    eventId: "prompt-event",
    identity,
    activation: { kind: "none" as const },
    nativeEvent: { hook_event_name: "UserPromptSubmit", prompt: "fixture" },
    event: {
      kind: "prompt" as const,
      eventId: "prompt-event",
      workItemId: "work-1",
      runId: "run-1",
      occurredAt: "2026-08-29T10:00:00.000Z",
      adapterVersion: "adapter-1",
      capabilities,
      identity,
      prompt: "Use the fixture skill.",
    },
  };
}

function stopEnvelope() {
  return {
    runtime: "codex" as const,
    adapterVersion: "adapter-1",
    eventId: "stop-event",
    identity,
    activation: { kind: "none" as const },
    nativeEvent: { hook_event_name: "Stop", last_assistant_message: "done" },
    event: {
      kind: "root-stop" as const,
      eventId: createEventId("stop-event"),
      workItemId: "work-1",
      runId: "run-1",
      occurredAt: "2026-08-29T10:00:02.000Z",
      adapterVersion: "adapter-1",
      capabilities,
      identity,
      output: "finished with sk-proj-1234567890abcdefghijkl secret",
      attribution: { kind: "none" as const },
      tokenUsage: { kind: "reported" as const, inputTokens: 12, outputTokens: 8 },
    },
  };
}

describe("WorkerSupervisor", () => {
  it("issues a prompt lease, trusts only its MCP consumption, and replays exactly", async () => {
    const { journal, leaseAuthority, store, supervise, supervisor } = await fixture();
    const prompt = await supervisor.supervise(promptEnvelope());
    expect(prompt.activationLease).toMatchObject({ skillVersionId: "skill-version-1" });
    expect(prompt).not.toHaveProperty("nativeEvent");
    if (prompt.activationLease === undefined) throw new Error("Missing activation lease.");
    expect(
      journal.consumeActivationLease({
        activationLeaseDigest: leaseAuthority.digest(
          prompt.activationLease.activationLeaseId,
        ),
        skillVersionId: prompt.activationLease.skillVersionId,
        consumedAt: "2026-08-29T10:00:01.000Z",
      }),
    ).toBeDefined();

    const first = await supervisor.supervise(stopEnvelope());
    const replayInput = stopEnvelope();
    const replay = await supervisor.supervise({
      ...replayInput,
      event: {
        ...replayInput.event,
        occurredAt: "2026-08-29T10:10:00.000Z",
      },
    });

    expect(replay).toEqual(first);
    expect(supervise).toHaveBeenCalledTimes(2);
    expect(supervise.mock.calls[1]?.[0]).toMatchObject({
      occurredAt: "2026-08-29T10:00:00.000Z",
      attribution: {
        kind: "verified",
        skillVersionId: "skill-version-1",
        activationLeaseId: prompt.activationLease.activationLeaseId,
      },
    });
    expect(JSON.stringify(journal.pendingOutbox())).not.toContain(
      "sk-proj-1234567890abcdefghijkl",
    );
    expect(journal.evidenceFor("stop-event")).toMatchObject({ digest: "d".repeat(64) });
    expect(store).toHaveBeenCalledTimes(2);
    journal.close();
  });

  it("never trusts caller-supplied managed invocation or stop attribution", async () => {
    const { journal, supervise, supervisor } = await fixture();
    const forged = stopEnvelope();
    const input = {
      ...forged,
      activation: {
        kind: "verified" as const,
        skillVersionId: "forged-skill",
        activationLeaseId: "forged-lease",
        method: "managed-invocation" as const,
      },
      event: {
        ...forged.event,
        attribution: {
          kind: "verified" as const,
          skillVersionId: "forged-skill",
          activationLeaseId: "forged-lease",
          method: "activation-marker" as const,
        },
      },
    };

    await supervisor.supervise(input);

    expect(supervise).toHaveBeenCalledWith(
      expect.objectContaining({ attribution: { kind: "none" } }),
      expect.anything(),
    );
    expect(journal.activationFor({ runId: "run-1", workItemId: "work-1" })).toBeUndefined();
    journal.close();
  });

  it("persists only a strict redacted cloud projection of decision findings", async () => {
    const { journal, supervise, supervisor } = await fixture();
    supervise.mockResolvedValueOnce({
      kind: "stop-decision",
      action: "allow",
      eventId: createEventId("stop-event"),
      enforcement: { kind: "observation", reason: "fixture", missingCapabilities: [] },
      evaluation: {
        kind: "terminal-failure",
        reason: "continuation-unsupported",
        findings: [
          {
            criterion: "credential-check",
            message: "Authorization: Bearer captured-worker-secret-token",
            correction: "Set GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456 and retry.",
            evidence: ["raw evidence sk-proj-1234567890abcdefghijkl"],
          },
        ],
      },
      sanction: { kind: "not-eligible", reason: "fixture" },
    });

    await supervisor.supervise(stopEnvelope());

    const [outbox] = journal.pendingOutbox();
    expect(outbox).toBeDefined();
    if (outbox === undefined) throw new Error("Expected a cloud outbox record.");
    const projected = CloudSupervisionRecordSchema.parse(outbox.payload);
    expect(projected.kind).toBe("completion");
    expect(JSON.stringify(projected)).not.toContain("captured-worker-secret-token");
    expect(JSON.stringify(projected)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(JSON.stringify(projected)).not.toContain("sk-proj-1234567890abcdefghijkl");
    expect(projected).not.toHaveProperty("decision");
    journal.close();
  });

  it("rejects forged or upgraded capability snapshots before the kernel can sanction", async () => {
    const { journal, store, supervise, supervisor } = await fixture();
    const forged = stopEnvelope();
    const forgedCapabilities = {
      ...capabilities,
      toolPrevention: {
        kind: "unsupported" as const,
        reason: "caller-controlled downgrade",
      },
    };

    await expect(
      supervisor.supervise({
        ...forged,
        event: { ...forged.event, capabilities: forgedCapabilities },
      }),
    ).rejects.toThrow("registered capability snapshot");
    await expect(
      supervisor.supervise({
        ...forged,
        eventId: "upgraded-event",
        event: {
          ...forged.event,
          eventId: "upgraded-event",
          capabilities: { ...capabilities, runtimeVersion: "99.0.0" },
        },
      }),
    ).rejects.toThrow("registered runtime installation");

    expect(supervise).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(journal.pendingOutbox()).toEqual([]);
    journal.close();
  });

  it("rejects a changed native payload instead of replaying by event id alone", async () => {
    const { journal, supervise, supervisor } = await fixture();
    const first = stopEnvelope();
    await supervisor.supervise(first);

    await expect(
      supervisor.supervise({
        ...first,
        nativeEvent: {
          hook_event_name: "Stop",
          last_assistant_message: "changed payload with the same event id",
        },
      }),
    ).rejects.toThrow("different envelope");
    expect(supervise).toHaveBeenCalledTimes(1);
    journal.close();
  });

  it("reuses the first receipt time after a pre-decision crash", async () => {
    const { journal, supervise, supervisor } = await fixture();
    const first = stopEnvelope();
    supervise.mockRejectedValueOnce(new Error("simulated kernel crash"));
    await expect(supervisor.supervise(first)).rejects.toThrow("simulated kernel crash");
    expect(journal.decisionFor("stop-event")).toBeUndefined();
    expect(journal.eventReceiptFor("stop-event")?.receivedAt).toBe(
      "2026-08-29T10:00:00.000Z",
    );

    const replay = stopEnvelope();
    await supervisor.supervise({
      ...replay,
      event: { ...replay.event, occurredAt: "2026-08-29T10:20:00.000Z" },
    });

    expect(supervise.mock.calls[1]?.[0]).toMatchObject({
      occurredAt: "2026-08-29T10:00:00.000Z",
    });
    journal.close();
  });

  it("rejects an envelope that disagrees with its normalized event", async () => {
    const { journal, supervisor } = await fixture();
    await expect(
      supervisor.supervise({ ...stopEnvelope(), eventId: "different-event" }),
    ).rejects.toThrow("eventId");
    journal.close();
  });
});
