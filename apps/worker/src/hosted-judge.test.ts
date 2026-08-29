import { once } from "node:events";
import { createServer } from "node:http";

import { RootStopObservationSchema, parseEvaluationConstraint } from "@sisyphus/domain";
import { afterEach, describe, expect, it } from "vitest";

import { HostedJudge } from "./hosted-judge.js";

const input = {
  observation: RootStopObservationSchema.parse({
    kind: "root-stop",
    eventId: "event-1",
    workItemId: "work-1",
    runId: "run-1",
    occurredAt: "2026-08-29T10:00:00.000Z",
    adapterVersion: "adapter-1",
    capabilities: {
      runtime: "codex",
      runtimeVersion: "0.1.0",
      promptInterception: { kind: "supported" },
      skillSelectionControl: { kind: "supported" },
      rootStopContinuation: { kind: "supported" },
      subagentStopContinuation: { kind: "supported" },
      toolPrevention: { kind: "supported" },
      toolObservation: { kind: "supported" },
      stableTokenUsage: { kind: "unsupported", reason: "not reported" },
      localEvidenceAccess: { kind: "supported" },
    },
    identity: { sessionId: "session-1", agent: { kind: "root", agentId: "agent-1" } },
    output: "OPENAI_API_KEY=sk-proj-1234567890abcdefghijkl bad answer",
    attribution: { kind: "none" },
    tokenUsage: { kind: "unavailable" },
  }),
  constraint: parseEvaluationConstraint({
    policyId: "policy-1",
    policyVersionId: "policy-version-1",
    requiredCapabilities: [],
    skillCandidates: [],
    toolPolicy: { kind: "allow" },
  }),
};

describe("HostedJudge", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (server) => {
        server.close();
        await once(server, "close");
      }),
    );
  });

  it("uploads only redacted evidence and validates the judge result", async () => {
    let received = "";
    const server = createServer(async (request, response) => {
      for await (const chunk of request) received += chunk.toString();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          kind: "fail",
          score: 0.2,
          findings: [
            {
              criterion: "correctness",
              message: "The answer is wrong.",
              correction: "Correct the answer.",
              evidence: ["bad answer"],
            },
          ],
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");
    const judge = new HostedJudge({
      endpoint: `http://127.0.0.1:${address.port}`,
      deviceToken: "device-token",
      timeoutMilliseconds: 2_000,
    });

    const result = await judge.evaluate(input);

    expect(result).toMatchObject({ kind: "fail", score: 0.2 });
    expect(received).not.toContain("sk-proj-1234567890abcdefghijkl");
    expect(received).toContain("[redacted]");
  });
});
