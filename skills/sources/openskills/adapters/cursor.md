# openskills × Cursor

Cursor reads rules from `.cursor/rules/*.mdc` files. Each `.mdc` file is a Markdown document with YAML frontmatter that tells Cursor when to apply the rule.

## Install (project-level)

```bash
cd your-project
git clone https://github.com/YOUR_USERNAME/openskills /tmp/openskills
cd /tmp/openskills && ./install.sh --agent=cursor
```

The installer generates `.cursor/rules/<skill-name>.mdc` files in your current directory.

## Manual install for a single skill

Create `.cursor/rules/code-reviewer.mdc`:

```markdown
---
description: Review code changes for bugs, security issues, and style before handing them to the user. Use after writing or modifying code, or when the user asks for a review.
---

# Code Review

[paste SKILL.md body here]
```

## How Cursor uses skills

Cursor's AI reads `.mdc` rules and applies them based on the `description` field. When your request matches the description, Cursor activates that rule automatically — no slash command needed.

## Recommended rules for Cursor

| Rule file | Trigger |
|-----------|---------|
| `code-reviewer.mdc` | After any code change |
| `spec-author.mdc` | When describing a new feature |
| `debugger.mdc` | When reporting a bug or error |
| `test-writer.mdc` | When asking to add tests |
| `commit-message.mdc` | When committing |
| `technical-writer.mdc` | When writing docs |

## Global vs project rules

- **Project rules** (`.cursor/rules/`): apply only in this repo — recommended for team skills
- **Global rules** (`~/.cursor/rules/`): apply everywhere — recommended for personal workflow skills
