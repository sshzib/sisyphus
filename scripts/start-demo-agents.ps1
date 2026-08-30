[CmdletBinding()]
param(
  [switch]$VerifyOpenRouter,
  [switch]$ProbePlanner
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentFile = Join-Path $repositoryRoot 'apps/web/.env.local'
if (-not (Test-Path -LiteralPath $environmentFile)) {
  throw 'apps/web/.env.local is required for the local OpenRouter credential.'
}

Get-Content -LiteralPath $environmentFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim().Trim([char[]]@('"', "'", '“', '”')).Trim() -replace '\s', ''
    if ($name -eq 'SISYPHUS_OPENROUTER_API_KEY') {
      $openRouterKey = [regex]::Match($value, 'sk-or-v1-[A-Za-z0-9_-]+')
      if (-not $openRouterKey.Success) {
        throw 'SISYPHUS_OPENROUTER_API_KEY does not contain a valid OpenRouter key token.'
      }
      $value = $openRouterKey.Value
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

if ([string]::IsNullOrWhiteSpace($env:SISYPHUS_OPENROUTER_API_KEY)) {
  throw 'SISYPHUS_OPENROUTER_API_KEY is missing from apps/web/.env.local.'
}

if ($VerifyOpenRouter) {
  try {
    $response = Invoke-WebRequest -Uri 'https://openrouter.ai/api/v1/auth/key' -Headers @{ Authorization = "Bearer $env:SISYPHUS_OPENROUTER_API_KEY" } -UseBasicParsing
    [pscustomobject]@{ authenticated = $response.StatusCode -eq 200; statusCode = $response.StatusCode }
    return
  } catch {
    $statusCode = if ($null -eq $_.Exception.Response) { $null } else { [int]$_.Exception.Response.StatusCode }
    throw "OpenRouter key verification failed with status $statusCode."
  }
}

if ($ProbePlanner) {
  $body = @{
    model = 'deepseek/deepseek-v4-flash'
    messages = @(@{ role = 'user'; content = 'Return only {"ready":true}.' })
    response_format = @{ type = 'json_object' }
    max_tokens = 128
    temperature = 0
  } | ConvertTo-Json -Depth 6 -Compress
  try {
    $response = Invoke-WebRequest -Uri 'https://openrouter.ai/api/v1/chat/completions' -Method Post -Headers @{ Authorization = "Bearer $env:SISYPHUS_OPENROUTER_API_KEY"; 'Content-Type' = 'application/json' } -Body $body -UseBasicParsing -TimeoutSec 45
    $payload = $response.Content | ConvertFrom-Json
    $firstChoice = @($payload.choices)[0]
    [pscustomobject]@{
      statusCode = $response.StatusCode
      hasCompletion = $null -ne $firstChoice
      contentKind = if ($null -eq $firstChoice.message.content) { 'null' } else { $firstChoice.message.content.GetType().Name }
      contentLength = if ($firstChoice.message.content -is [string]) { $firstChoice.message.content.Length } else { 0 }
      finishReason = [string]$firstChoice.finish_reason
    }
    return
  } catch {
    $statusCode = if ($null -eq $_.Exception.Response) { $null } else { [int]$_.Exception.Response.StatusCode }
    throw "OpenRouter planner probe failed with status $statusCode."
  }
}

$tokenBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$env:SISYPHUS_ORCHESTRATOR_TOKEN = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
$env:SISYPHUS_API_URL = 'http://127.0.0.1:7330'
$env:SISYPHUS_ORCHESTRATOR_TENANT_ID = if ([string]::IsNullOrWhiteSpace($env:SISYPHUS_ORCHESTRATOR_TENANT_ID)) {
  if ([string]::IsNullOrWhiteSpace($env:SISYPHUS_SUPABASE_DEFAULT_TENANT_ID)) { 'tenant-acme' } else { $env:SISYPHUS_SUPABASE_DEFAULT_TENANT_ID }
} else {
  $env:SISYPHUS_ORCHESTRATOR_TENANT_ID
}
$env:SISYPHUS_ORCHESTRATOR_MAX_AGENTS = '12'
$env:SISYPHUS_ORCHESTRATOR_MAX_SKILLS_PER_AGENT = '3'
$env:SISYPHUS_EXECUTION_MODE = 'local-static'
$env:SISYPHUS_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash'
$env:SISYPHUS_OPENROUTER_FALLBACK_MODEL = 'qwen/qwen3-coder'
$env:SISYPHUS_OPENROUTER_ROLE_MODELS = '{"frontend":"qwen/qwen3-coder","backend":"qwen/qwen3-coder","authentication":"qwen/qwen3-coder","api":"qwen/qwen3-coder","database":"qwen/qwen3-coder","devops":"qwen/qwen3-coder","full-stack":"qwen/qwen3-coder","fixer":"qwen/qwen3-coder","planner":"deepseek/deepseek-v4-flash","architect":"deepseek/deepseek-v4-flash","product":"deepseek/deepseek-v4-flash","research":"deepseek/deepseek-v4-flash","design":"deepseek/deepseek-v4-flash","accessibility":"deepseek/deepseek-v4-flash","performance":"deepseek/deepseek-v4-flash","documentation":"deepseek/deepseek-v4-flash","qa":"deepseek/deepseek-v4-flash","tester":"deepseek/deepseek-v4-flash","test":"deepseek/deepseek-v4-flash","reviewer":"deepseek/deepseek-v4-flash","security":"deepseek/deepseek-v4-flash"}'
$env:SISYPHUS_ORCHESTRATOR_WORKSPACE_ROOT = Join-Path ([System.IO.Path]::GetTempPath()) 'sisyphus-demo-agent-workspaces'

Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
Remove-Item Env:SISYPHUS_CODEBUILD_PROJECT -ErrorAction SilentlyContinue
Remove-Item Env:SISYPHUS_ARTIFACT_BUCKET -ErrorAction SilentlyContinue

if (Get-NetTCPConnection -LocalPort 7330 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 7330 is already in use. Stop the existing API before starting the demo agents.'
}

Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm --filter @sisyphus/api dev' -WorkingDirectory $repositoryRoot -WindowStyle Hidden
$deadline = [DateTime]::UtcNow.AddSeconds(12)
do {
  Start-Sleep -Milliseconds 250
  $apiListener = Get-NetTCPConnection -LocalPort 7330 -State Listen -ErrorAction SilentlyContinue
} while ($null -eq $apiListener -and [DateTime]::UtcNow -lt $deadline)
if ($null -eq $apiListener) {
  throw 'The local API did not begin listening on port 7330.'
}

Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm --filter @sisyphus/orchestrator dev' -WorkingDirectory $repositoryRoot -WindowStyle Hidden
Start-Sleep -Seconds 2
$orchestrator = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'apps\\orchestrator.*tsx.*server\.ts' } |
  Select-Object -First 1
if ($null -eq $orchestrator) {
  throw 'The OpenRouter orchestration worker did not start.'
}

[pscustomobject]@{
  apiPort = $apiListener.LocalPort
  orchestratorPid = $orchestrator.ProcessId
  plannerModel = $env:SISYPHUS_OPENROUTER_MODEL
  builderModel = 'qwen/qwen3-coder'
  execution = 'local-static'
}
