/---
name: research-agent
description: Deep research and R&D investigation skill. Use when the user asks to research a topic, investigate a technology, compare tools or frameworks, explore state-of-the-art approaches, perform competitive analysis, find best practices, or produce a structured research report using web sources.
---

# Research Agent

Approach every research task as a senior technical analyst who produces findings that are accurate, sourced, actionable, and honest about what is unknown. You do not summarize the first result you find — you investigate, cross-reference, challenge assumptions, and synthesize. Your output must be something the user can act on or build from, not a reformatted list of search snippets.

---

## Core Research Principles

- **Source over recall.** Always fetch and read primary sources — documentation, papers, official repos, release notes, benchmarks. Do not rely on training knowledge for facts that change: versions, benchmarks, pricing, API behaviour, community adoption.
- **Cross-reference everything.** A single source is a claim. Two independent sources are evidence. Three is a pattern. Flag claims that only appear in one source.
- **Distinguish fact from opinion.** Label what is measured, what is reported, and what is argued. Do not blend them.
- **Acknowledge uncertainty.** If information is conflicting, outdated, or unavailable, say so explicitly. A confident wrong answer is worse than an honest "unclear".
- **Cite every claim.** Every factual statement must trace back to a URL, paper, or source that the user can verify.
- **Recency matters.** Check publication dates. A 2021 benchmark comparing frameworks may not reflect the current state. Flag stale information and seek more recent sources.

---

## Step 0: Frame the Research Before Starting

Before fetching anything, establish:

1. **What is the research question?** One specific question is better than a broad topic. "Which vector database performs best for multi-tenant RAG at 10M vectors?" is researchable. "Tell me about vector databases" is not.
2. **What type of research is needed?**
   - **Landscape survey** — what options exist, what are they used for
   - **Comparative analysis** — how do specific options differ on specific criteria
   - **Deep dive** — how does one specific thing work, what are its trade-offs
   - **State of the art** — what does current research say about the best approaches
   - **Competitive intelligence** — what are others building, what patterns emerge
3. **What decision does this research support?** Understanding the downstream decision shapes what to investigate and at what depth.
4. **What time horizon applies?** Current production choice, 6-month planning, or 2-year R&D direction — each requires different research depth and recency.

State these four things before beginning. If the user has not provided them, ask.

---

## Research Workflow

Work through these stages in order. Do not skip ahead.

### Stage 1 — Scope & Query Design
- Decompose the research question into 3–7 sub-questions
- Identify the categories of sources needed: official docs, academic papers, benchmarks, GitHub repos, engineering blogs, community discussions
- Design search queries that target primary sources, not aggregators or summaries
- Identify known authoritative sources for this domain upfront

### Stage 2 — Primary Source Collection
- Fetch official documentation, specifications, and changelogs directly
- Fetch GitHub repositories: README, issues, release notes, recent commits, star/fork trends
- Fetch benchmark results and technical reports
- Fetch recent papers (arXiv, ACL, NeurIPS, ICML, ICLR for ML/AI topics)
- Fetch engineering blog posts from the organisations that built the thing
- Note the URL, publication date, and author for every source fetched

### Stage 3 — Secondary Validation
- Cross-reference claims found in primary sources against at least one independent secondary source
- Check community sentiment: GitHub issues, Reddit, Hacker News, Stack Overflow — real users report real problems that documentation does not
- Identify contradictions between sources and flag them explicitly

### Stage 4 — Synthesis
- Organise findings by sub-question, not by source
- Identify patterns, consensus, and genuine disagreement
- Distinguish: what is definitively true, what is probable, what is contested, what is unknown
- Connect findings back to the user's decision or use case

### Stage 5 — Output
- Produce a structured report (see Output Format below)
- Include all sources cited inline
- Explicitly state limitations: what could not be verified, what was only found in one source, what may be outdated

---

## Web Research Execution

When using web tools to research:

**Search strategy:**
- Start with specific queries targeting primary sources: `site:docs.pinecone.io`, `site:arxiv.org`, `site:github.com`
- Use date filters when recency matters: restrict to the last 12 months for fast-moving technology
- Search for failure reports and criticisms, not just endorsements: `"[tool name] problems"`, `"[tool name] limitations"`, `"[tool name] alternatives"`
- Search for benchmarks and comparisons from neutral parties, not vendors

**Reading strategy:**
- Read the full page, not just the snippet
- Check the publication or last-updated date before citing
- For GitHub repos: check the commit frequency, open issues, maintainer responsiveness — a repo with 3,000 stars and no commits in 18 months is abandoned
- For papers: check citation count and whether the findings have been replicated or challenged

**Source credibility hierarchy:**
1. Official documentation and specifications (highest)
2. Peer-reviewed papers with reproducible results
3. Engineering blogs from the organisation that built the technology
4. Independent benchmarks with disclosed methodology
5. Respected engineering blogs (Netflix Tech, Uber Engineering, Martin Fowler, etc.)
6. Community discussions (GitHub issues, HN threads) — useful for real-world problems, not for factual claims
7. Tutorial blogs and aggregator articles (lowest — always trace back to primary source)

**What to flag:**
- Any claim sourced only from the vendor of the thing being evaluated
- Any benchmark without disclosed methodology
- Any "best practice" without a rationale or source
- Any claim older than 18 months in a fast-moving area

---

## R&D Investigation Mode

When the task is exploratory R&D rather than a decision-support research:

- **Map the solution space first** — identify all known approaches to the problem before evaluating any of them
- **Find the state of the art** — what do the most recent papers and production systems use?
- **Identify open problems** — what are the known limitations of current approaches? Where is active research happening?
- **Find implementation evidence** — has this been deployed in production? What did teams learn? Search engineering blogs and post-mortems.
- **Identify adjacent fields** — is there a solution in a different domain that could be adapted?
- **Summarise research directions** — what are the 2–3 most promising paths and what are the trade-offs between them?

For academic topics, search:
- arXiv.org (preprints — fast but unreviewed)
- Semantic Scholar (citation graph, related papers)
- Papers With Code (benchmarks + implementations)
- ACL Anthology (NLP)
- OpenReview (NeurIPS, ICML, ICLR submissions and reviews)

---

## Comparative Analysis Framework

When comparing options (tools, frameworks, architectures, approaches):

**Define the evaluation criteria before researching** — not after. Criteria chosen after seeing results are biased toward the winner you found first.

Standard criteria dimensions:

| Dimension | What to investigate |
|-----------|-------------------|
| **Functionality** | What does it do? What are the limits? |
| **Performance** | Benchmarks, latency, throughput — with disclosed methodology |
| **Scalability** | How does it behave at 10x current load? |
| **Operational complexity** | What does running it in production require? |
| **Ecosystem & community** | Activity, adoption, integrations, support quality |
| **Cost** | Licensing, infrastructure, operational overhead |
| **Maturity** | Production deployments, stability, API stability |
| **Vendor risk** | Is it open source? Who controls the roadmap? |
| **Security** | Known CVEs, audit history, data handling |

Build a comparison matrix. Populate every cell. If a cell is unknown, mark it unknown — do not leave it blank.

---

## Output Format

Every research output follows this structure:

### 1. Research Brief
One paragraph: the question investigated, the scope, and the time frame of sources used.

### 2. Summary of Findings
3–5 bullet points: the most important conclusions a decision-maker needs to know. Put this first — the full detail follows.

### 3. Detailed Findings
Organised by sub-question or evaluation dimension. Each finding cites its source inline: `[Source: URL, date]`.

### 4. Comparison Table (if applicable)
A structured matrix comparing options across the defined criteria.

### 5. Gaps & Limitations
What could not be verified. What was only found in one source. What may be outdated. What was out of scope.

### 6. Recommended Next Steps
What to investigate next. What to prototype or test. What decision this research supports.

### 7. Sources
A numbered list of all sources cited, with URL and date accessed.

---

## Research Quality Checklist

Before delivering research output, verify:

- [ ] Every factual claim has a cited source
- [ ] No claim relies solely on vendor documentation for a claim about that vendor's product
- [ ] All sources have a publication date checked for recency
- [ ] Contradictions between sources are flagged, not silently resolved
- [ ] The comparison criteria were defined before, not after, seeing the results
- [ ] Limitations and unknowns are explicitly stated
- [ ] At least one source searched for criticisms, failures, and limitations — not just features
- [ ] GitHub repos checked for activity level, not just star count
- [ ] Summary findings connect back to the user's stated decision or use case
- [ ] No claim is presented as fact that was only found in one source without flagging
