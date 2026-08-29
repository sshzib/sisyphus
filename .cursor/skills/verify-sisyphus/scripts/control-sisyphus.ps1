param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("launch", "doctor", "cleanup")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
  [string]$RunId,

  [ValidateRange(1024, 65535)]
  [int]$Port = 7417
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$scratchRoot = Join-Path $env:TEMP "sisyphus-verify\$RunId"
$statePath = Join-Path $scratchRoot "run.json"
$evidenceRoot = Join-Path $repoRoot "artifacts\verify-sisyphus\$RunId"
$stdoutPath = Join-Path $evidenceRoot "server.stdout.log"
$stderrPath = Join-Path $evidenceRoot "server.stderr.log"

function Get-RunState {
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw "No verification state exists for run '$RunId' at $statePath."
  }
  return Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
}

function Test-DescendsFrom {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$AncestorId
  )

  $visited = [System.Collections.Generic.HashSet[int]]::new()
  $current = $ProcessId
  while ($current -gt 0 -and $visited.Add($current)) {
    if ($current -eq $AncestorId) {
      return $true
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      return $false
    }
    $current = [int]$process.ParentProcessId
  }
  return $false
}

function Stop-RunProcess {
  param([Parameter(Mandatory = $true)]$State)

  $process = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return
  }

  $actualStart = $process.StartTime.ToUniversalTime().ToString("O")
  if ($actualStart -ne [string]$State.processStartedAt) {
    throw "PID $($State.pid) was reused. Refusing to stop an unrelated process."
  }

  & taskkill.exe /PID ([string]$State.pid) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "taskkill failed for verification PID $($State.pid)."
  }
}

switch ($Action) {
  "launch" {
    if (Test-Path -LiteralPath $statePath) {
      throw "Run '$RunId' already has state. Use cleanup or choose a new run ID."
    }

    $existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($null -ne $existingListener) {
      throw "Port $Port already has a listener. Choose another port."
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeDirectory = if ($null -ne $nodeCommand) {
      Split-Path -Parent $nodeCommand.Source
    } elseif (Test-Path -LiteralPath "C:\Program Files\nodejs\node.exe") {
      "C:\Program Files\nodejs"
    } else {
      throw "Node.js 22 or newer is required, but node.exe was not found."
    }

    $nodeVersion = & (Join-Path $nodeDirectory "node.exe") --version
    $nodeMajor = [int](($nodeVersion -replace "^v", "").Split(".")[0])
    if ($nodeMajor -lt 22) {
      throw "Node.js 22 or newer is required. Found $nodeVersion."
    }

    $corepack = Join-Path $nodeDirectory "corepack.cmd"
    if (-not (Test-Path -LiteralPath $corepack)) {
      throw "Corepack was not found beside node.exe at $corepack."
    }

    New-Item -ItemType Directory -Force -Path $scratchRoot, $evidenceRoot | Out-Null
    $corepackBin = Join-Path $scratchRoot "corepack-bin"
    New-Item -ItemType Directory -Force -Path $corepackBin | Out-Null
    & $corepack enable --install-directory $corepackBin
    if ($LASTEXITCODE -ne 0) {
      throw "Corepack could not prepare pnpm 10.15.0."
    }

    $pnpm = Join-Path $corepackBin "pnpm.cmd"
    $env:Path = "$corepackBin;$nodeDirectory;$env:Path"
    foreach ($setting in @(
      "SISYPHUS_WEB_API_URL",
      "SISYPHUS_WEB_ORIGIN",
      "SISYPHUS_WEB_SESSION_KEY",
      "NEXT_PUBLIC_SISYPHUS_API_URL",
      "NEXT_PUBLIC_SISYPHUS_DEMO_TOKEN"
    )) {
      [Environment]::SetEnvironmentVariable($setting, $null, "Process")
    }
    $quotedPnpm = '"' + $pnpm + '"'
    $quotedRepo = '"' + $repoRoot + '"'
    $command = "cd /d $quotedRepo && $quotedPnpm --filter @sisyphus/web dev --hostname 127.0.0.1 --port $Port"
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/s", "/c", $command) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $processStartedAt = $process.StartTime.ToUniversalTime().ToString("O")

    [ordered]@{
      runId = $RunId
      pid = $process.Id
      processStartedAt = $processStartedAt
      port = $Port
      url = "http://127.0.0.1:$Port"
      repoRoot = $repoRoot
      nodeVersion = $nodeVersion
      evidenceRoot = $evidenceRoot
    } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
      if ($process.HasExited) {
        break
      }
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port" -TimeoutSec 2
        if ($response.StatusCode -eq 200 -and $response.Content -match "Sisyphus") {
          $ready = $true
          break
        }
      } catch {
      }
      Start-Sleep -Seconds 1
    }

    if (-not $ready) {
      $state = Get-RunState
      Stop-RunProcess -State $state
      throw "Sisyphus did not become ready. Read $stdoutPath and $stderrPath."
    }

    Write-Output "READY run=$RunId pid=$($process.Id) url=http://127.0.0.1:$Port evidence=$evidenceRoot"
  }

  "doctor" {
    $state = Get-RunState
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      throw "Verification process $($state.pid) is not running."
    }

    $actualStart = $process.StartTime.ToUniversalTime().ToString("O")
    if ($actualStart -ne [string]$state.processStartedAt) {
      throw "PID $($state.pid) no longer identifies the process started by this run."
    }

    $listeners = @(Get-NetTCPConnection -LocalPort ([int]$state.port) -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) {
      throw "Expected one listener on port $($state.port), found $($listeners.Count)."
    }
    if (-not (Test-DescendsFrom -ProcessId ([int]$listeners[0].OwningProcess) -AncestorId ([int]$state.pid))) {
      throw "Port $($state.port) is not owned by the process tree started for run '$RunId'."
    }

    $response = Invoke-WebRequest -UseBasicParsing -Uri ([string]$state.url) -TimeoutSec 5
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch "Sisyphus") {
      throw "The listener answered, but it did not return the Sisyphus dashboard."
    }

    [ordered]@{
      status = "healthy"
      runId = [string]$state.runId
      pid = [int]$state.pid
      port = [int]$state.port
      url = [string]$state.url
      nodeVersion = [string]$state.nodeVersion
      evidenceRoot = [string]$state.evidenceRoot
    } | ConvertTo-Json
  }

  "cleanup" {
    if (-not (Test-Path -LiteralPath $statePath)) {
      Write-Output "CLEAN run=$RunId no-state evidence=$evidenceRoot"
      break
    }

    $state = Get-RunState
    Stop-RunProcess -State $state
    Remove-Item -LiteralPath $scratchRoot -Recurse -Force
    Write-Output "CLEAN run=$RunId evidence-retained=$($state.evidenceRoot)"
  }
}
