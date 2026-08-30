# Evaluation Design

## Build an Eval Set

Use representative, consented examples. Include ordinary requests, boundary cases, known failures, adversarial inputs, and cases where the correct response is to abstain or ask for clarification. Keep the production-like input, expected behavior, and any safety constraints together.

## Select Metrics

Choose metrics that correspond to the user outcome: task success, groundedness, structured-output validity, latency, cost, or safe refusal. Record the scorer, rubric, and pass condition. Avoid a single aggregate score when a safety or reliability metric needs its own gate.

## Release Gate

Compare a candidate against a fixed baseline on the same eval set. Define acceptable regressions before running it, inspect failures by category, and retain examples that reveal real defects. Treat human review as required for subjective or high-impact outputs.
