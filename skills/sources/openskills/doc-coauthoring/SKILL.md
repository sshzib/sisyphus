---
name: doc-coauthoring
description: Structured co-authoring workflow for PRDs, design docs, RFCs, decision docs, proposals, and any substantial written document. Use when the user wants to write a PRD, design doc, RFC, decision doc, one-pager, proposal, technical spec, or any structured document where quality and completeness matter. Goes deeper than technical-writer — this skill actively guides the writing process through three stages: context gathering, section-by-section refinement, and reader testing.
---

# Document Co-Authoring

Writing a document alone produces a document that makes sense to the author. Co-authoring produces a document that makes sense to the reader. This skill is the difference between the two.

You are an active guide, not a passive typist. You ask questions before writing. You brainstorm before drafting. You test the document against a reader before declaring it done. Every section goes through: clarify → brainstorm → curate → draft → refine.

---

## Co-Authoring Principles

- **Context first, writing second.** A document written without sufficient context will be rewritten. Spend time gathering context — it is never wasted.
- **Brainstorm before drafting.** Generating options before committing produces better decisions. Never jump straight from question to final prose.
- **One section at a time.** Trying to write the whole document at once produces mediocre everything. Perfect one section, then move to the next.
- **The reader is not in the room.** Everything the author knows implicitly, the reader does not. Surfaces those assumptions, names them, and either explains them or removes them.
- **Reader testing is not optional.** Authors cannot find their own blind spots. A fresh reader (or a fresh AI instance with no context) will find what the author cannot.
- **Documents must earn every sentence.** If a sentence can be removed without losing meaning, remove it. Dense, precise prose is harder to write and easier to read.

---

## When to Use This Skill

**Trigger conditions:**
- "Write a PRD for..."
- "Help me draft a design doc"
- "I need to write an RFC"
- "Can you write up a one-pager on..."
- "I need a decision doc for..."
- "Help me write a technical spec"
- Any substantial document where quality matters (not quick memos — use `internal-comms` for those)

**Document types this skill handles best:**

| Document | Who writes it | What it decides |
|---|---|---|
| **PRD** (Product Requirements Doc) | PM + Eng | What to build and why |
| **Design Doc** | Engineer | How to build it technically |
| **RFC** (Request for Comments) | Anyone | Propose a change and gather feedback |
| **Decision Doc** | Anyone | Capture a decision and its rationale |
| **One-pager** | PM / Exec | Make a case quickly |
| **Technical Spec** | Engineer | Define system behavior precisely |
| **Proposal** | Anyone | Convince someone to approve something |

---

## Stage 1 — Context Gathering

### Step 1: Meta questions (ask all at once)

Before writing anything, ask:

1. **What type of document?** (PRD / design doc / RFC / decision doc / other)
2. **Who is the primary audience?** (engineers, PMs, executives, external partners)
3. **What is the desired outcome when someone reads this?** (approve a plan, understand a decision, provide feedback, implement a spec)
4. **Is there a template or format to follow?** (company template, team convention)
5. **Any deadline or constraints?** (length limit, formality level, existing work to reference)

Tell the user they can answer in shorthand — a quick brain dump is fine.

### Step 2: Context dump

After meta questions, ask for everything they know:

```
Now dump everything relevant — don't worry about organizing it. I'll make sense of it.

This includes:
- Background on the problem or project
- Why existing solutions don't work
- Relevant team discussions or decisions
- Timeline and constraints
- Technical context or dependencies
- Stakeholder concerns or objections you anticipate
- What success looks like

More is better at this stage.
```

Accept input in any format: brain dump, bullet points, links to docs, pasted Slack threads, previous drafts.

### Step 3: Confirm understanding

Before moving to writing, summarize back:

```
Let me confirm I understand the core of this document:

**What:** [one sentence]
**Why:** [one sentence]  
**Who reads it:** [audience]
**What they need to conclude:** [desired outcome]
**Key constraints:** [length, tone, deadline]

Does this capture it? Anything I'm missing?
```

Only proceed when the user confirms.

---

## Stage 2 — Section-by-Section Refinement

Work through the document one section at a time. Never draft the whole document at once.

### Standard Document Structure

Adapt this to the document type, but these sections cover most cases:

```markdown
# [Document Title]

**Author:** [name] | **Date:** [date] | **Status:** Draft / In Review / Approved

## TL;DR
[2-3 sentences. The busiest reader should get the point here.]

## Background / Context
[Why does this document exist? What problem exists?]

## Goals
[What success looks like. Measurable where possible.]

## Non-Goals
[Explicit scope boundary. What this does NOT address.]

## Proposal / Approach
[The meat. What are we doing / deciding / building?]

## Alternatives Considered
[What else was considered and why it was rejected.]

## Open Questions
[What is still unresolved. Owner and due date for each.]

## Appendix
[Supporting detail that would bloat the main doc.]
```

### Per-Section Workflow

For **each section**, run this sequence:

#### Step 1: Clarifying Questions
Ask 5–8 targeted questions specific to this section. Example for "Goals":
```
For the Goals section — a few questions:
1. What does success look like in 3 months? In 6?
2. Is there a metric you'd point to as "we nailed it"?
3. Are there any goals you're deliberately NOT including (that someone might expect)?
4. Does anyone on the team have a different definition of success?
```

#### Step 2: Brainstorm
Generate 5–15 candidate items for the section. Label them:
```
Here are potential things to include in the Goals section:

1. Reduce checkout drop-off rate from 23% to under 15%
2. Ship to 100% of users by end of Q3
3. Zero increase in support tickets related to checkout
4. Mobile completion rate matches desktop (currently 40% lower)
5. Payment provider switch with no user-visible downtime
6. P95 checkout completion time under 3 seconds
[...]

Which of these belong? You can say "keep 1, 3, 5 — remove the rest" or just tell me what feels right.
```

#### Step 3: Curate
The user selects what stays. Accept any format:
- "Keep 1, 3, 5"
- "All of them except 4"
- "1 and 3 are good, 5 is too vague"

#### Step 4: Gap Check
After curation:
```
Anything important missing from [SECTION NAME] before I draft it?
```

#### Step 5: Draft
Write the section using only what was curated. Use `str_replace` to update the document in place — never reprint the whole doc.

#### Step 6: Refine
Iterate based on feedback. Make targeted edits. Never reprint the whole doc — only show what changed.

After 3 rounds with no substantial changes, ask:
```
This section looks stable. Anything we can cut without losing meaning?
```

---

## Stage 3 — Reader Testing

**Goal:** Catch what the author cannot see.

### Step 1: Predict reader questions
```
Before someone reads this document, what questions would they type into an AI to find it?
Let me generate the 5 most likely questions:

1. [...]
2. [...]
[...]
```

### Step 2: Test (with sub-agent if available)

Pass the document + each question to a fresh context with no prior knowledge:

```
Testing: "What is the goal of this project?"
→ Reader answer: [...]
→ Match expected: ✅ / ⚠️ Partial / ❌ Wrong

Testing: "Why was approach X rejected?"
→ Reader answer: [...]
→ Match expected: ✅ / ⚠️ Partial / ❌ Wrong
```

### Step 3: Additional checks
Run these against the document:
- "What in this doc might be ambiguous or unclear to readers?"
- "What knowledge does this doc assume readers already have?"
- "Are there any internal contradictions or inconsistencies?"

### Step 4: Fix gaps
For every ❌ or ⚠️: loop back to Stage 2 refinement for that section.

### Exit condition
When a fresh reader answers all predicted questions correctly with no ambiguity → document is ready.

---

## Document Quality Standards

### Every sentence must pass this test:
**"If I remove this sentence, does the reader lose something important?"**
If no → remove it.

### Common quality failures:

| Failure | Example | Fix |
|---|---|---|
| **Vague goals** | "Improve performance" | "Reduce P95 API latency from 800ms to under 300ms" |
| **Missing non-goals** | (nothing in non-goals section) | "We are NOT redesigning the checkout UI in this phase" |
| **Assumed context** | "As discussed in the H2 planning meeting..." | Explain the context inline |
| **Passive voice** | "A decision was made to..." | "The team decided to... because..." |
| **Weasel words** | "somewhat", "fairly", "might", "could" | Be specific or remove |
| **Missing rationale** | "We will use PostgreSQL." | "We will use PostgreSQL because we need ACID guarantees for financial data and the team has deep expertise." |
| **Orphaned alternatives** | (Alternatives Considered section is empty) | Document at least 2 alternatives and why they were rejected |

---

## PRD-Specific Template

```markdown
# PRD: [Feature Name]

**Author:** | **Date:** | **Status:** Draft
**PM:** | **Eng Lead:** | **Design:** 

---

## Problem Statement
[What user problem are we solving? Evidence that it's real.]

## Goals
- [ ] [Measurable goal 1]
- [ ] [Measurable goal 2]

## Non-Goals
- [Explicitly out of scope item 1]

## User Stories
As a [user type], I want to [action] so that [outcome].

## Requirements
### Must Have (P0)
- [Requirement]

### Should Have (P1)
- [Requirement]

### Nice to Have (P2)
- [Requirement]

## Design
[Link to Figma / mockups / wireframes]

## Technical Approach
[High-level implementation note — link to design doc for details]

## Metrics
| Metric | Baseline | Target | How measured |
|---|---|---|---|

## Timeline
| Milestone | Date | Owner |
|---|---|---|

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

## Open Questions
| Question | Owner | Due |
|---|---|---|

## Alternatives Considered
[What else was evaluated and why it was rejected]
```

---

## Definition of Done — Document Co-Authoring

- [ ] Stage 1 complete: meta questions answered, context dumped, understanding confirmed
- [ ] All sections drafted through the 5-step per-section workflow
- [ ] Every section curated by the author — nothing drafted without author selection
- [ ] Near-completion review done: full document read for flow, redundancy, and slop
- [ ] Stage 3 complete: reader questions predicted and tested
- [ ] All reader test failures resolved
- [ ] Every sentence earns its place — no filler, no generic statements
- [ ] All goals are measurable
- [ ] Non-goals section explicitly states scope boundary
- [ ] At least 2 alternatives considered and documented
- [ ] No orphaned "TBD" or placeholder text in final version
- [ ] Author has done a final read-through and signed off
