# Sisyphus verification map

This directory is the maintained source for checking Sisyphus web dashboard behavior. Read this index before driving the app, then follow the matching feature file.

## Baseline preconditions

- Launch an isolated web dashboard with `control-sisyphus.ps1` and a unique run ID and port.
- Let the controller clear `SISYPHUS_WEB_API_URL`, `SISYPHUS_WEB_ORIGIN`, and `SISYPHUS_WEB_SESSION_KEY` in its child process so the page uses labeled deterministic demo data without auth, database, or network writes.
- Run `doctor` and require `status: healthy` before browser interaction.
- Navigate the collaborative browser to the exact environment port reported by `launch`.
- Wait for `Comparable runtime cohorts` before taking the first snapshot.
- Require visible `Demo data` and `Demo workspace` labels before treating the run as isolated.
- Never drive an instance that this verification run did not start.

## Driving conventions

- Start every recipe from a fresh page load unless its preconditions say otherwise.
- Use T3 Code `preview_snapshot` before interacting and target roles and accessible names from the snapshot.
- Use `preview_click`, `preview_press`, and `preview_type` for user actions. Do not call React state setters or the data client through `preview_evaluate`.
- Treat every locator and expected label as literal. The Skills navigation button may append a count, so its locator uses a name prefix.
- Keep browser proof and server logs under `artifacts/verify-sisyphus/<run-id>`.

## Proof and skip reporting

- Record the action and resulting state with `preview_recording_start` and `preview_recording_stop`.
- Take a semantic snapshot before the action and after the expected state appears.
- A filter proof must show both the selected control value and filtered content.
- A mutation proof must confirm the visible result from a second dashboard section.
- Record the feature ID and entry point in the copied recording filename.
- Report an unreachable path with the attempted locator and unmet precondition.
- Do not report a skipped entry point as verified through another path.
- Keep evidence after cleanup and confirm each expected file still exists.

## Feature entry contract

Each feature file starts with an H1 and one paragraph describing user-visible behavior. It then has exactly four H2 sections in this order.

1. `Sub-features` lists short IDs and behaviors.
2. `How to get to it (user POV)` lists user entry points.
3. `Driving it with T3 Code preview` gives preconditions, exact browser actions, and observable results.
4. `Gotchas` lists traps that can invalidate a run.

Keep implementation details out of feature files. Put controller internals in the parent skill.

## Features

- [Overview and navigation](./overview-navigation.md) covers the dashboard landing state and section navigation.
- [Runtime cohort filtering](./runtime-filtering.md) covers selecting one runtime and proving every dashboard section follows it.
- [Skill restoration](./skill-restoration.md) covers restoring a quarantined skill and confirming its audit event.
- [Integration capabilities](./integration-capabilities.md) covers adapter health and enforcement capability labels.
