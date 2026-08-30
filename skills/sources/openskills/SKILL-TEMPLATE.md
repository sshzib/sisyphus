---
name: <kebab-case-skill-name>
description: <One or two sentences. Say what the skill covers AND when to trigger it — include the specific keywords, tool names, and casual phrasings a user might actually type, not just the formal domain name. Be a little "pushy" here: under-triggering is the most common failure mode, so err toward more trigger terms rather than fewer.>
---

# <Skill Title>

<One paragraph that sets the operating stance — who is the AI "acting as" for this domain, and what failure mode is it optimizing to avoid? e.g. "the engineer who gets paged at 3am," "the reviewer who's seen this pattern cause an outage." This isn't decoration — it's what keeps every section below consistent in tone and rigor instead of drifting into generic advice.>

---

## When to Invoke This Skill (optional — include when trigger logic is nuanced)

<If the frontmatter description alone isn't enough to capture all the trigger conditions, use this section to be explicit. List exact phrases, edge-case triggers, and "proactively invoke" directives.>

**Proactively invoke this skill — do not answer directly — when:**
- <exact phrase or situation that should trigger this skill>
- <another trigger>
- <"Use this skill BEFORE running /related-skill when...">

---

## Step 0: Ground the Work Before Producing Output

Before writing any code/config/design, get clear on the handful of questions whose answers change everything downstream. Typically:

1. **What is actually being built/solved?** — force scope to one sentence; if it's two things, it's two tasks.
2. **Who/what consumes the output?** — different consumers imply different constraints (trust level, latency, format).
3. **What are the real constraints/targets?** — numbers, not vibes, wherever numbers are knowable.
4. **What does "done" or "healthy" look like?** — define success before producing the artifact, not after.
5. **What's the failure/rollback story?** — if this is wrong, how does it get corrected?

If the user hasn't specified these, don't silently guess on anything consequential — either ask, or state the assumption explicitly so it can be challenged.

---

## Core Principles

<3–7 principles that are true across the whole domain, each with a one-line "why" — not just a rule, but the failure it prevents. This is the difference between a skill that transfers judgment and one that's just a list of commands to copy.>

- **<Principle>** — <why it matters / what breaks without it>
- **<Principle>** — <why it matters / what breaks without it>

---

## Execution Workflow

<Define the numbered sequence of phases or steps the AI must follow. This is the structural spine of the skill — the order matters and steps should not be skipped. Each step below becomes a major section.>

```
Step 1: <PHASE NAME>  →  <one-line goal>
Step 2: <PHASE NAME>  →  <one-line goal>
Step 3: <PHASE NAME>  →  <one-line goal>
Step 4: <PHASE NAME>  →  <one-line goal>
```

---

## Step 1: <Phase Name>

<Detailed instructions for this phase. Use whichever of these content shapes fits:>

**Concrete example** (code, config, diagram, template — whatever the domain's actual artifact is):
```
<realistic, complete-enough-to-copy example — not a toy that omits the hard part>
```

**Rules, each with reasoning, not just "always/never":**
- <rule> — <why: what it prevents or enables>
- <rule> — <why: what it prevents or enables>

**Decision table** (when there's a real choice between approaches — optional, inline where relevant):

| Option | Behavior / trade-off | Use when |
|---|---|---|
| <A> | <what it costs/buys> | <signal that this is the right call> |
| <B> | <what it costs/buys> | <signal that this is the right call> |

---

## Step 2: <Phase Name>

<Same shape as Step 1. Repeat for each major step in the execution workflow.>

---

## <Additional Domain Sections — as many as the domain requires>

<For deep domains, add dedicated sections for sub-topics that don't fit neatly into the workflow steps but are required for completeness (e.g. "Security Checklist" in backend-dev, "Memory Architecture" in ai-engineer, "Shipping Streaks" in retro-engineer). Keep these focused and specific.>

---

## Edge Cases & Common Failure Modes

<The mistakes people actually make in this domain — the stuff that doesn't show up until scale/production/review. This section is what separates "textbook correct" from "actually production-grade," and it's usually the section most worth adding to when reviewing an existing skill.>

- <failure mode> → <how to avoid or catch it>
- <failure mode> → <how to avoid or catch it>

---

## Output Template

<The literal, formatted template for the deliverable this skill produces. The AI should fill this in and present it to the user. Every strong skill has one.>

```markdown
# <Deliverable Title>

**Date:** YYYY-MM-DD
**Status:** <Draft | Review | Approved>

## <Section 1>
<What goes here>

## <Section 2>
<What goes here>

## <Summary / Verdict>
<What goes here>
```

<Not every skill has a heavy output template — for skills that produce code rather than documents, describe the expected file structure or output format instead.>

---

## Downstream Handoff

<Which skill or action comes next in the workflow. Be explicit — name the slash command and what context to pass forward.>

**After this skill:**
- Run `/<next-skill>` to <what it does with this skill's output>
- Pass the <artifact name> as context to the downstream skill

**When to skip the handoff:**
- <Condition when the user can stop here>

---

## Definition of Done

<A checklist for the OUTPUT of using this skill — i.e., what the user's deliverable should satisfy before it's considered finished. Minimum 8 concrete, verifiable items.>

- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
- [ ] <concrete, verifiable condition>
