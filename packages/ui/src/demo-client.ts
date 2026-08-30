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
    async createEngineeringTask() {
      throw new SisyphusApiError(
        "Engineering tasks require the live control plane.",
        503,
        undefined,
      );
    },
    async clearEngineeringHistory() {
      throw new SisyphusApiError(
        "Prompt-log cleanup requires the live control plane.",
        503,
        undefined,
      );
    },
    async startEngineeringExecution() {
      throw new SisyphusApiError(
        "Engineering execution controls require the live control plane.",
        503,
        undefined,
      );
    },
    async stopEngineeringExecution() {
      throw new SisyphusApiError(
        "Engineering execution controls require the live control plane.",
        503,
        undefined,
      );
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
    async listSkillRegistry() { throw new Error("The Skills registry requires a live control plane."); },
    async getSkillRegistryDetail() { throw new Error("The Skills registry requires a live control plane."); },
    async syncSkillRegistry() { throw new Error("The Skills registry requires a live control plane."); },
    async previewSkillRegistrySync() { throw new Error("The Skills registry requires a live control plane."); },
    async createCustomSkill() { throw new Error("The Skills registry requires a live control plane."); },
    async resolveSkillImprovementProposal() { throw new Error("The Skills registry requires a live control plane."); },
  };
}
