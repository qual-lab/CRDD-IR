param(
    [Parameter(Position = 0)]
    [ValidateSet("check", "generate", "verify")]
    [string]$Command = "check"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "crdd-ir.config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "CRDD-IR config not found: $configPath"
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.protocol -ne "crdd-ir/project-config-v0.1") {
    throw "Unsupported CRDD-IR project config protocol: $($config.protocol)"
}
$toolRoot = Join-Path $projectRoot $config.toolRoot
$cli = Join-Path $toolRoot "src\cli.ts"
$source = Join-Path $projectRoot $config.source
$generatedSource = Join-Path $projectRoot $config.generatedSource
$generatedAssets = Join-Path $projectRoot $config.generatedAssets
$evidence = Join-Path $projectRoot $config.evidence

foreach ($requiredPath in @($cli, $source)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required CRDD-IR path not found: $requiredPath"
    }
}

function Invoke-CrddIr([string[]]$Arguments) {
    & node $cli @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "CRDD-IR command failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Generate {
    Invoke-CrddIr @("check", $source)
    Invoke-CrddIr @("generate", "unreal", $source, "--out-dir", $generatedSource)
    Invoke-CrddIr @("generate", "assets", $source, "--out-dir", $generatedAssets)
}

switch ($Command) {
    "check" {
        Invoke-CrddIr @("check", $source)
    }
    "generate" {
        Invoke-Generate
    }
    "verify" {
        Invoke-Generate
        Invoke-CrddIr @("test", "run", $source)
        if ($null -ne $config.unreal) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (
                Join-Path $toolRoot "scripts\verify-project-unreal.ps1"
            ) -ProjectRoot $projectRoot
            if ($LASTEXITCODE -ne 0) {
                throw "CRDD Unreal project verification failed with exit code $LASTEXITCODE"
            }
        }
        else {
            Invoke-CrddIr @("generate", "evidence", $source, "--out-dir", $evidence)
        }
    }
}
