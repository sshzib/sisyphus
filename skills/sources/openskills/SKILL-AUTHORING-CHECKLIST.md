# Skill-Authoring Checklist

Use this when writing or reviewing a SKILL.md file itself — not the user's deliverable.

This checklist is for **skill authors**, not for the AI agent executing the skill. It should NOT be included inside a published SKILL.md.

---

## Frontmatter

- [ ] `name` is kebab-case and matches the folder name
- [ ] `description` states both *what* it covers and *when* to trigger, in third person
- [ ] `description` includes concrete trigger words a user would actually type — tool names, casual phrasings, symptom-based phrasing ("why is X slow") — not just the formal domain term
- [ ] `description` errs toward over-triggering rather than under-triggering; a skill that doesn't fire is worse than one that fires slightly too often

---

## Content Quality

- [ ] Opening paragraph sets the operating stance / persona — not just "this skill does X"
- [ ] Every rule has a stated reason, not just an instruction — "why" is what lets the reasoning transfer to situations the skill didn't explicitly anticipate
- [ ] Concrete examples are complete enough to actually use, not toy snippets that skip the hard part
- [ ] Comparison tables exist wherever the domain has a real multi-way decision, with a "use when" column — not just a feature list
- [ ] An edge-cases / common-failure-modes section exists — the gap between "correct" and "production-grade" is usually here
- [ ] No section just restates general knowledge the model already has with no domain-specific angle — cut it
- [ ] Security/safety-relevant defaults are stated explicitly where the domain has them, not left implicit

---

## Structure

- [ ] Starts with frontmatter → opening paragraph → (optional trigger section) → Step 0 → Principles → Execution Workflow → Steps → Edge Cases → Output Template → Downstream Handoff → Definition of Done
- [ ] The execution workflow defines a numbered sequence of phases — not just a bag of topics
- [ ] An output template exists showing the literal format of the skill's deliverable
- [ ] A downstream handoff section names the next skill or action in the workflow
- [ ] The Definition of Done has ≥ 8 concrete, verifiable checklist items
- [ ] File is organized so a reader can jump to the relevant section without reading top to bottom
- [ ] 200–600 lines preferred; above 600 is acceptable for complex domains but consider splitting deep-dives into a `references/` subfolder and linking to them

---

## Validation Before Shipping

- [ ] Tested against a few realistic prompts that should trigger it — confirm it actually fires
- [ ] Tested against a few near-miss prompts that should NOT trigger it — confirm it doesn't over-fire
- [ ] Spot-checked for gaps: is there a common real-world request in this domain the skill has no section for? (Full omissions matter more than thin sections)
- [ ] The skill has been tested in at least one real agent session (per CONTRIBUTING.md)
- [ ] Minimum 200 lines total (per CONTRIBUTING.md)
