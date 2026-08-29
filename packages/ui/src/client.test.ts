import { describe, expect, it, vi } from "vitest";
import { createDemoSnapshot, createRestoredAuditEvent } from "./demo-data.js";
import { createSessionDataClient } from "./session-client.js";

describe("same-origin session data client", () => {
  it("uses cookies and CSRF without adding a bearer header", async () => {
    const snapshot = createDemoSnapshot();
    const skill = snapshot.skills.find(
      (candidate) => candidate.skillVersionId === "skill-refactor@1.9.2",
    );
    if (skill === undefined) throw new Error("Missing demo skill.");
    const restoredSkill: typeof skill = { ...skill, disposition: "probation" };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(
        Response.json({
          skill: restoredSkill,
          auditEvent: createRestoredAuditEvent({
            skillName: skill.name,
            runtime: skill.runtime,
            reason: "Verified by the session client regression test.",
          }),
        }),
      );
    const client = createSessionDataClient({
      csrfToken: "a".repeat(64),
      fetcher,
    });

    await client.getDashboard({ runtime: "codex" });
    await client.restoreSkill(skill.skillVersionId, {
      reason: "Verified by the session client regression test.",
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/dashboard?runtime=codex",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    const dashboardHeaders = fetcher.mock.calls[0]?.[1]?.headers;
    expect(dashboardHeaders).not.toHaveProperty("Authorization");
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/skills/skill-refactor%401.9.2/restore",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-Sisyphus-CSRF": "a".repeat(64) }),
      }),
    );
  });
});
