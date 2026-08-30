# openskills × Windsurf

Windsurf Cascade reads `.windsurfrules` from your project root. openskills appends skill descriptions as structured rules the Cascade AI follows throughout your session.

## Install

```bash
cd your-project
git clone https://github.com/YOUR_USERNAME/openskills /tmp/openskills
cd /tmp/openskills && ./install.sh --agent=windsurf
```

This appends all skill descriptions to `.windsurfrules` in your current directory.

## Manual install for specific skills

Add to your `.windsurfrules`:

```
## code-reviewer
Review code changes for bugs, security issues, and performance before shipping.
Apply the 6-pass review methodology: context, logic, security, tests, maintainability, integration.
Classify every finding as Blocker / Major / Minor / Suggestion / Note.
Never block a PR on style preference alone.

## debugger
When asked to fix a bug or error, always investigate the root cause before writing any fix.
Iron Law: no fix without root cause. Use the 4-phase workflow: Investigate → Analyze → Hypothesize → Implement.
Stop after 3 failed fix attempts and escalate with a root cause document.
```

## Full skill reference

After running the installer, your `.windsurfrules` will contain descriptions for all 30 skills. Windsurf Cascade uses these to apply the right expertise automatically.

## Uninstall

```bash
./install.sh --agent=windsurf --uninstall
# Then manually remove the openskills block from .windsurfrules
```
