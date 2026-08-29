import { describe, expect, it } from "vitest";
import {
  isCanonicalPostgresPolicySetForTable,
  type PostgresPolicyDefinition,
} from "./tenant-database.js";

const canonicalRunsPolicy: PostgresPolicyDefinition = {
  tablename: "runs",
  policyname: "tenant_runs",
  command: "ALL",
  permissive: "PERMISSIVE",
  publicOnly: true,
  usingExpression:
    "(tenant_id = (current_setting('app.tenant_id'::text))::uuid)",
  checkExpression:
    "(tenant_id = (current_setting('app.tenant_id'::text))::uuid)",
};

describe("PostgreSQL policy readiness", () => {
  it("accepts only the canonical single tenant policy", () => {
    expect(
      isCanonicalPostgresPolicySetForTable("runs", [canonicalRunsPolicy]),
    ).toBe(true);
    expect(
      isCanonicalPostgresPolicySetForTable("runs", [
        canonicalRunsPolicy,
        {
          ...canonicalRunsPolicy,
          policyname: "tenant_runs_backdoor",
          usingExpression: "true",
          checkExpression: "true",
        },
      ]),
    ).toBe(false);
  });

  it("rejects a correctly named policy with an unsafe body", () => {
    expect(
      isCanonicalPostgresPolicySetForTable("runs", [
        {
          ...canonicalRunsPolicy,
          usingExpression: "true",
          checkExpression: "true",
        },
      ]),
    ).toBe(false);
  });
});
