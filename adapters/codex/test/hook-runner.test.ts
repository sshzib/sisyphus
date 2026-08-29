import { describe, expect, it, vi } from "vitest";
import {
  LocalChallengeNonceSchema,
  signLocalChallenge,
} from "@sisyphus/local-protocol";

import { CodexSupervisionEnvelopeSchema, createCodexAdapter, runCodexHook } from "../src/index.js";
import { loadFixture } from "./fixture.js";

const adapter = createCodexAdapter({
  runtimeVersion: "0.99.0",
  adapterVersion: "0.1.0",
  now: () => new Date("2026-08-29T10:00:00.000Z"),
});
const hookToken = "hook_token_0123456789abcdefghijklmnopqrstuvwxyz";

function parseRequestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  const parsed: unknown = JSON.parse(body);
  return CodexSupervisionEnvelopeSchema.parse(parsed);
}

function authenticatedRequest(supervisionRequest: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== "/v1/challenge") {
      return supervisionRequest(input, init);
    }
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.body).toBeUndefined();
    const nonce = LocalChallengeNonceSchema.parse(url.searchParams.get("nonce"));
    return Response.json({
      channel: "hook",
      nonce,
      proof: signLocalChallenge({ channel: "hook", nonce, token: hookToken }),
    });
  };
}

describe("Codex hook worker bridge", () => {
  it("posts a normalized strict envelope and renders the returned decision", async () => {
    const request = authenticatedRequest(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:7331/v1/supervise");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${hookToken}`,
      );
      const envelope = parseRequestBody(init?.body);
      expect(envelope.runtime).toBe("codex");
      expect(envelope.event.kind).toBe("prompt");
      expect(envelope.eventId).toBe(envelope.event.eventId);
      expect(envelope.identity).toEqual(envelope.event.identity);
      expect("hook_event_name" in envelope.event).toBe(false);
      expect(envelope.nativeEvent).toMatchObject({
        hook_event_name: "UserPromptSubmit",
        prompt: "Fix the failing parser test and verify the result.",
      });
      return Response.json({
        decision: {
          kind: "prompt-decision",
          eventId: envelope.eventId,
          enforcement: { kind: "enforced" },
          action: "continue",
          resolution: { kind: "none", candidates: [] },
        },
      });
    });

    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        request,
      }),
    ).resolves.toEqual({ continue: true });
  });

  it("sends worker-confirmed activation evidence without tool payload logs", async () => {
    const request = authenticatedRequest(async (_url, init) => {
      const envelope = parseRequestBody(init?.body);
      expect(envelope.activation).toEqual({
        kind: "verified",
        skillVersionId: "skill-parser-v3",
        activationLeaseId: "lease-001",
        method: "activation-marker",
      });
      expect(envelope.nativeEvent).toMatchObject({
        hook_event_name: "PostToolUse",
        tool_name: "mcp__sisyphus__activate_skill",
      });
      return Response.json({
        decision: {
          kind: "tool-result-decision",
          eventId: envelope.eventId,
          enforcement: { kind: "enforced" },
          action: "recorded",
        },
      });
    });

    await expect(
      runCodexHook({
        rawEvent: loadFixture("post-tool-use-activation.json"),
        adapter,
        workerToken: hookToken,
        request,
      }),
    ).resolves.toEqual({});
  });

  it("rejects a response for another event", async () => {
    const request = authenticatedRequest(async () =>
      Response.json({
        decision: {
          kind: "prompt-decision",
          eventId: "codex:wrong-event",
          enforcement: { kind: "enforced" },
          action: "continue",
          resolution: { kind: "none", candidates: [] },
        },
      }),
    );

    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        request,
      }),
    ).rejects.toThrow("worker decision event id does not match");
  });

  it("refuses to send local evidence to a non-loopback endpoint", async () => {
    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        workerEndpoint: "https://example.com",
      }),
    ).rejects.toThrow("loopback host");
  });

  it.each([
    "http://user:password@127.0.0.1:7331",
    "http://127.0.0.1:7331/base",
    "http://127.0.0.1:7331?forward=elsewhere",
  ])("rejects a non-origin worker URL before making a request: %s", async (workerEndpoint) => {
    const request = vi.fn<typeof fetch>();
    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        workerEndpoint,
        request,
      }),
    ).rejects.toThrow("origin");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends no token or event body to a loopback port squatter", async () => {
    const requests: { readonly authorization: string | null; readonly body: BodyInit | null | undefined }[] = [];
    const request: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const nonce = LocalChallengeNonceSchema.parse(url.searchParams.get("nonce"));
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body,
      });
      return Response.json({ channel: "hook", nonce, proof: "A".repeat(43) });
    };

    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        request,
      }),
    ).rejects.toThrow("authentication failed");
    expect(requests).toEqual([{ authorization: null, body: undefined }]);
  });

  it("does not probe the runtime when worker authentication fails", async () => {
    const runtimeVersionProbe = vi.fn(async () => "0.99.0");
    const request: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const nonce = LocalChallengeNonceSchema.parse(url.searchParams.get("nonce"));
      return Response.json({ channel: "hook", nonce, proof: "A".repeat(43) });
    };

    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        workerToken: hookToken,
        runtimeVersionProbe,
        request,
      }),
    ).rejects.toThrow("authentication failed");
    expect(runtimeVersionProbe).not.toHaveBeenCalled();
  });

  it("injects only a lease issued in the worker response", async () => {
    const request = authenticatedRequest(async (_url, init) => {
      const envelope = parseRequestBody(init?.body);
      return Response.json({
        decision: {
          kind: "prompt-decision",
          eventId: envelope.eventId,
          enforcement: { kind: "enforced" },
          action: "continue",
          resolution: {
            kind: "selected",
            selected: {
              skillVersionId: "skill-parser-v3",
              stableVersionKey: "parser-v3",
              displayName: "Parser repair",
              administratorPriority: 10,
              specificity: 20,
              disposition: "active",
              trigger: {
                triggerId: "parser-trigger",
                kind: "contains",
                pattern: "parser",
              },
            },
            candidates: [
              {
                candidate: {
                  skillVersionId: "skill-unavailable-v1",
                  stableVersionKey: "unavailable-v1",
                  displayName: "Unavailable wrapper",
                  administratorPriority: 9,
                  specificity: 19,
                  disposition: "active",
                  activationAvailability: {
                    kind: "unavailable",
                    reason: "No Codex wrapper is installed for this version.",
                  },
                  trigger: {
                    triggerId: "unavailable-trigger",
                    kind: "contains",
                    pattern: "parser",
                  },
                },
                outcome: {
                  kind: "rejected",
                  reason: "wrapper-unavailable",
                },
              },
            ],
          },
        },
        activationLease: {
          activationLeaseId: "worker-issued-lease",
          skillVersionId: "skill-parser-v3",
          expiresAt: "2026-08-29T10:05:00.000Z",
        },
      });
    });

    const response = await runCodexHook({
      rawEvent: loadFixture("user-prompt-submit.json"),
      adapter,
      workerToken: hookToken,
      request,
    });

    expect(JSON.stringify(response)).toContain("worker-issued-lease");
    expect(JSON.stringify(response)).toContain("skill-parser-v3");
  });

  it("rejects a selected skill response without a worker-issued lease", async () => {
    const request = authenticatedRequest(async (_url, init) => {
      const envelope = parseRequestBody(init?.body);
      return Response.json({
        decision: {
          kind: "prompt-decision",
          eventId: envelope.eventId,
          enforcement: { kind: "enforced" },
          action: "continue",
          resolution: {
            kind: "selected",
            selected: {
              skillVersionId: "skill-parser-v3",
              stableVersionKey: "parser-v3",
              displayName: "Parser repair",
              administratorPriority: 10,
              specificity: 20,
              disposition: "active",
              trigger: {
                triggerId: "parser-trigger",
                kind: "contains",
                pattern: "parser",
              },
            },
            candidates: [],
          },
        },
      });
    });

    await expect(
      runCodexHook({
        rawEvent: loadFixture("user-prompt-submit.json"),
        adapter,
        workerToken: hookToken,
        request,
      }),
    ).rejects.toThrow("worker-issued activation lease");
  });
});
