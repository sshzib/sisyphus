# Skills Intelligence architecture

## Decision

The existing control plane already owns tenant-authenticated dashboard data and
the engineering orchestrator already owns model execution. The Skill Registry
belongs beside the control plane, not in the desktop renderer or a second
orchestrator store.

```text
Desktop Skills view -> authenticated API -> Skill Registry
                                            | metadata, evaluations, proposals
Engineering orchestrator -> internal API -> selected skill bundle
                                            | full SKILL.md read only on selection
                                            v
                                      source cache / enhanced / custom
```

The desktop receives metadata and an explicitly requested detail document. It
never receives every instruction file. The orchestrator receives only the
smallest skill bundle selected for the request and agent role. A skill file is
instructional content, not permission to execute a command; generated changes
remain subject to the existing workspace and sandbox policy gates.

## Data shape

`SkillRegistryEntry` is the immutable source metadata and content digest.
`SkillProfile` is local performance and status data. `SkillImprovementProposal`
is a reviewable suggestion, never an automatic mutation. `SkillSource` tracks
the upstream source revision and sync timestamp. Custom and enhanced content
live in separate paths; upstream files remain recoverable.

## Storage layout

```text
skills/
  sources/openskills/      unmodified upstream cache plus its LICENSE
  registry/                parsed metadata and sync state
  enhanced/                approved local overlays only
  custom/                  Sisyphus-authored skills only
  evaluations/             recorded evaluation outcomes
```

For the local prototype this registry is file-backed. A production deployment
must move the profiles, evaluations, proposals, and sync state into the
tenant-scoped control-plane database before making durability claims.

## Integration contract

The API exposes list, detail, create, sync-preview, evaluation request, and
proposal actions for authenticated users. A narrow internal endpoint accepts a
task request and role, selects metadata with deterministic keyword matching,
and returns at most the configured number of full skill documents. The
orchestrator supplies that bundle as context to the selected agent, while model
routing remains provider independent.
