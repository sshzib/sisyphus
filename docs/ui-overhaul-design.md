# Flat workspace UI overhaul

## Usage

The public UI contract does not change. Web, desktop, and tests keep their current call sites.

```tsx
<DashboardApp client={sessionClient} hostContext={{ kind: "web" }} />
```

```tsx
<DashboardApp
  client={desktopClient}
  hostContext={hostContext}
  readLocalEvidence={(eventId) => window.sisyphusDesktop.getLocalEvidence(eventId)}
/>
```

`DashboardApp` continues to own section navigation, runtime filtering, snapshot reloads, error recovery, skill restoration, and local-evidence display.

## Problem

The dashboard has the right behavior but the wrong visual weight. Gradients, blur, decorative shadows, glowing accents, large rounded cards, and loose spacing make a compact operations product feel ornamental. The redesign must apply one restrained workspace language across nine data-heavy views without weakening data, host, action, or accessibility boundaries.

## Shape

The app uses a 220px sidebar, a 56px top bar, and one fluid content canvas. Near-black and charcoal surfaces differ by small tonal steps. Surface tone and spacing separate the shell, table rows, and dialog regions. No UI element uses a visible border or divider line. Individual cards do not each get an outline. The interface uses 6px and 8px radii, except for status pills.

Type creates the hierarchy. Shell titles use 14px to 15px type, feature headlines use 18px type, and dense body and table rows use 12px to 13px type. Controls stay between 32px and 36px tall. Color is reserved for the cool blue product accent and semantic green, amber, red, and violet states. The UI contains no gradient, blur, glow, decorative shadow, or visible border.

The overview becomes a quiet cohort header, one divided metric strip, dense run and integration rows, and compact failure rows. The coverage ring becomes a numeric ratio with a flat progress bar. Tables, agent cohorts, conflicts, integrations, policies, audit events, and devices use flat grouped rows or low-contrast sections. The layout keeps every existing value and action.

Navigation groups the nine existing sections but keeps the same real buttons and accessible names. A local inline SVG switch replaces two-letter glyphs without adding a dependency. Below 900px, the same navigation becomes the existing off-canvas drawer. Near 390px, metrics use two columns, tables scroll, dialogs use narrow margins, and global status and runtime controls remain visible.

The hosted access state uses a centered 440px flat panel. The desktop bootstrap state uses the same canvas and compact brand treatment. Both keep their existing logic and semantics.

## Internal sketch

```tsx
interface SectionDefinition {
  readonly id: Section;
  readonly label: string;
}

interface NavigationGroup {
  readonly label: string;
  readonly sections: readonly SectionDefinition[];
}

function SectionIcon({ section }: { readonly section: Section }): ReactNode {
  // Return one exhaustive 16px outline SVG.
  throw new Error("not implemented");
}

function DashboardSection(input: {
  readonly section: Section;
  readonly snapshot: DashboardSnapshot;
  readonly runtime: AgentRuntime | undefined;
  readonly onNavigate: (section: Section) => void;
  readonly onRestore: (skill: SkillSummary) => void;
  readonly hostContext: HostContext | undefined;
  readonly onInspectEvidence?: (run: RunSummary) => void;
}): ReactNode {
  // Keep the exhaustive section switch and direct view calls.
  throw new Error("not implemented");
}
```

`DashboardAppProps` remains the only public interface. Callers do not learn about tokens, breakpoints, icon paths, host-screen layout, or dialog styling. The existing section switch keeps one owner for screen routing. Each view keeps the layout knowledge for its data instead of passing it through a generic card API.

## Module map

- `packages/ui/src/DashboardApp.tsx` owns state, handlers, navigation groups, local icons, the nine views, and dialogs.
- `packages/ui/src/styles.css` owns the token contract, shell, view rules, dialog rules, and breakpoints.
- `apps/web/app/web.css` owns only hosted access states and consumes the shared tokens.
- `apps/desktop/src/renderer/renderer.css` owns only the desktop minimum size, selectable fields, and bootstrap states.
- `scripts/check-ui-style.mjs` checks the flat-style rules, all nine section icons, the 900px drawer breakpoint, and reduced-motion coverage.

## Synthesis decision

Candidate A is the base. It scored 29 of 30 against the arena rubric. Candidate B scored 23 of 30. Both the independent judge and the primary review selected Candidate A.

The final design adds Candidate B's explicit 440px hosted access panel and flat desktop bootstrap treatment. It also adds Candidate B's checks for all nine sections, the 900px breakpoint, and reduced-motion rules.

The top-tab command center was rejected. Nine tabs need horizontal scrolling before the drawer breakpoint, weaken scanability, and depart from the fixed-sidebar language in the references. Candidate B's stacked mobile table model was also rejected because it risks a second presentation tree and accessibility drift.

## Tradeoffs accepted

- We accept repeated view-specific section markup in exchange for avoiding a shallow universal card component.
- We accept horizontal table scrolling at narrow web widths in exchange for keeping one semantic table and every column.
- We accept local SVG paths in one exhaustive switch in exchange for no icon dependency and one icon owner.
- We keep the product dark-only. The light reference informs hierarchy and restraint but does not add a theme system.

## Alternatives considered

- A top-tab command center lost because nine sections do not fit cleanly and the references rely on persistent sidebar navigation.
- A three-pane inspector lost because most sections have no selection state for the third pane.
- A universal component library lost because its prop interfaces would expose styling decisions while hiding little behavior.
- Responsive card copies of tables lost because duplicate render trees increase behavior and accessibility drift.

## Risks

- Long production workspace and section labels may put pressure on the 220px sidebar. Text must truncate without changing accessible names.
- Dense type must remain readable on Windows at 100 percent scaling. Browser inspection must cover 1280px and 900px widths.
- Subtle tonal separation can become muddy on poor displays. Surface tokens need enough luminance difference without turning into outlined card noise.

## Verification

- `pnpm verify` runs the boundary and UI-style audits, all workspace typechecks and tests, both production builds, desktop packaging, and the packaged-worker smoke test.
- Live browser checks cover all nine sections, runtime filtering, the restore dialog, the 1440px workspace layout, and the 390px drawer layout.
- The closed mobile drawer uses CSS visibility and pointer exclusion so its controls do not remain in the keyboard tab order.
