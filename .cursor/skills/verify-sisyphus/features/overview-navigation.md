# Overview and navigation

Overview and navigation let a user read the current agent-operation summary and move to each detailed dashboard section.

## Sub-features

- `overview-load` shows the current cohort and performance summary after startup.
- `overview-runs` opens Runs through `View all` and through the side navigation.
- `overview-integrations` opens Integrations through `Inspect` and through the side navigation.
- `overview-sections` opens every named side-navigation section.

## How to get to it (user POV)

- Open the dashboard root URL to reach Overview.
- Choose `View all` in Latest runs to reach Runs.
- Choose `Inspect` in Runtime coverage to reach Integrations.
- Choose a button in the `Dashboard sections` navigation.

## Driving it with T3 Code preview

Preconditions:

- Doctor reports the run healthy.
- The browser is at the run's root URL with demo data enabled.

- **Landing state.** Wait for `Comparable runtime cohorts`, then take a snapshot. The page heading is `Overview`, the `Performance summary` region is present, and Latest runs contains `run-1284`.
- **Runs shortcut.** Click `role=button[name='View all']`. Wait for heading `Runs`. The table includes `run-1284` and columns `Run`, `Agent`, `Skill`, `Coverage`, `Result`, `Score`, `Cost`, and `Time`.
- **Overview return.** Click `role=button[name='Overview']`. Wait for heading `Overview`.
- **Integrations shortcut.** Click `role=button[name='Inspect']`. Wait for heading `Integrations`. The page shows integration cards and capability labels.
- **Navigation list.** Use the buttons inside `Dashboard sections` to open Agents, Skills, Conflict matrix, Policies, Audit log, and Devices. After each click, wait for the matching page heading before continuing.
- **Proof.** Record at least one shortcut and one side-navigation path. The final snapshot must show the requested section heading and its section-specific content.

## Gotchas

- `View all` and `Inspect` only appear on Overview.
- The desktop layout keeps navigation visible. Narrow layouts hide it behind `Open navigation` and add `Close navigation`.
- A heading change alone is weak proof. Include a table, card, or row unique to the selected section.
- Runtime filtering persists while navigating. Reload the page before proving the unfiltered baseline.
