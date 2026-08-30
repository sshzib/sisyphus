# Command center visual-system decision

## Problem

The shared dashboard needs to adopt the supplied Sisyphus workforce-monitor direction without changing its live task, agent, Skills, or control-plane behaviour. The existing stylesheet contains two partially overlapping token sets, leaving some Skills selectors backed by undefined variables.

## Usage

Both hosts continue to use the same public component API:

```tsx
<DashboardApp client={client} hostContext={hostContext} />
```

Web keeps its authenticated account controls in `HostedDashboard`; Electron keeps its IPC-backed client and login flow. Neither host needs to know about the new visual system.

## Shape

`DashboardApp` owns one small internal command-bar wrapper. `styles.css` owns the shared visual tokens, layout, panel surfaces, responsive states, and Skills styling. The public `DashboardAppProps`, the data client, and every task/action handler remain unchanged.

The command bar deliberately displays only real connection/update state already held by `DashboardApp`. It adds no data fetching or state of its own. The style layer defines the dark charcoal, teal, grid-backed visual language in one canonical token set so Overview and Skills cannot drift.

## Synthesis decision

Choose the shared-shell plus tokenized-styles approach. A CSS-only reskin could reproduce most colours but cannot cleanly provide the reference command bar across both hosts. A new host-specific dashboard would duplicate the existing data/client boundary. The selected shape preserves a single UI surface and adds only presentational markup.

## Tradeoffs accepted

- We keep the web-only sign-out control outside the shared command bar because its authentication action is host-owned.
- We use a local SVG grid asset in CSS rather than a gradient so the existing UI-style policy remains satisfied.

## Next implementation step

Add the internal command bar and replace the shared stylesheet with the normalized command-center token system.
