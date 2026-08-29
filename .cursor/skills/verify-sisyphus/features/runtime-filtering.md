# Runtime cohort filtering

Runtime filtering lets a user restrict every dashboard section to one comparable agent runtime cohort.

## Sub-features

- `runtime-select` selects a runtime through the labeled combobox.
- `runtime-overview` recalculates the overview for the selected cohort.
- `runtime-sections` filters runs, agents, skills, conflicts, integrations, policies, audit events, and devices.
- `runtime-reset` restores all comparable cohorts.

## How to get to it (user POV)

- Open the `Runtime` combobox in the top bar on any dashboard section.
- Choose `OpenCode`, `Cursor`, `Claude Code`, or `Codex`.
- Choose `All comparable cohorts` to clear the filter.

## Driving it with T3 Code preview

Preconditions:

- Doctor reports the run healthy.
- Overview shows `Comparable runtime cohorts`.
- The Runtime combobox value is `All comparable cohorts`.

- **Select OpenCode.** Click `role=combobox[name='Runtime']`, press `End`, then press `Enter`. Wait for heading `OpenCode` in the current cohort summary.
- **Prove the overview.** Take a snapshot. It shows OpenCode, `Observed only`, and OpenCode-specific totals. It does not show another runtime as the selected cohort.
- **Prove a second section.** Click `role=button[name='Runs']`. Every visible runtime cell says `OpenCode`; run `run-1282` is visible.
- **Prove integrations.** Click `role=button[name='Integrations']`. Only the OpenCode integration card remains and its status is `Degraded`.
- **Reset.** Click the Runtime combobox, press `Home`, then press `Enter`. Click `role=button[name='Overview']` and wait for `Comparable runtime cohorts`.
- **Proof.** Start a recording before selecting OpenCode and stop it after the reset. Copy it to `artifacts/verify-sisyphus/<run-id>/runtime-filtering.webm`. The recording must show the combobox action, filtered Overview, one filtered detail section, and the reset.

## Gotchas

- The combobox options are ordered with `All comparable cohorts` first and `OpenCode` last. `Home` and `End` depend on that visible option order.
- Selecting a runtime updates data asynchronously. Wait for the cohort heading or section content instead of sleeping.
- Navigation does not clear the filter.
- Runtime marks use accessible labels, so a snapshot can repeat a runtime name many times. Verify that no other runtime rows remain.
