# openskills × Any AI Agent

Every skill in openskills is plain Markdown. If your AI agent can read a system prompt, it can use any skill.

## The universal pattern

```
1. Open the SKILL.md for the skill you want
2. Paste its contents as your system prompt (or into your agent's context)
3. Send your task
```

That's it. No installation required.

## Using a skill as a system prompt

Example: using `code-reviewer` with any LLM API:

```python
import anthropic

with open("openskills/code-reviewer/SKILL.md") as f:
    skill = f.read()

client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=4096,
    system=skill,                          # <-- skill becomes system prompt
    messages=[{
        "role": "user",
        "content": f"Review this code:\n\n{my_code}"
    }]
)
```

## Chaining skills (the sprint workflow)

Skills are designed to chain. Output from one skill feeds into the next:

```
office-hours output → plan-ceo-review input
plan-ceo-review output → spec-author input
spec-author output → backend-dev / api-design input
implementation → code-reviewer input
reviewed code → qa-engineer input
qa pass → release-engineer input
post-deploy → sre-canary input
weekly → retro-engineer input
```

## Using with CLAUDE.md / agent config files

Add skill references to your `CLAUDE.md` or equivalent config:

```markdown
# Project AI Instructions

When asked to review code, apply the code-reviewer skill from openskills.
When asked to debug, apply the debugger skill.
When asked to write tests, apply the test-writer skill.
When committing, apply the commit-message skill.

Skill files are at: ./openskills/<skill-name>/SKILL.md
```

## GitHub Copilot (`.github/copilot-instructions.md`)

```markdown
## Code Review
When reviewing code, follow the openskills code-reviewer methodology:
apply the 6-pass review (context → logic → security → tests → maintainability → integration),
classify findings as Blocker/Major/Minor/Suggestion, and never block on style preference.

## Debugging
When fixing bugs, follow the openskills debugger Iron Law:
investigate root cause before writing any fix. Use 4-phase workflow.

## Commits
Follow Conventional Commits format: type(scope): subject
Types: feat, fix, docs, refactor, test, chore, perf, ci, build
```

## OpenAI Assistants API

```python
from openai import OpenAI

with open("openskills/spec-author/SKILL.md") as f:
    spec_skill = f.read()

client = OpenAI()
assistant = client.beta.assistants.create(
    name="Spec Author",
    instructions=spec_skill,
    model="gpt-4o"
)
```

## Tips for best results

- **Be explicit about which skill to use:** "Act as the code-reviewer skill" or "Use the debugger skill workflow"
- **One skill per context:** Don't combine multiple skill bodies in one system prompt — they compete
- **Load the skill fresh per session:** Skills work best at the start of a context, not appended mid-conversation
- **Use the Definition of Done:** Every skill has a DoD checklist — ask the AI to verify each item before finishing
