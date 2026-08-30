<div align="center">

# 🧠 OpenSkills

### 49 production-grade AI engineering skills for Markdown-aware agents.

[github.com/CODE-SAURABH/OpenSkills](https://github.com/CODE-SAURABH/OpenSkills)

[![Skills](https://img.shields.io/badge/skills-49-6366f1?style=flat-square)](./README.md#skills)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Format](https://img.shields.io/badge/format-SKILL.md-0ea5e9?style=flat-square)](#how-skills-work)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-f59e0b?style=flat-square)](./CONTRIBUTING.md)

</div>

---

**openskills** is an open-source collection of 49 production-grade AI agent skills. The skills are plain Markdown and can be used with any agent that lets you load instructions.

Each skill is a single `SKILL.md` file that gives your AI agent **opinionated, expert-level instructions** for a specific engineering role — from system design and backend dev to security, QA, and retrospectives. Your agent must be configured to load the file or rule; copying a file alone does not guarantee that every product will activate it.

> Start with one skill, confirm that your agent loads it, then add the rest you need.

---

## Table of Contents

- [Why OpenSkills?](#why-openskills)
- [Quick Install](#quick-install)
- [The Sprint Flow](#the-sprint-flow)
- [Skills](#skills)
- [Agent Compatibility](#agent-compatibility)
- [How Skills Work](#how-skills-work)
- [Contributing](#contributing)
- [License](#license)

---

## Why OpenSkills?

Most AI coding assistants are generalists. They write code, but they don't ship like a senior engineer. They don't ask the hard questions before building, they don't catch security holes, they don't enforce architecture decisions, and they don't know when to stop.

**OpenSkills fixes this.** Each skill turns your agent into a domain expert with:

- ✅ **Explicit trigger conditions** — the agent knows *when* to activate
- ✅ **Numbered execution workflows** — step-by-step, not a pile of tips
- ✅ **Output templates** — structured, consistent deliverables every time
- ✅ **Definition of Done checklists** — verifiable completion criteria
- ✅ **Edge cases and anti-patterns** — the things juniors miss

---

## Quick Install

### Claude Code

Clone this repository, then copy the individual skill folder you want into Claude Code's skills directory. Do not copy the entire repository: each installed skill should contain its own `SKILL.md` file.

```bash
git clone https://github.com/CODE-SAURABH/OpenSkills.git openskills
cd openskills
```

For example, install the `code-reviewer` skill:

```bash
mkdir -p ~/.claude/skills
cp -r code-reviewer ~/.claude/skills/code-reviewer
```

To install another skill, substitute its directory name:

```bash
cp -r <skill-name> ~/.claude/skills/<skill-name>
```

Start a new Claude Code session after copying the skill. It will then be available for use.

### Codex

Codex discovers skills in `.agents/skills/` within a repository and in `~/.agents/skills/` for your personal, cross-project skills. Copy a selected OpenSkills folder to one of those locations.

```bash
# Install for every project you use with Codex
mkdir -p ~/.agents/skills
cp -r code-reviewer ~/.agents/skills/code-reviewer

# Or, from a target project's root, install for that project only
mkdir -p .agents/skills
cp -r /path/to/openskills/code-reviewer .agents/skills/code-reviewer
```

Codex detects skill changes automatically. Mention the skill explicitly with `$code-reviewer` when you want to ensure it is used, or let Codex choose it when the task matches the skill description. See the [Codex skills documentation](https://developers.openai.com/codex/skills/) for details.

### Antigravity

Antigravity uses the same workspace skill layout: `<workspace-root>/.agents/skills/<skill-name>/SKILL.md`. From the root of the workspace you opened in Antigravity, copy the skill you want:

```bash
mkdir -p .agents/skills
cp -r /path/to/openskills/code-reviewer .agents/skills/code-reviewer
```

Start a new conversation after adding the skill. For personal skills shared across Antigravity workspaces, use `~/.gemini/config/skills/<skill-name>/` instead. See the [Antigravity skills documentation](https://antigravity.google/docs/skills).

### Custom agents

Use the same folder structure when your agent supports the Agent Skills format:

```text
<agent-config-root>/skills/
└── code-reviewer/
    └── SKILL.md
```

Configure the agent to list the available `SKILL.md` files at session start and load the selected file when its `description` matches the task. If your agent does not support skill discovery, read the chosen `SKILL.md` and pass its contents as the agent's system instructions or task context.

### Other agents

For Cursor, Windsurf, GitHub Copilot, Kiro, Codex, and other agents, use that product's documented instruction mechanism and add only the skills that fit your workflow. A safe universal approach is to provide the contents of `<skill-name>/SKILL.md` as agent instructions or context. Do not concatenate all 49 skills into one instruction file: they can conflict and consume unnecessary context.

---

## The Sprint Flow

OpenSkills maps to a complete engineering sprint. Use the right skill at each phase and hand off deliberately.

| Phase | Skill(s) | What Happens |
|---|---|---|
| 💡 **Think** | `office-hours` · `plan-ceo-review` · `autoplan` | Stress-test the idea. CEO validates scope. AutoPlan chains all reviews automatically. |
| 📋 **Plan** | `spec-author` · `system-design` · `product-engineer` · `plan-eng-review` · `plan-design-review` · `doc-coauthoring` | Turn validated ideas into unambiguous specs and architecture blueprints. |
| 🏗️ **Build** | `backend-dev` · `frontend-design` · `api-design` · `database-architect` · `ai-engineer` · `data-engineer` · `mcp-builder` · `devops-platform` · `security-engineer` · `performance-optimizer` · `prompt-engineer` · `design-explorer` · `brand-guidelines` · `theme-factory` · `pptx` · `pdf` · `xlsx` · `safety-guardrails` | Full-stack implementation across every layer. |
| 🔍 **Review** | `code-reviewer` · `devex-engineer` · `research-agent` | Catch bugs, security holes, and regressions before they ship. |
| 🧪 **Test** | `test-writer` · `qa-engineer` · `debugger` · `benchmark` · `webapp-testing` | Write tests, validate behaviour, find what's hiding. |
| 🚀 **Ship** | `technical-writer` · `commit-message` · `release-engineer` · `land-and-deploy` · `sre-canary` · `internal-comms` | Document, commit, release, monitor, and communicate. |
| 🔄 **Reflect** | `retro-engineer` · `agent-memory` · `skill-creator` | Learn from what happened. Improve the system itself. |
| 🌐 **Deploy** | `forward-deployment-engineer` | Customer-site deployment and field technical delivery. |

---

## Skills

All 49 skills, ready to use.

| Skill | Role | Description | Phase |
|---|---|---|---|
| [`java-development`](./java-development/SKILL.md) | Java Engineer | Production Java services, APIs, persistence, concurrency, resilience, and JVM-safe delivery. | Build |
| [`python-development`](./python-development/SKILL.md) | Python Engineer | Production Python applications, services, typing, asyncio, testing, and reliable I/O. | Build |
| [`react-development`](./react-development/SKILL.md) | React Engineer | Accessible production React interfaces, state, data flows, rendering, and testing. | Build |
| [`typescript-development`](./typescript-development/SKILL.md) | TypeScript Engineer | Type-safe TypeScript applications, Node.js services, runtime validation, and packaging. | Build |
| [`agent-memory`](./agent-memory/SKILL.md) | Memory Manager | Persists learnings across sessions, runs browser-based QA with real Chromium, and coordinates multi-agent workflows. | Reflect |
| [`ai-engineer`](./ai-engineer/SKILL.md) | AI/ML Engineer | LLM integration, RAG pipelines, embedding stores, fine-tuning, and AI evaluation frameworks. | Build |
| [`api-design`](./api-design/SKILL.md) | API Designer | Design production-grade REST, GraphQL, gRPC, and WebSocket APIs with versioning, error contracts, and OpenAPI schemas. | Build |
| [`autoplan`](./autoplan/SKILL.md) | Review Orchestrator | Chains CEO → Design → Eng → DX reviews automatically. Auto-decides resolvable questions; surfaces only human taste-gates. | Think |
| [`backend-dev`](./backend-dev/SKILL.md) | Backend Engineer | Production-grade server-side code across any language or framework — auth, business logic, data access, and more. | Build |
| [`benchmark`](./benchmark/SKILL.md) | Benchmark Auditor | Baseline and compare page load times, Core Web Vitals, bundle sizes, and API response times. | Test |
| [`brand-guidelines`](./brand-guidelines/SKILL.md) | Brand Compliance | Apply brand voice, tone, colors, typography, and visual style consistently across any artifact. | Build |
| [`code-reviewer`](./code-reviewer/SKILL.md) | Code Reviewer | 6-pass code review for bugs, security, performance, and maintainability before shipping. | Review |
| [`commit-message`](./commit-message/SKILL.md) | Commit Author | Conventional Commit messages and PR descriptions from staged changes or diffs. | Ship |
| [`data-engineer`](./data-engineer/SKILL.md) | Data Engineer | ETL/ELT pipelines, streaming architectures, data quality gates, and analytical data modelling. | Build |
| [`database-architect`](./database-architect/SKILL.md) | Data Modeller | Schema design, indexing strategy, migration plans, and query optimisation across SQL and NoSQL. | Build |
| [`debugger`](./debugger/SKILL.md) | Debugger | Systematic root-cause debugging. Iron law: no fixes without investigation first. 4-phase workflow. | Review |
| [`design-explorer`](./design-explorer/SKILL.md) | Design Strategist | Generative design exploration — multiple directions before committing, with clear trade-off framing. | Build |
| [`devex-engineer`](./devex-engineer/SKILL.md) | DX Engineer | Developer experience audit — TTHW measurement, friction tracing, competitor benchmarking. | Review |
| [`devops-platform`](./devops-platform/SKILL.md) | DevOps Engineer | CI/CD pipelines, containerisation, IaC, cloud architecture, and deployment automation. | Build |
| [`doc-coauthoring`](./doc-coauthoring/SKILL.md) | Doc Co-Author | Structured co-authoring for PRDs, design docs, RFCs, and decision docs through three guided stages. | Plan |
| [`forward-deployment-engineer`](./forward-deployment-engineer/SKILL.md) | Field Engineer | Enterprise deployment support — integration reviews, customer onboarding, and field technical guidance. | Deploy |
| [`frontend-design`](./frontend-design/SKILL.md) | Frontend Designer | Distinctive, intentional UI — typography, layout, and design that doesn't look like a template. | Build |
| [`internal-comms`](./internal-comms/SKILL.md) | Comms Writer | Incident reports, post-mortems, launch announcements, 3P updates, and leadership briefings. | Ship |
| [`land-and-deploy`](./land-and-deploy/SKILL.md) | Deploy Orchestrator | Merges the PR, monitors CI/CD, waits for deploy, verifies production health, and confirms the feature is live. | Ship |
| [`mcp-builder`](./mcp-builder/SKILL.md) | MCP Server Builder | Build production-grade MCP servers that connect AI agents to external APIs, databases, and services. | Build |
| [`office-hours`](./office-hours/SKILL.md) | Idea Validator | YC-style pre-code interrogation. Stress-tests assumptions, produces a design doc, prevents building the wrong thing. | Think |
| [`pdf`](./pdf/SKILL.md) | PDF Engineer | Read, extract, create, merge, split, and manipulate PDF files — including OCR and form filling. | Build |
| [`performance-optimizer`](./performance-optimizer/SKILL.md) | Performance Engineer | Profiling, bottleneck identification, query optimisation, caching strategy, and load test design. | Build |
| [`plan-ceo-review`](./plan-ceo-review/SKILL.md) | Strategic Reviewer | Pressure-tests scope, value, and prioritisation decisions before any architecture is committed. | Think |
| [`plan-design-review`](./plan-design-review/SKILL.md) | UI/UX Reviewer | Rates each design dimension 0–10, explains what a 10 looks like, and detects AI slop before build. | Plan |
| [`plan-eng-review`](./plan-eng-review/SKILL.md) | Eng Planning Reviewer | Stress-tests technical approach, surfaces hidden assumptions, and locks implementation before coding. | Plan |
| [`pptx`](./pptx/SKILL.md) | Presentation Designer | Create, edit, read, and design production-quality PowerPoint slide decks (.pptx). | Build |
| [`product-engineer`](./product-engineer/SKILL.md) | Product Builder | End-to-end feature implementation with a product mindset — builds what users need, not just what was spec'd. | Plan |
| [`prompt-engineer`](./prompt-engineer/SKILL.md) | Prompt Engineer | Design, evaluate, and refine prompts for LLMs — system prompts, few-shot examples, and eval harnesses. | Build |
| [`qa-engineer`](./qa-engineer/SKILL.md) | QA Engineer | Live QA testing — finds bugs, fixes with atomic commits, re-verifies. 3 depth modes. | Test |
| [`release-engineer`](./release-engineer/SKILL.md) | Release Engineer | Full ship workflow: sync → lint → test → commit → PR → merge → deploy → verify. | Ship |
| [`research-agent`](./research-agent/SKILL.md) | Research Analyst | Deep-dive investigation of technical topics — produces structured research reports with citations. | Review |
| [`retro-engineer`](./retro-engineer/SKILL.md) | Retro Facilitator | Sprint and weekly retrospectives. Shipping streaks, test health trends, global cross-project mode. | Reflect |
| [`safety-guardrails`](./safety-guardrails/SKILL.md) | Safety Core | Warns before destructive commands, locks edits to safe directories, prevents production accidents. | Build |
| [`security-engineer`](./security-engineer/SKILL.md) | Security Engineer | OWASP Top 10, threat modeling, JWT, RBAC, OAuth, and application security. | Build |
| [`skill-creator`](./skill-creator/SKILL.md) | Meta-Skill Engine | Build new skills from scratch, refactor existing ones, and test skill quality. The skill that builds all other skills. | Reflect |
| [`spec-author`](./spec-author/SKILL.md) | Requirements Author | Turns validated ideas into unambiguous, testable requirements structured for any ALM tool. | Plan |
| [`sre-canary`](./sre-canary/SKILL.md) | SRE / On-Call | Post-deploy canary monitoring. Watches for errors, regressions, and SLO violations after deploy. | Ship |
| [`system-design`](./system-design/SKILL.md) | Systems Architect | Scalable, reliable distributed systems — microservices, event-driven architecture, and infrastructure design. | Plan |
| [`technical-writer`](./technical-writer/SKILL.md) | Technical Writer | READMEs, API docs, runbooks, ADRs, changelogs, and onboarding guides using the Diataxis framework. | Ship |
| [`test-writer`](./test-writer/SKILL.md) | Test Author | Generate unit, integration, E2E, and contract tests for any language or framework. | Test |
| [`theme-factory`](./theme-factory/SKILL.md) | Theme Designer | Generate and apply complete design themes — palettes, typography, and spacing systems — to any artifact. | Build |
| [`webapp-testing`](./webapp-testing/SKILL.md) | E2E Tester | Automated end-to-end web application testing using Playwright. | Test |
| [`xlsx`](./xlsx/SKILL.md) | Excel Engineer | Create, read, edit, and analyse Excel spreadsheets — formulas, financial models, and bulk data. | Build |

---

## Agent Compatibility

| Agent | Install Method | Skill Format | Status |
|---|---|---|---|
| **Claude Code** | Copy one skill folder to `~/.claude/skills/` | Native skills | Documented |
| **Codex** | Copy one skill folder to `.agents/skills/` or `~/.agents/skills/` | Native skills | Documented |
| **Antigravity** | Copy one skill folder to `.agents/skills/` | Native skills | Documented |
| **Cursor / Windsurf** | Use the product's rule mechanism | Project rules | Manual integration |
| **Generic SKILL.md agent** | Load a selected `SKILL.md` file | Agent instructions | Manual integration |
| **GitHub Copilot / Kiro / other agents** | Use the product's instruction mechanism | Varies by product | Manual integration |

---

## How Skills Work

Every skill is a single `SKILL.md` file inside a named directory. The file has two parts: a YAML frontmatter block that tells the agent **when** to load the skill, and a body that tells the agent **exactly how** to execute it.

```
openskills/
├── office-hours/
│   └── SKILL.md
├── backend-dev/
│   └── SKILL.md
├── code-reviewer/
│   └── SKILL.md
└── ...
```

### SKILL.md Format

```markdown
---
name: your-skill-name
description: >
  One or two sentences describing what this skill does AND when to use it.
  Make trigger conditions explicit: "Use when the user asks to X, Y, or Z."
---

# Skill Title

## When to Invoke This Skill
[Explicit trigger conditions — phrasing the user might say]

## Execution Workflow

### Step 1: Do This First
...

### Step 2: Then Do This
...

## Output Template
[Structured output the agent produces]

## Definition of Done
- [ ] Criterion 1
- [ ] Criterion 2
```

### What Makes a Good Skill

| Property | Description |
|---|---|
| **Explicit triggers** | The `description` field names exact conditions that activate this skill |
| **Opinionated steps** | The body is a numbered procedure, not a collection of tips |
| **Downstream handoff** | Each skill tells the agent what skill to invoke next |
| **Verifiable output** | The Definition of Done makes completion objective, not subjective |

---

## Contributing

Contributions are welcome. Before opening a PR, please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) in full.

### Adding a New Skill

1. Copy [`SKILL-TEMPLATE.md`](./SKILL-TEMPLATE.md) into a new directory: `your-skill-name/SKILL.md`
2. Fill in every section — no placeholder text
3. Self-review against [`SKILL-AUTHORING-CHECKLIST.md`](./SKILL-AUTHORING-CHECKLIST.md)
4. Add your skill to [`skills.json`](./skills.json) with the correct `category`, `phase`, and `tags`
5. Add a row to the **Skills** table in this README
6. Open a PR — the checklist will be reviewed

### Quality Bar

Every skill must pass these gates before merge:

- [ ] YAML frontmatter `name` and `description` are present and accurate
- [ ] `description` contains explicit trigger phrases the agent can match
- [ ] Numbered `## Execution Workflow` section is present
- [ ] `## Definition of Done` checklist is present and verifiable
- [ ] No placeholder text or TODO comments remain
- [ ] Skill is 200–600 lines (longer = not focused enough)

---

## Project Structure

```
openskills/
├── README.md                           ← You are here
├── CONTRIBUTING.md                     ← Contribution guidelines
├── SKILL-TEMPLATE.md                   ← Template for new skills
├── SKILL-AUTHORING-CHECKLIST.md        ← Quality checklist for skill authors
├── skills.json                         ← Machine-readable skill manifest
├── install.sh                          ← One-command installer
├── agent-memory/SKILL.md               ← Session memory, browser QA, multi-agent
├── ai-engineer/SKILL.md                ← LLM integration, RAG, embeddings, evals
├── api-design/SKILL.md                 ← REST/GraphQL API design with OpenAPI
├── autoplan/SKILL.md                   ← Automated full planning review pipeline
├── backend-dev/SKILL.md                ← Production-grade server-side development
├── benchmark/SKILL.md                  ← Performance baseline and comparison
├── brand-guidelines/SKILL.md           ← Brand voice, tone, and visual consistency
├── code-reviewer/SKILL.md              ← Pre-merge 6-pass code review
├── commit-message/SKILL.md             ← Conventional commit messages
├── data-engineer/SKILL.md              ← ETL, streaming, data quality
├── database-architect/SKILL.md         ← Schema design, indexing, migrations
├── debugger/SKILL.md                   ← Systematic bug isolation and fix
├── design-explorer/SKILL.md            ← Generative design direction exploration
├── devex-engineer/SKILL.md             ← Developer experience improvements
├── devops-platform/SKILL.md            ← CI/CD, IaC, containers, cloud
├── doc-coauthoring/SKILL.md            ← Co-author PRDs, RFCs, and design docs
├── forward-deployment-engineer/SKILL.md ← Enterprise field deployment
├── frontend-design/SKILL.md            ← Distinctive, intentional UI design
├── internal-comms/SKILL.md             ← Incident reports, announcements, updates
├── land-and-deploy/SKILL.md            ← Merge, deploy, and verify production
├── mcp-builder/SKILL.md                ← Build MCP servers for AI agents
├── office-hours/SKILL.md               ← Pre-code idea validation
├── pdf/SKILL.md                        ← PDF read, extract, create, manipulate
├── performance-optimizer/SKILL.md      ← Profiling, caching, query optimisation
├── plan-ceo-review/SKILL.md            ← Strategic scope and value review
├── plan-design-review/SKILL.md         ← UI/UX plan rating and improvement
├── plan-eng-review/SKILL.md            ← Engineering plan stress-test
├── pptx/SKILL.md                       ← PowerPoint deck creation and editing
├── product-engineer/SKILL.md           ← End-to-end feature implementation
├── prompt-engineer/SKILL.md            ← LLM prompt design and evaluation
├── qa-engineer/SKILL.md                ← Live QA testing with browser
├── release-engineer/SKILL.md           ← Release packaging and deployment
├── research-agent/SKILL.md             ← Deep technical research
├── retro-engineer/SKILL.md             ← Sprint retrospectives
├── safety-guardrails/SKILL.md          ← Guardrails for destructive commands
├── security-engineer/SKILL.md          ← AppSec, OWASP, threat modelling
├── skill-creator/SKILL.md              ← Meta-skill: build and improve skills
├── spec-author/SKILL.md                ← Requirements writing
├── sre-canary/SKILL.md                 ← Canary deployment monitoring
├── system-design/SKILL.md              ← Systems architecture and MBSE
├── technical-writer/SKILL.md           ← Docs, runbooks, ADRs
├── test-writer/SKILL.md                ← Unit, integration, and E2E tests
├── theme-factory/SKILL.md              ← Design themes and style systems
├── webapp-testing/SKILL.md             ← Playwright E2E browser testing
└── xlsx/SKILL.md                       ← Excel spreadsheet engineering
```

---

## License

MIT © [CODE-SAURABH](https://github.com/CODE-SAURABH/OpenSkills)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

<div align="center">

**Built for engineers who want their AI to meet their bar — not lower it.**

[🤝 Contribute a skill](./CONTRIBUTING.md)

</div>
