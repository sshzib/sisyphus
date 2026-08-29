# Integration capabilities

Integration capabilities let a user compare adapter health, versions, scope, and the enforcement actions each runtime supports.

## Sub-features

- `integrations-open` opens adapter health from Overview or side navigation.
- `integrations-health` shows healthy and degraded integrations.
- `integrations-capabilities` labels supported, partial, and unsupported controls.
- `integrations-filter` restricts cards to the selected runtime.

## How to get to it (user POV)

- Choose `Inspect` in Overview's Runtime coverage panel.
- Choose `Integrations` in the `Dashboard sections` navigation.
- Use the top-bar Runtime combobox to inspect one runtime.

## Driving it with T3 Code preview

Preconditions:

- Doctor reports the run healthy.
- Runtime is `All comparable cohorts`.

- **Overview entry.** From Overview, click `role=button[name='Inspect']` and wait for heading `Integrations`.
- **Inspect cards.** Take a snapshot. Codex, Claude Code, Cursor, and OpenCode cards show scope, adapter version, runtime version, last-seen time, and capability rows.
- **Inspect capability labels.** Confirm the rows `Prompt intercept`, `Skill routing`, `Root retry`, `Subagent retry`, `Tool prevention`, `Tool observation`, `Token usage`, and `Local evidence`. Their values are `Supported`, `Partial`, or `Unsupported`.
- **Filter.** Open the Runtime combobox, press `End`, then press `Enter`. Wait until only the OpenCode card remains. Its status is `Degraded`, and unsupported controls remain visibly labeled.
- **Second entry point.** Reset the filter with `Home` and `Enter`, return to Overview, then open Integrations through the side-navigation button. Confirm the same card set.
- **Proof.** Record both entry points and one filtered card. Copy it to `artifacts/verify-sisyphus/<run-id>/integration-capabilities.webm`.

## Gotchas

- Cursor has local and cloud cards, so an unfiltered page contains two Cursor entries.
- The visible status badge and a capability's support level describe different things. Capture both.
- Capability details are exposed as row titles. Use a snapshot for the label and support level; use a read-only DOM inspection only if the task needs the limitation text.
- Do not infer enforcement support from adapter health.
