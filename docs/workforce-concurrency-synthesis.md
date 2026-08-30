# Workforce concurrency synthesis

## Problem

The latest live task failed during Git integration because a frontend and a full-stack agent both changed `app/auth.ts`. The implementation loop also waited for each agent before starting the next one, so the dashboard did not represent a concurrent workforce. QA was not hired for that task.

## Chosen shape

Sisyphus keeps its existing orchestrator, OpenRouter client, workspace manager, control-plane events, and Overview. A small operation coordinator is the single serialized writer of the operation snapshot while independent agents work in parallel in isolated branches. The workflow is build in parallel, integrate, then reviewer and QA in parallel against the integrated snapshot.

## Synthesis decision

The serialized coordinator design was chosen because it preserves the current architecture while preventing parallel API updates from overwriting agent state. The phase scheduling, immutable result handling, targeted rebase retry, and safe append-only event journal were retained from the alternative design.

## Tradeoffs accepted

- QA and reviewers wait for an integrated artifact because a review before code exists would not be real evidence.
- The planner has stricter ownership rules so a full-stack agent cannot overlap frontend or backend specialists.
- Logs record safe event summaries and digests, never prompts, keys, source contents, or hidden reasoning.

## Verification target

A static Sisyphus landing-page request must visibly contain the Sisyphus name and AI Engineering HR or agent-workforce concept, show selected skill evidence per agent, produce durable workflow events, and stop before any AWS or local generated-code execution.
