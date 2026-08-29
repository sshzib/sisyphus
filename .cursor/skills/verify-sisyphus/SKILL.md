---
name: verify-sisyphus
description: Verify the Sisyphus web dashboard by launching an isolated local instance, driving its controls through the T3 Code collaborative browser, and retaining browser and server evidence. Use after dashboard changes or when checking runtime filters, skill standing, integrations, or navigation.
---

# Verify Sisyphus

Sisyphus has web, Electron, API, worker, and runtime-adapter entry points. Drive the web dashboard first. It is the primary user-facing view and uses deterministic demo data when `NEXT_PUBLIC_SISYPHUS_API_URL` and `NEXT_PUBLIC_SISYPHUS_DEMO_TOKEN` are unset. The desktop shell embeds the same shared dashboard but also depends on Electron and the local worker. API and worker verification belong in their package tests unless the task changes those boundaries.

## Launch

Run these commands from the repository root in PowerShell. Pick a free port for each run so another agent can verify in parallel.

```powershell
$runId = "run-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$port = 7417
powershell -ExecutionPolicy Bypass -File .cursor/skills/verify-sisyphus/scripts/control-sisyphus.ps1 -Action launch -RunId $runId -Port $port
```

The controller uses the repo-pinned pnpm 10.15.0 through Corepack, starts `@sisyphus/web` on `127.0.0.1`, and waits for an HTTP 200 response containing `Sisyphus`. `READY` means the app is ready. It writes process state under `%TEMP%\sisyphus-verify\<run-id>` and server logs under `artifacts/verify-sisyphus/<run-id>`.

Do not launch if the chosen port has a listener. Do not drive a Sisyphus tab whose URL differs from the controller's `READY` URL.

Teardown uses the same `$runId`:

```powershell
powershell -ExecutionPolicy Bypass -File .cursor/skills/verify-sisyphus/scripts/control-sisyphus.ps1 -Action cleanup -RunId $runId
```

## Doctor

Run this read-only check whenever the page looks stale, blank, or disconnected:

```powershell
powershell -ExecutionPolicy Bypass -File .cursor/skills/verify-sisyphus/scripts/control-sisyphus.ps1 -Action doctor -RunId $runId | Tee-Object -FilePath "artifacts/verify-sisyphus/$runId/doctor.json"
```

Require `status: healthy`. The check confirms the recorded process start time, proves the port listener belongs to that process tree, fetches the dashboard, and reports the Node version and evidence directory. A listener on the right port is not enough.

## Drive

Use the T3 Code collaborative browser. Call `preview_status` first. If no automation-capable tab exists, call `preview_open`. Navigate with `preview_navigate` and `{ target: { kind: "environment-port", port: $port } }`. Wait for visible text `Comparable runtime cohorts`, then inspect the page with `preview_snapshot` before each interaction.

Use these stable handles from `DashboardApp.tsx`:

- Dashboard sections are buttons inside the `Dashboard sections` navigation. Use names `Overview`, `Runs`, `Agents`, `Skills`, `Conflict matrix`, `Integrations`, `Policies`, `Audit log`, and `Devices`. The `Skills` accessible name can include its quarantine count, so target `role=button[name=/^Skills/]`.
- The cohort control is `role=combobox[name='Runtime']`. Open it with `preview_click`, choose the last option with `preview_press` key `End`, then commit with `preview_press` key `Enter`. This selects OpenCode through a real user input path.
- The quarantined `Safe refactor` row is the only demo row with a `Restore` button. Select the button with `role=button[name='Restore']` after opening Skills.
- The restore dialog is `role=dialog[name='Restore Safe refactor']`. Its textbox is labeled `Reason for restoration`. Submit through `role=button[name='Restore to probation']`.

Do not use `preview_evaluate` to set React state or dispatch data-client calls. That bypasses the user path. Use it only for a read-only DOM assertion when the snapshot does not expose a needed value.

Read [features/README.md](features/README.md), then drive every entry point listed for the feature in scope. A successful shortcut does not verify a second entry point.

## Evidence

Keep proof under `artifacts/verify-sisyphus/<run-id>`. Start `preview_recording_start` before the first user action and stop it only after the result is visible. Copy the path returned by `preview_recording_stop` into that directory with a feature-specific name such as `runtime-filter.webm`. Keep `doctor.json`, `server.stdout.log`, and `server.stderr.log` beside it. Take `preview_snapshot` before the action and after the resulting state appears. The snapshots remain in the run transcript, while the recording and logs remain on disk.

A valid proof exercises the real browser path. It records the action and resulting state, not only a final screen. For a mutation such as skill restoration, confirm the new standing from the Skills table and confirm the new event from Audit log. The demo client is acceptable because it is the production web app's built-in fallback at the data-client boundary. Do not replace it with test-only setters or endpoints.

When a safe mode claims to skip a side effect, inspect the side effect itself. Sisyphus has no dashboard dry-run mode. The demo client keeps mutations in the current browser session and sends no API request because the two `NEXT_PUBLIC_SISYPHUS_*` variables are unset. Confirm the server log has no configured API URL before treating a demo run as isolated.

## Cleanup

Stop only the run you launched:

```powershell
powershell -ExecutionPolicy Bypass -File .cursor/skills/verify-sisyphus/scripts/control-sisyphus.ps1 -Action cleanup -RunId $runId
```

The controller validates the recorded process start time, then stops that PID and its children. It never kills by process name. Cleanup removes `%TEMP%\sisyphus-verify\<run-id>` and retains `artifacts/verify-sisyphus/<run-id>`. After cleanup, check that the feature recording, `doctor.json`, and server logs still exist.

## Helpers

`scripts/control-sisyphus.ps1` is the only shipped helper. Invoke it with PowerShell as shown above.

- `launch` prepares an isolated Corepack shim, records the process, waits for the Sisyphus page, and writes logs outside scratch state.
- `doctor` checks the exact process, listener ownership, HTTP response, Node version, and evidence path without changing app state.
- `cleanup` stops the recorded process tree and removes scratch state without deleting evidence.
