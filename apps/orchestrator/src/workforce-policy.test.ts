import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentPhase,
  isReviewRole,
  validateProposalPolicy,
  validateWorkforceShape,
} from "./workforce-policy.js";

test("classifies advisory roles as review work without demoting database architecture", () => {
  assert.equal(isReviewRole("system architect"), true);
  assert.equal(isReviewRole("accessibility reviewer"), true);
  assert.equal(isReviewRole("ui ux designer"), true);
  assert.equal(isReviewRole("ui engineer"), false);
  assert.equal(isReviewRole("database architect"), false);
  assert.equal(assignmentPhase("performance reviewer"), "review");
  assert.equal(assignmentPhase("authentication engineer"), "build");
});

test("allows a concurrent specialist workforce with distinct implementation domains", () => {
  assert.doesNotThrow(() =>
    validateWorkforceShape([
      { specialistRole: "frontend engineer" },
      { specialistRole: "authentication engineer" },
      { specialistRole: "backend api engineer" },
      { specialistRole: "database architect" },
      { specialistRole: "security reviewer" },
      { specialistRole: "qa tester" },
    ]),
  );
  assert.throws(() =>
    validateWorkforceShape([
      { specialistRole: "frontend engineer" },
      { specialistRole: "ui engineer" },
    ]),
  );
});

test("keeps authentication proposals in their isolated path ownership", () => {
  const allowed = validateProposalPolicy({
    role: "authentication engineer",
    proposal: {
      safeActivity: "editing-files",
      safeActivityDetail: "editing auth/session.ts",
      summary: "Implemented the isolated authentication requirement.",
      files: [{ path: "auth/session.ts", content: "export const session = true;" }],
    },
    productContract: undefined,
  });
  const blocked = validateProposalPolicy({
    role: "authentication engineer",
    proposal: {
      safeActivity: "editing-files",
      safeActivityDetail: "editing index.html",
      summary: "Attempted to edit the frontend.",
      files: [{ path: "index.html", content: "<!doctype html>" }],
    },
    productContract: undefined,
  });

  assert.deepEqual(allowed, []);
  assert.equal(blocked.length, 1);
});
