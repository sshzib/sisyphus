# Skill restoration

Skill restoration lets an administrator move a quarantined skill version into probation with a required reason and an audit record.

## Sub-features

- `restore-open` opens the restore dialog from a quarantined skill row.
- `restore-cancel` closes the dialog without changing standing.
- `restore-validation` requires a reason of at least eight characters.
- `restore-submit` moves the skill to probation.
- `restore-audit` records the administrator reason in Audit log.

## How to get to it (user POV)

- Choose `Skills` in the `Dashboard sections` navigation.
- Find `Safe refactor` with standing `Quarantined`.
- Choose `Restore`, enter a reason, and choose `Restore to probation`.

## Driving it with T3 Code preview

Preconditions:

- Doctor reports the run healthy.
- The page uses a fresh demo client. `Safe refactor` is quarantined and is the only row with `Restore`.

- **Open dialog.** Click `role=button[name=/^Skills/]`, wait for heading `Skills`, then click `role=button[name='Restore']`. The dialog name is `Restore Safe refactor` and it contains the textbox `Reason for restoration`.
- **Cancel.** Type `No change yet` into the reason textbox, click `role=button[name='Cancel']`, and confirm the `Safe refactor` row still says `Quarantined`.
- **Reopen and submit.** Click `Restore`, type `Adapter conformance checks now pass.` into `Reason for restoration`, and click `Restore to probation`. Wait for the dialog to close.
- **Confirm standing.** Take a snapshot of Skills. The `Safe refactor` row says `Probation` and no longer has a Restore button.
- **Confirm audit.** Click `role=button[name='Audit log']`. The first event says `Skill restored`, names `Safe refactor`, includes `Adapter conformance checks now pass.`, and identifies `demo-admin@sisyphus.local`.
- **Proof.** Record from the first Restore click through the Audit log confirmation. Copy it to `artifacts/verify-sisyphus/<run-id>/skill-restoration.webm`.

## Gotchas

- The demo mutation lives only in the current browser session. A reload creates a fresh demo client and restores the baseline.
- The submit button stays disabled until the reason has at least eight characters.
- Closing the dialog is not proof of success. Confirm both Skills standing and Audit log.
- Runtime filtering can hide `Safe refactor`. Reset Runtime to `All comparable cohorts` before this recipe.
