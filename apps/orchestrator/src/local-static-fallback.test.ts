import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalStaticFallbackPlan,
  createLocalStaticFallbackProposal,
  createLocalStaticFallbackReviewProposal,
} from "./local-static-fallback.js";
import { LocalStaticExecutor } from "./local-static-executor.js";
import { scanWorkspace } from "./safety-gate.js";
import { isReviewRole } from "./workforce-policy.js";

test("creates and verifies a real static storefront when provider generation is unavailable", async () => {
  const request = "Build a bold mobile-ready landing page for the Zudio clothing shop with product discovery.";
  const plan = createLocalStaticFallbackPlan(request);
  assert.equal(plan.requirements.length, 13);
  const builder = plan.requirements.find((candidate) => !isReviewRole(candidate.specialistRole));
  assert.ok(builder);
  assert.equal(plan.requirements.filter((candidate) => isReviewRole(candidate.specialistRole)).length, 12);
  const proposal = createLocalStaticFallbackProposal({
    request,
    requirement: builder,
    iteration: 1,
  });
  const index = proposal.files[0];
  assert.ok(index);

  assert.deepEqual(
    proposal.files.map((file) => file.path),
    ["index.html", "styles.css", "script.js"],
  );
  assert.match(index.content, /Zudio/i);
  assert.match(index.content, /styles\.css/u);
  assert.match(index.content, /script\.js/u);

  const musicRequest = "Build a Spotify music discovery page with playlists, a now-playing state, and a listening queue.";
  const musicPlan = createLocalStaticFallbackPlan(musicRequest);
  const musicBuilder = musicPlan.requirements.find((candidate) => !isReviewRole(candidate.specialistRole));
  assert.ok(musicBuilder);
  const music = createLocalStaticFallbackProposal({ request: musicRequest, requirement: musicBuilder, iteration: 1 });
  const musicIndex = music.files[0];
  const musicStyles = music.files[1];
  assert.ok(musicIndex);
  assert.ok(musicStyles);
  assert.match(musicIndex.content, /data-template="music"/u);
  assert.match(musicStyles.content, /\.audio-hero/u);
  assert.doesNotMatch(musicStyles.content, /\.hero \{ display: grid/u);

  const authenticationRequest = "Create an authentication page for Sprite with secure sign in, password visibility, and a product-research context card.";
  const authenticationPlan = createLocalStaticFallbackPlan(authenticationRequest);
  const authenticationBuilder = authenticationPlan.requirements.find((candidate) => !isReviewRole(candidate.specialistRole));
  assert.ok(authenticationBuilder);
  const authentication = createLocalStaticFallbackProposal({ request: authenticationRequest, requirement: authenticationBuilder, iteration: 1 });
  const authenticationIndex = authentication.files[0];
  const authenticationStyles = authentication.files[1];
  const authenticationScript = authentication.files[2];
  assert.ok(authenticationIndex);
  assert.ok(authenticationStyles);
  assert.ok(authenticationScript);
  assert.match(authenticationIndex.content, /data-template="account"/u);
  assert.match(authenticationIndex.content, /Product research/u);
  assert.match(authenticationIndex.content, /Sprite is positioned by The Coca-Cola Company/u);
  assert.match(authenticationStyles.content, /\.auth-shell/u);
  assert.match(authenticationScript.content, /data-auth-form/u);
  assert.doesNotMatch(authenticationIndex.content, /The edit/u);

  const reviewRequirement = plan.requirements.find((candidate) => candidate.specialistRole === "accessibility reviewer");
  assert.ok(reviewRequirement);
  const review = createLocalStaticFallbackReviewProposal({
    request,
    requirement: reviewRequirement,
    role: reviewRequirement.specialistRole,
    projectContext: proposal.files,
    reviewableRequirements: [builder],
  });
  assert.equal(review.verification?.verdict, "passed");
  assert.match(review.files[0]?.path ?? "", /^reviews\//u);

  const workspace = await mkdtemp(join(tmpdir(), "sisyphus-local-fallback-"));
  try {
    await Promise.all(
      proposal.files.map((file) => writeFile(join(workspace, file.path), file.content, "utf8")),
    );
    const safety = await scanWorkspace(workspace);
    assert.equal(safety.passed, true);
    assert.equal(safety.executionPlan, "static-site");

    const execution = await new LocalStaticExecutor().execute({
      taskId: "task-local-fallback",
      integrationCommit: "integration-local-fallback",
      workspace,
      expectedPlan: "static-site",
    });
    assert.equal(execution.result?.passed, true);
    assert.equal(
      execution.result?.checks.some((check) => check.name === "health-check" && check.status === "passed"),
      true,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
