import {
  RestoreSkillResponseSchema,
  type DashboardSnapshot,
} from "./contracts.js";
import {
  createDemoSnapshot,
  createRestoredAuditEvent,
  filterDashboardSnapshot,
} from "./demo-data.js";
import {
  SisyphusApiError,
  type SisyphusDataClient,
} from "./data-client.js";

export function createDemoDataClient(): SisyphusDataClient {
  let snapshot = createDemoSnapshot();

  return {
    dataSource: { kind: "demo" },
    async getDashboard(query) {
      return filterDashboardSnapshot(snapshot, query);
    },
    async restoreSkill(skillVersionId, input) {
      const skill = snapshot.skills.find(
        (candidate) => candidate.skillVersionId === skillVersionId,
      );
      if (skill === undefined) {
        throw new SisyphusApiError("Skill version not found", 404, undefined);
      }

      const restoredSkill: DashboardSnapshot["skills"][number] = {
        ...skill,
        disposition: "probation",
        lastChangedAt: "2026-08-29T09:55:00.000Z",
      };
      const auditEvent = createRestoredAuditEvent({
        skillName: skill.name,
        runtime: skill.runtime,
        reason: input.reason,
      });
      snapshot = {
        ...snapshot,
        skills: snapshot.skills.map((candidate) =>
          candidate.skillVersionId === skillVersionId ? restoredSkill : candidate,
        ),
        audit: [auditEvent, ...snapshot.audit],
      };
      return RestoreSkillResponseSchema.parse({ skill: restoredSkill, auditEvent });
    },
  };
}
