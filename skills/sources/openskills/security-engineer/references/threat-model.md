# Lightweight Threat Model

## Capture

- Assets: data, credentials, money movement, and privileged actions.
- Actors: end user, administrator, service, third party, and attacker.
- Trust boundaries: browser-to-API, service-to-service, queue, storage, and vendor integrations.
- Entry points: endpoints, jobs, uploads, webhooks, MCP tools, and admin workflows.

## Review Each Boundary

Ask who can invoke it, how identity and authorization are checked, what input reaches a sensitive sink, what is logged, and how the action can be rate-limited, reversed, or audited.

## Deliverable

List threats with an affected asset, attack path, likelihood, impact, owner, mitigation, and verification step. Prioritize exploitable paths to high-value assets; do not label a risk resolved until its mitigation is tested.
