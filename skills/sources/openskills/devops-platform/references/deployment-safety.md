# Deployment Safety Controls

## Before

Record the version, change scope, owner, health baseline, rollback action, and explicit success and abort signals. Confirm migrations and feature flags are compatible with both the old and new versions.

## During

Prefer staged exposure when the system allows it. Monitor user-visible errors, latency, saturation, business-critical events, and dependency health. Stop progression when a predefined abort signal appears.

## After

Verify the intended behavior with a real smoke test, watch the agreed window, and record the final version and evidence. A green deployment job alone is not production verification.
