# openskills × Claude Code

Claude Code reads custom slash commands from `~/.claude/commands/` (global) or `.claude/commands/` (project-level). Each skill becomes a `/skill-name` command.

## Install (global — works in every project)

```bash
git clone https://github.com/YOUR_USERNAME/openskills ~/.openskills
cd ~/.openskills && ./install.sh --agent=claude
```

## Install (project-level — only in this repo)

```bash
mkdir -p .claude/commands
# Symlink only the skills you want for this project
ln -sf ~/.openskills/code-reviewer .claude/commands/code-reviewer
ln -sf ~/.openskills/spec-author   .claude/commands/spec-author
ln -sf ~/.openskills/qa-engineer   .claude/commands/qa-engineer
```

## Usage

Once installed, use any skill as a slash command in Claude Code:

```
/office-hours     — validate your idea before building
/spec-author      — turn a rough idea into a precise spec
/code-reviewer    — review staged changes before committing
/qa-engineer      — find and fix bugs before shipping
/release-engineer — full ship workflow in one command
/debugger         — systematic root-cause investigation
/retro-engineer   — weekly engineering retrospective
```

## How it works

Claude Code reads `SKILL.md` from the command directory. The frontmatter `description` field is what Claude shows in the `/` autocomplete menu. The body becomes the injected system context when the command runs.

## Recommended global skills for Claude Code

```bash
# The full sprint workflow
ln -sf ~/.openskills/office-hours      ~/.claude/commands/office-hours
ln -sf ~/.openskills/plan-ceo-review   ~/.claude/commands/plan-ceo-review
ln -sf ~/.openskills/spec-author       ~/.claude/commands/spec-author
ln -sf ~/.openskills/code-reviewer     ~/.claude/commands/code-reviewer
ln -sf ~/.openskills/qa-engineer       ~/.claude/commands/qa-engineer
ln -sf ~/.openskills/debugger          ~/.claude/commands/debugger
ln -sf ~/.openskills/release-engineer  ~/.claude/commands/release-engineer
ln -sf ~/.openskills/sre-canary        ~/.claude/commands/sre-canary
ln -sf ~/.openskills/retro-engineer    ~/.claude/commands/retro-engineer
```
