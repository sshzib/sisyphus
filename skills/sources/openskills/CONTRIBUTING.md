# Contributing to openskills

Thank you for contributing. Every skill in this repo is used by real engineers shipping real products. The bar is high by design — a mediocre skill is worse than no skill.

---

## What makes a good skill

A skill is not a prompt. A skill is a production-grade, opinionated guide that turns an AI agent into a domain expert. It must:

- Have a single, clear purpose — one job done excellently
- Work without the contributor being in the room — the AI must be able to execute it cold
- Include a **Definition of Done** — a checklist that makes "complete" unambiguous
- Cover failure modes, not just the happy path
- Be tested against real tasks before submission

---

## Adding a new skill

### 1. Create the skill folder

```bash
mkdir skills/your-skill-name
touch skills/your-skill-name/SKILL.md
```

Skill names must be:
- `lowercase-kebab-case`
- Descriptive of the **role**, not the task (e.g. `database-architect`, not `write-sql`)
- Unique — check existing skills before naming

### 2. Write the SKILL.md

Every SKILL.md **must** start with this exact frontmatter:

```markdown
---
name: your-skill-name
description: One or two sentences. What it does AND when to use it. Trigger conditions must be explicit so the agent knows when to load this skill automatically.
---
```

**Description rules:**
- Must answer: what does it do? when should an agent load it?
- Include explicit trigger phrases: "Use when the user asks to...", "Use when the user says..."
- Maximum 2 sentences
- No jargon in the description — it must be readable by any AI agent

### 3. Required skill body sections

Every skill body must include these sections (in order):

```markdown
# Skill Title

[Opening paragraph: approach and mindset. What kind of engineer does this well and why.]

---

## [Skill Name] Principles
[5-8 load-bearing beliefs. Violating these produces bad outcomes.]

---

## Step 0: Ground the Work
[What to establish before doing anything. Questions to ask. Assumptions to surface.]

---

## [Main execution sections]
[The core workflow, patterns, templates, checklists, code examples]

---

## Definition of Done
[Checklist format. Every item must be verifiable. No vague items like "looks good".]
```

### 4. Quality checklist before submitting

- [ ] Frontmatter is valid YAML with `name` and `description`
- [ ] Skill name is unique and follows `lowercase-kebab-case`
- [ ] Description triggers are explicit ("Use when the user asks to...")
- [ ] Opening paragraph establishes the mindset, not just the task
- [ ] At least 5 principles that carry real weight
- [ ] Step 0 grounds the work before any action is taken
- [ ] All code examples are correct and tested
- [ ] All commands are copy-pasteable with no unexplained placeholders
- [ ] Definition of Done has ≥ 8 concrete, verifiable checklist items
- [ ] No placeholder text, no `TODO`, no `example.com` that isn't intentional
- [ ] Minimum 200 lines — if it's shorter, it's probably not detailed enough
- [ ] Read by someone who did not write it and executed successfully

### 5. Submit the PR

```bash
git checkout -b skill/your-skill-name
git add skills/your-skill-name/SKILL.md
git commit -m "feat(skills): add your-skill-name skill"
git push origin skill/your-skill-name
# Open PR against main
```

**PR title format:** `feat(skills): add <skill-name> — <one line description>`

**PR description must include:**
- What problem does this skill solve?
- What AI agents was it tested with?
- Example of a prompt that would trigger this skill
- Example output (or describe what it produces)

---

## Improving existing skills

For improvements to existing skills:

- **Bug fix** (wrong command, broken example, stale docs): PR directly, no issue needed
- **Minor improvement** (better examples, clearer prose, additional patterns): PR with description of what improved and why
- **Significant change** (restructure, new sections, changed workflow): Open an issue first to discuss

All changes to existing skills must:
- Not remove content without replacement — skills get more comprehensive over time, not less
- Not change the `name` field — that is a breaking change for all installs
- Update the Definition of Done if new capabilities are added

---

## Skill categories

Place new skills in the correct phase category when updating `skills.json`:

| Phase | Category | Example skills |
|-------|----------|---------------|
| `think` | planning, validation | office-hours, plan-ceo-review |
| `plan` | spec, architecture | spec-author, system-design, autoplan |
| `build` | backend, frontend, ai, data, infra, security | backend-dev, ai-engineer, data-engineer |
| `review` | quality, dx | code-reviewer, devex-engineer |
| `test` | quality | test-writer, qa-engineer, debugger |
| `ship` | git, release, ops | commit-message, release-engineer, sre-canary |
| `reflect` | improvement | retro-engineer |
| `docs` | documentation | technical-writer |
| `deploy` | customer, delivery | forward-deployment-engineer |

---

## What we will not merge

- Skills that duplicate an existing skill without clear differentiation
- Skills that are thin wrappers around a single prompt
- Skills without a Definition of Done
- Skills with broken code examples
- Skills that are tool-specific and won't work with any AI agent (e.g., hardcoded Claude-specific syntax)
- Skills generated entirely by AI without human review and testing

---

## Code of Conduct

Be excellent to each other. Critique the skill, not the contributor.

---

## Questions?

Open a GitHub Discussion. We're happy to give feedback on skill ideas before you write them.
