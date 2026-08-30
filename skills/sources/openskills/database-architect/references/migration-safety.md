# Production Migration Safety

1. Classify the change as metadata-only, backfill, rewrite, or compatibility-breaking.
2. Use an expand/contract sequence: add compatible structures, deploy compatible code, backfill in controlled batches, switch reads, then remove old structures later.
3. Bound lock time, transaction size, load, and retry behavior. Test the plan against production-like volume where possible.
4. Define stop conditions, observability, rollback or roll-forward actions, and a data-correction plan before execution.
5. Preserve backups and verify restoration procedures for destructive or irreversible changes.

Never assume a migration is safe because it ran quickly on an empty development database.
