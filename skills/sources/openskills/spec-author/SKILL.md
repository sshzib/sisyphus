
---
name: spec-author
description: Turn vague intent into a precise, executable specification. Use when the user has a feature idea, bug report, or product change that needs to be turned into a structured spec before implementation begins. Also use when creating GitHub issues, writing technical requirements, or producing implementation-ready documents from rough ideas.
---

# Spec Author Skill

## Purpose

Transform raw, incomplete, or ambiguous product ideas into structured, implementation-ready specifications. A good spec eliminates the guesswork from engineering, surfaces hidden constraints before coding begins, and creates a shared contract between product, design, and engineering.

This skill operates across five sequential phases: **Why → Scope → Technical → Draft → File**.

Do not skip phases. Do not generate a spec from the first message alone. The quality of the output depends entirely on the discipline of the process.

---

## Trigger Conditions

Invoke this skill when the user says any of the following (or close variants):

- "spec this out"
- "write a spec for…"
- "turn this into a ticket"
- "make this a GitHub issue"
- "file a backlog item"
- "write up a technical requirement"
- "I have an idea, help me think it through"
- "what do we need to build for…"
- "write implementation-ready docs for…"
- "draft a feature proposal"
- "write acceptance criteria for…"

---

## Core Principles

1. **Intent over literal request.** What the user *said* is often different from what they *meant*. Your job is to surface the difference before writing a single word of spec.
2. **Read before you write.** Never author a technical spec without first reading the relevant code. Specs that ignore existing implementation details are fiction, not engineering.
3. **Quality is a gate, not a goal.** A spec that scores below 7/10 on the internal quality rubric must not be filed or handed to engineering. Revise until it passes.
4. **Scope is sacred.** Every spec must have an explicit "Out of Scope" section. Undefined boundaries are debt accrued before a line of code is written.
5. **Acceptance criteria are testable, not descriptive.** "The page should look good" is not an acceptance criterion. "The page renders within 200ms at P95 under 100 concurrent users" is.

---

## Phase 1: Why (Intent Extraction)

**Goal:** Understand the real problem being solved before anything is designed or scoped.

### Steps

1. Read the user's input carefully. Identify:
   - What they explicitly stated (the surface request)
   - What problem they are actually trying to solve (the root need)
   - Who is affected (the user persona or system actor)
   - What "done" looks like to them intuitively

2. Ask clarifying questions if the intent is unclear. Ask at most **three questions at once**. Do not overwhelm with a questionnaire. Prioritize the highest-leverage unknowns:
   - "What outcome does this enable that isn't possible today?"
   - "Who is the primary user of this feature, and what is their job-to-be-done?"
   - "Is there a specific failure mode or pain point driving this request?"

3. Write a **Problem Statement** (2–4 sentences). This must:
   - Name the actor(s)
   - Describe the gap or pain
   - Explain why solving it matters now
   - Avoid naming any solution

4. Validate the problem statement with the user before proceeding. If they correct it, revise and revalidate.

### What the User Said vs. What They Meant

This is the most important judgment you make in Phase 1. Examples:

| What they said | What they likely meant |
|---|---|
| "Add a dark mode toggle" | Users are complaining about eye strain; the visual experience needs to adapt to system preferences |
| "Fix the login bug" | Authentication is flaky and users are getting logged out unexpectedly, causing churn |
| "Make the dashboard faster" | The dashboard loads slowly on mobile and users abandon before it finishes |
| "Add an export button" | Users need to move data out of the system into Excel for reporting workflows |
| "Refactor the auth module" | The auth code is hard to extend, and a new SSO requirement is blocked behind it |

Never accept the surface request as the full truth. Dig one level deeper in every case.

---

## Phase 2: Scope (Boundary Definition)

**Goal:** Establish exactly what is and is not part of this unit of work.

### Steps

1. Based on the validated problem statement, draft an initial feature boundary. Be specific and opinionated. Vague scope boundaries are the primary source of scope creep.

2. Enumerate what is **explicitly included**:
   - User-facing behaviors
   - System behaviors
   - Data changes (schema, state, storage)
   - API changes (new endpoints, modified contracts)
   - Configuration or environment changes

3. Enumerate what is **explicitly excluded** (Out of Scope):
   - Adjacent features the user might assume are included
   - Future phases intentionally deferred
   - Edge cases that are acknowledged but not addressed in this iteration
   - Platform or environment constraints (e.g., "mobile-only, no desktop in this phase")

4. Identify **dependencies**:
   - Other systems, services, or teams that must be involved
   - Prerequisites that must be completed first
   - Shared infrastructure this feature relies on

5. Estimate **effort tier** (not story points — use t-shirt sizing):
   - **XS:** < 1 day, single file, no schema change
   - **S:** 1–2 days, 1–3 files, no new API surface
   - **M:** 3–5 days, multiple components, minor API or schema change
   - **L:** 1–2 weeks, architectural impact, cross-team coordination likely
   - **XL:** > 2 weeks, multi-sprint, should be decomposed before filing

   If the estimate is **L or XL**, recommend decomposition before continuing. Offer to help break it down.

6. Confirm scope with the user. Do not proceed to Phase 3 until the boundary is agreed.

---

## Phase 3: Technical (Code Reading & Constraint Discovery)

**Goal:** Ground the spec in actual implementation reality. Surface constraints, risks, and existing patterns before writing any requirements.

### Mandatory Steps

> **This phase requires reading code. Do not skip it. Specs written without reading the codebase produce incorrect assumptions that waste engineering time.**

1. **Locate relevant files.** Based on the scope, identify:
   - Entry points (routes, controllers, handlers, main modules)
   - Data models (schema definitions, ORM models, type definitions)
   - Existing utilities or abstractions the feature should reuse
   - Test files that describe current behavior

   Use `Bash`, `Read`, `Search`, and `List` tools to explore. Do not guess at file paths.

2. **Read the relevant code.** For each relevant file:
   - Understand the current data flow
   - Identify existing patterns the new feature must follow (naming conventions, error handling style, logging patterns)
   - Note any hardcoded assumptions that may conflict with the new requirement
   - Identify tech debt that intersects with the proposed change

3. **Document technical constraints.** Record:
   - Schema constraints (foreign keys, nullable fields, index requirements)
   - API contract constraints (versioning, backward compatibility)
   - Framework or library constraints (ORM limitations, router restrictions)
   - Performance constraints (query budget, latency SLAs)
   - Security constraints (auth requirements, input validation rules, PII handling)
   - Platform constraints (browser support, OS targets, runtime environment)

4. **Identify implementation risks.** Flag anything that:
   - Requires migration of existing data
   - Touches shared infrastructure with blast radius beyond this feature
   - Introduces a breaking change to existing API consumers
   - Has no existing test coverage that would catch regressions

5. **Map existing tests.** Note what is already covered and where new tests are required.

6. **Summarize findings.** Write a concise Technical Context block (see template below) before drafting requirements.

---

## Phase 4: Draft (Specification Writing)

**Goal:** Produce a complete, structured specification document that a developer can implement from without asking clarifying questions.

### Spec Template

Use this exact structure for every spec produced by this skill:

```markdown
# [Feature / Bug Title] — Spec

**Status:** Draft | Review | Approved  
**Author:** [name or "spec-author skill"]  
**Date:** YYYY-MM-DD  
**Effort:** XS | S | M | L | XL  
**Priority:** P0 (critical) | P1 (high) | P2 (medium) | P3 (low)  
**Labels:** [comma-separated tags, e.g., backend, auth, mobile, breaking-change]

---

## 1. Problem Statement

> [2–4 sentences. Name the actor, describe the gap, explain why it matters now. No solution language.]

---

## 2. Goal

> [One sentence. What the system or user can do after this is shipped that they cannot do today.]

---

## 3. Background & Context

> [Optional. Any historical context, prior attempts, related issues, or external requirements (customer request, compliance mandate, OEM spec, etc.) that inform this work.]

---

## 4. User Stories

Format: **As a [actor], I want to [action] so that [outcome].**

- As a [role], I want to [behavior] so that [value].
- As a [role], I want to [behavior] so that [value].
- (Add as many as needed to cover the full user-facing surface of the feature.)

---

## 5. Functional Requirements

Requirements must be:
- Written in imperative form ("The system SHALL…" or "The API MUST…")
- Uniquely numbered (REQ-001, REQ-002, …)
- Testable — each one maps to at least one acceptance criterion

### 5.1 Core Requirements (Must Have)

- **REQ-001:** [Requirement statement]
- **REQ-002:** [Requirement statement]

### 5.2 Secondary Requirements (Should Have)

- **REQ-010:** [Requirement statement]

### 5.3 Future / Deferred (Won't Have — This Iteration)

- **REQ-020 (deferred):** [Requirement statement — noted for future phases]

---

## 6. Technical Context

> [Populated in Phase 3. Describe relevant existing code, patterns, and infrastructure.]

### 6.1 Affected Files / Modules

| File / Module | Role | Change Type |
|---|---|---|
| `path/to/file.ext` | [what it does] | Modify / Create / Delete |

### 6.2 Data Model Changes

```sql
-- Example: new columns or tables
ALTER TABLE users ADD COLUMN theme VARCHAR(10) DEFAULT 'light';
```

> If no schema changes: "None required."

### 6.3 API Changes

| Method | Path | Change | Notes |
|---|---|---|---|
| `GET` | `/api/v1/users` | Add `theme` field to response | Backward-compatible |

> If no API changes: "None required."

### 6.4 Technical Constraints

- [Constraint 1 — e.g., Must remain backward-compatible with API v1 consumers]
- [Constraint 2 — e.g., Cannot exceed 50ms added latency to auth middleware]
- [Constraint 3 — e.g., PII fields must not appear in application logs]

### 6.5 Implementation Risks

| Risk | Severity | Mitigation |
|---|---|---|
| [Description] | High / Medium / Low | [Mitigation strategy] |

---

## 7. Acceptance Criteria

Acceptance criteria must be:
- **Specific:** Reference exact values, states, or behaviors
- **Testable:** A QA engineer or automated test can verify pass/fail without ambiguity
- **Atomic:** One observable outcome per criterion
- **Numbered:** AC-001, AC-002, …

Format: **Given [precondition], when [action], then [observable outcome].**

- **AC-001:** Given a user with `role = admin`, when they navigate to `/settings`, then the theme toggle is visible and defaults to the user's saved preference.
- **AC-002:** Given a user toggles dark mode, when the page reloads, then the dark mode preference persists across sessions.
- **AC-003:** Given the theme API endpoint is called with an invalid value, then the system returns HTTP 422 with error code `INVALID_THEME_VALUE`.
- **AC-004:** Given the feature flag `dark_mode_enabled` is `false`, then the toggle is hidden and no theme classes are applied.

---

## 8. Out of Scope

The following are explicitly **not** part of this spec:

- [Item 1 — e.g., Custom user-defined color themes (deferred to v2)]
- [Item 2 — e.g., Dark mode support on the mobile app (separate ticket required)]
- [Item 3 — e.g., Automatic theme switching based on time of day]

> Anything not listed in Sections 5 or 7 is out of scope by default. If in doubt, it's out of scope.

---

## 9. Security & Privacy Considerations

- [ ] Does this feature handle PII? If yes, describe storage, access, and retention policy.
- [ ] Does this feature expose a new API surface? If yes, describe authentication and authorization model.
- [ ] Does this feature change access control logic? If yes, describe the change and risk.
- [ ] Does this feature introduce new third-party dependencies? If yes, list and assess.
- [ ] Does this feature log user behavior? If yes, ensure compliance with applicable privacy policies.

---

## 10. Test Plan

### Unit Tests
- [What logic needs unit coverage and in which file/module]

### Integration Tests
- [What API contracts or service interactions need integration coverage]

### End-to-End Tests
- [What user journeys must be covered in automated E2E or manual QA]

### Regression Risks
- [What existing behavior could be broken by this change and how to verify it is not]

---

## 11. Definition of Done

- [ ] All functional requirements (Section 5.1) are implemented
- [ ] All acceptance criteria (Section 7) pass in staging
- [ ] Unit tests written and passing (minimum threshold: 80% line coverage on new code)
- [ ] Integration tests written and passing
- [ ] No new MISRA / CERT / linting violations introduced
- [ ] Code reviewed and approved by at least one peer
- [ ] Documentation updated (API docs, README, changelog, or runbook as applicable)
- [ ] Feature flag (if applicable) tested in both on/off states
- [ ] Security considerations checklist (Section 9) completed and signed off
- [ ] Spec status updated to `Approved` and filed in team corpus
- [ ] Linked to parent epic or milestone (if applicable)
- [ ] Shipped via `/ship` workflow and source issue closed on merge

---

## 12. Open Questions

> Questions that remain unresolved at the time of filing. Each must have an owner and a target resolution date.

| # | Question | Owner | Due |
|---|---|---|---|
| 1 | [Question] | [Name / Team] | YYYY-MM-DD |

---

## 13. References

- [Link to related issue, PR, design file, architecture doc, or customer feedback]
- [Link to relevant code or documentation]
- [Link to standard or compliance requirement, e.g., ISO 26262 ASIL level]
```

---

## Phase 5: File (Archiving & Integration)

**Goal:** Save the spec to the team corpus, link it to the ship workflow, and ensure it is discoverable for future work.

### Steps

1. **Save the spec file.** Write the spec to:
   ```
   .specs/<YYYY-MM-DD>-<slug>.md
   ```
   Where `<slug>` is a kebab-case summary of the feature title (e.g., `2025-07-22-dark-mode-toggle.md`).

   Create the `.specs/` directory if it does not exist.

2. **Create the `.specs/index.md` registry** (or append to it if it exists). Each entry:
   ```markdown
   - [Dark Mode Toggle](.specs/2025-07-22-dark-mode-toggle.md) — 2025-07-22 — Status: Draft — P1 — M
   ```

3. **Commit the spec** (if in a git repo):
   ```bash
   git add .specs/
   git commit -m "spec: add dark-mode-toggle spec (P1, M effort)"
   ```
   Include `Generated with BEACON` in the commit body per repo convention.

4. **File as GitHub issue** (if the user requests it):
   - Title: `[Spec] Feature Title — Priority | Effort`
   - Body: the full spec markdown
   - Labels: derived from the spec's Labels field
   - Milestone: link to current sprint or roadmap milestone if known

5. **Link to ship workflow.** Inform the user:
   > "This spec is ready for implementation. When the work is complete, use `/ship` to open a PR. The `/ship` workflow will close this issue automatically on merge if you reference it with `Closes #<issue-number>` in the PR description."

---

## Quality Gate

**Every spec produced by this skill must be scored before it is delivered.**

Score the spec on the following rubric. Each criterion is worth 1 point:

| # | Criterion | Pass Condition |
|---|---|---|
| 1 | Problem Statement | Present, actor-named, no solution language |
| 2 | Goal | One sentence, measurable outcome |
| 3 | User Stories | At least one story per user-facing behavior |
| 4 | Requirements | Imperatively written, numbered, traceable to ACs |
| 5 | Technical Context | Real code read; files, constraints, risks documented |
| 6 | Acceptance Criteria | Given/When/Then format, specific values, numbered |
| 7 | Out of Scope | At least two explicit exclusions |
| 8 | Security Checklist | All five items assessed (not just copied blank) |
| 9 | Definition of Done | All checkboxes present and applicable items checked |
| 10 | Open Questions | Unresolved items listed with owner and due date, OR explicitly noted as "None" |

**Minimum passing score: 7 out of 10.**

If the score is 6 or below:
- Do **not** deliver the spec.
- Do **not** file it.
- Identify which criteria failed, explain why, and revise the spec.
- Re-score and only deliver once ≥ 7/10 is reached.

If the score is 7–8: Deliver with a note on which criteria are weak and how to improve them.

If the score is 9–10: Deliver and note it is ready for engineering handoff without changes.

Always include the score at the top of the delivered spec under Status:

```markdown
**Quality Score:** 8/10 — Ready for engineering handoff
```

---

## Acceptance Criteria Writing Guide

Writing good acceptance criteria is a skill. Follow these rules:

### Rules

1. **Use Given/When/Then.** Every criterion must follow this structure.
   - **Given:** The precondition or system state before the action.
   - **When:** The trigger — what the user does or what event occurs.
   - **Then:** The exact, observable, verifiable outcome.

2. **Be specific about values.** Never use vague words like "correctly", "properly", "quickly", "successfully" without a concrete definition.
   - ❌ "The system should respond quickly."
   - ✅ "The system responds within 200ms at P95 under 500 concurrent users."

3. **One outcome per criterion.** Do not bundle multiple behaviors into a single AC. Split them.

4. **Cover the unhappy path.** For every happy-path AC, ask: "What happens when this fails?" Write a corresponding failure AC.

5. **Cover edge cases explicitly.** Empty states, null inputs, unauthorized actors, rate limits, concurrent actions.

6. **Reference specific roles.** Don't say "the user". Say "a user with role = `viewer`" or "an unauthenticated request".

### Examples by Category

**UI Behavior:**
> Given a user with a saved `theme = dark` preference, when they load the dashboard, then the dark CSS class is applied to the root element and persists across hard refreshes.

**API Behavior:**
> Given a valid JWT for a `role = admin` user, when a `DELETE /api/v1/resources/:id` request is made for an existing resource, then the response is HTTP 204 and the resource no longer appears in subsequent `GET` requests.

**Error Handling:**
> Given an invalid email address is submitted in the registration form, when the form is submitted, then the system displays the inline error "Please enter a valid email address" adjacent to the email field without navigating away.

**Performance:**
> Given the product listing page with 500 items, when the page first loads on a 4G connection (simulated at 20 Mbps), then the Largest Contentful Paint (LCP) is ≤ 2.5 seconds.

**Security:**
> Given an unauthenticated request, when `GET /api/v1/admin/users` is called, then the system returns HTTP 401 and does not include any user data in the response body.

**Data Integrity:**
> Given two concurrent requests to decrement the same inventory count from 1 to 0, when both requests are processed, then the final inventory count is 0 and exactly one request receives a success response.

---

## Technical Constraints Section Guide

The Technical Constraints section must be populated from **actual code reading**, not assumptions. Include:

### Constraint Categories

**Compatibility Constraints**
- API version compatibility (must not break v1 consumers)
- Database migration constraints (zero-downtime deployment required)
- Browser or OS minimum support targets

**Performance Constraints**
- Latency budgets (e.g., "Auth middleware must not exceed 10ms overhead")
- Memory limits (e.g., "Embedded target: 64KB RAM")
- Throughput requirements (e.g., "Must handle 10,000 events/second")

**Security Constraints**
- Authentication requirements for new endpoints
- Input sanitization and validation rules
- Encryption requirements for data at rest or in transit
- Audit logging requirements

**Platform Constraints**
- RTOS scheduling limits (for automotive/embedded)
- AUTOSAR layer restrictions
- MISRA C/C++ compliance zones
- CAN/LIN/Ethernet protocol boundaries

**Dependency Constraints**
- Third-party library versions that cannot be changed
- Shared infrastructure owned by another team
- Feature flags that control rollout

### Example Technical Constraints Block

```markdown
### 6.4 Technical Constraints

- The authentication middleware at `src/middleware/auth.ts` is shared across all routes; any change adds latency to every authenticated request — keep additions under 5ms.
- The `users` table uses a composite primary key `(org_id, user_id)` — all new queries must include `org_id` in the WHERE clause or risk cross-tenant data leakage.
- The frontend build system is Webpack 4; ESM-only npm packages cannot be used without additional configuration.
- The mobile app (iOS/Android) consumes this API at version `v1`; any change to existing response shapes is a breaking change and requires a versioned endpoint.
- MISRA C 2012 compliance is required for all code in `src/embedded/` — no dynamic memory allocation, no recursion.
```

---

## Out of Scope Section Guide

The Out of Scope section is not optional. It prevents scope creep, manages stakeholder expectations, and protects engineering from unplanned work.

### How to write it

1. **Think about what someone might reasonably assume is included.** Add those to Out of Scope explicitly.
2. **Think about the adjacent features.** Anything related but not this ticket — list it.
3. **Think about future phases.** If something is deferred, name it here and note it's deferred, not cancelled.
4. **Think about edge cases you're not handling.** List them so QA doesn't write tests for them.

### Template entries

```markdown
## 8. Out of Scope

The following are explicitly **not** part of this spec:

- **Custom color themes:** Users may only toggle between system light and dark modes. Custom hex-color theming is deferred to a future phase.
- **Mobile app (iOS/Android):** Theme preference sync with the mobile app is a separate workstream and not included here.
- **Email notifications:** No changes to notification templates or delivery are included in this spec.
- **Admin override:** Admins cannot force a theme on behalf of other users in this iteration.
- **Legacy browser support (IE 11):** Dark mode CSS variables are not supported in IE 11. IE 11 users will continue to see the light theme. This is an accepted known limitation.
```

---

## Spec Archiving & Team Corpus

Every spec filed through this skill is added to the team's **spec corpus** — a persistent, searchable archive of past decisions and requirements.

### Why this matters

- **Prevents re-speccing the same problem.** Future engineers can search the corpus before starting new work.
- **Creates institutional memory.** When a developer asks "why was this built this way?", the spec is the answer.
- **Enables traceability.** Requirements in the spec trace forward to code, tests, and PRs. This is required for ASPICE, ISO 26262, and ISO/SAE 21434 audit trails.

### Corpus structure

```
.specs/
  index.md                         ← Registry of all specs
  2025-07-22-dark-mode-toggle.md   ← Individual spec files
  2025-07-15-auth-refresh-token.md
  2025-07-01-ota-update-rollback.md
```

### Index format

```markdown
# Spec Corpus Index

| Date | Title | Status | Priority | Effort | File |
|---|---|---|---|---|---|
| 2025-07-22 | Dark Mode Toggle | Approved | P1 | M | [link](.specs/2025-07-22-dark-mode-toggle.md) |
| 2025-07-15 | Auth Refresh Token | Shipped | P0 | S | [link](.specs/2025-07-15-auth-refresh-token.md) |
```

### Searching the corpus

Before writing a new spec, search the corpus:

```bash
grep -r "dark mode" .specs/
grep -r "authentication" .specs/
```

If a related spec exists, surface it to the user before starting a new one. Ask:
> "I found a related spec: `.specs/2025-07-15-auth-refresh-token.md`. Do you want to extend it, supersede it, or start a fresh spec?"

---

## Integration with Ship Workflow

Specs produced by this skill are designed to integrate directly with the `/ship` workflow:

1. **Spec is filed → Issue is created.** The spec becomes the GitHub issue body.
2. **Developer branches from main.** Branch name convention: `feat/<spec-slug>` or `fix/<spec-slug>`.
3. **Developer implements.** Uses the spec's requirements and ACs as the implementation contract.
4. **Developer opens PR.** PR description references the issue: `Closes #<issue-number>`.
5. **`/ship` workflow runs.** Validates: tests pass, ACs are met, DoD checklist complete.
6. **PR merges.** GitHub closes the source issue automatically. Spec status in `.specs/index.md` is updated to `Shipped`.

### Spec lifecycle states

```
Draft → Review → Approved → In Progress → Shipped | Cancelled
```

Update the `Status` field in the spec header as it moves through each state.

---

## Definition of Done (Global Checklist)

This checklist applies to every spec, not just the final document. It ensures the spec is truly ready before engineering begins.

```markdown
## Definition of Done — Spec Author Checklist

### Spec Completeness
- [ ] Problem Statement is present, actor-named, and solution-free
- [ ] Goal is one sentence with a measurable outcome
- [ ] At least one user story per user-facing behavior
- [ ] All requirements are imperatively written and uniquely numbered
- [ ] Every requirement traces to at least one acceptance criterion
- [ ] Acceptance criteria follow Given/When/Then with specific values
- [ ] At least one failure/error-path acceptance criterion per feature
- [ ] Out of Scope has at least two explicit exclusions
- [ ] Security checklist is completed (not just copied blank)
- [ ] Open questions are listed with owners and due dates (or noted as None)

### Technical Grounding
- [ ] Relevant code files have been read (not guessed)
- [ ] Affected files/modules table is populated with real paths
- [ ] Data model changes are documented (or explicitly noted as None)
- [ ] API changes are documented (or explicitly noted as None)
- [ ] Technical constraints reflect actual codebase constraints
- [ ] Implementation risks are identified with mitigations

### Quality Gate
- [ ] Spec scored ≥ 7/10 on quality rubric
- [ ] Quality score noted in spec Status header

### Filing & Archiving
- [ ] Spec saved to `.specs/<YYYY-MM-DD>-<slug>.md`
- [ ] `.specs/index.md` updated with new entry
- [ ] Spec committed to repo (if in a git repo)
- [ ] GitHub issue filed (if requested by user)
- [ ] Spec linked to parent epic or milestone (if applicable)

### Handoff
- [ ] Engineering team notified or assigned
- [ ] Open questions have resolution path and owner
- [ ] User confirmed spec accurately reflects their intent
- [ ] Spec status updated to `Approved` before engineering begins
```

---

## Automotive & Embedded Domain Extensions

When working in automotive or embedded domains, extend the spec template with these additional sections:

### Safety Classification (ISO 26262)

```markdown
### Safety Extension

**ASIL Level:** QM | A | B | C | D  
**Safety Goal:** [Brief description of the safety goal this feature supports or must not violate]  
**Failure Mode Analysis:**

| Failure Mode | Severity | Exposure | Controllability | ASIL |
|---|---|---|---|---|
| [Description] | S0–S3 | E0–E4 | C0–C3 | QM–D |

**Safe State:** [What state must the system enter if this feature fails?]
```

### Cybersecurity Classification (ISO/SAE 21434)

```markdown
### Cybersecurity Extension

**TARA Reference:** [Link to Threat Analysis and Risk Assessment document]  
**Attack Surface:** [What new attack surface does this feature introduce?]  
**CAL Level:** CAL 1 | 2 | 3 | 4  
**Mitigations:** [List cryptographic, authentication, or isolation mitigations]
```

### Protocol & Network Constraints (CAN/LIN/Ethernet)

```markdown
### Network Extension

**Protocol:** CAN-FD | LIN | SOME/IP | DoIP | UDS  
**Message IDs / Signal Names:** [Specific IDs or signal names from the DBC/LDF/ARXML]  
**Timing Constraints:** [Cycle time, latency budget, deadline]  
**Backward Compatibility:** [Impact on existing network participants]
```

---

## Error Recovery & Edge Cases

### When the user is too vague

If the user provides fewer than 2 sentences of context, do not attempt to spec. Instead:

> "I need a bit more to work from. Can you tell me:
> 1. What problem is this solving for users?
> 2. What does 'done' look like — what can someone do after this ships that they can't do today?
> 3. Is this a new feature, a bug fix, or a change to existing behavior?"

### When the scope is too large (L or XL)

If the estimated effort is L or XL, pause before speccing:

> "This looks like an L or XL effort. Before I write the full spec, I recommend we decompose it into smaller units. Smaller specs are easier to estimate, review, and ship. Want me to propose a decomposition first?"

### When a related spec already exists

Search `.specs/` before starting. If a match is found:

> "I found a related spec: `.specs/2025-06-10-notification-system.md`. Do you want me to:
> A) Extend that spec with the new requirements?
> B) Write a new linked spec that supersedes it?
> C) Start completely fresh?"

### When code reading reveals a blocker

If Phase 3 reveals that the proposed feature is impossible or severely constrained by the current implementation:

> "While reading the codebase, I found a constraint that significantly impacts this spec: [describe constraint]. The proposed approach would require [describe impact]. Before continuing, we should decide: do we want to scope this differently, or address the underlying constraint first?"

---

## Response Format

When delivering a spec, use this output order:

1. **Phase summary** — brief confirmation of what was learned in each phase (1–2 sentences each)
2. **Quality score** — explicit score and which criteria passed/failed
3. **Full spec** — the complete spec document in the template format
4. **Next steps** — what the user should do now (review, approve, file as issue, begin implementation)

Keep the phase summary concise. The spec document is the deliverable — not the commentary.

---

## Final Note

A spec is a contract. It promises that if the engineering team builds exactly what is described, the product outcome the user needs will be achieved. If that promise cannot be made with confidence, the spec is not ready — regardless of how long it is or how many checkboxes are filled.

Always ask: *"If I hand this to a developer tomorrow, can they build the right thing without talking to anyone?"* If the answer is no, keep refining.
