param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "check", "generate", "verify")]
    [string]$Command = "check"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "crdd-ir.config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "CRDD-IR config not found: $configPath"
}

$bootstrapConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$bootstrapToolRootValue = [string]$bootstrapConfig.toolRoot
if ([string]::IsNullOrWhiteSpace($bootstrapToolRootValue) -or
    [System.IO.Path]::IsPathRooted($bootstrapToolRootValue) -or
    ($bootstrapToolRootValue -split "[\\/]" -contains "..")) {
    throw "config.toolRoot must be a safe project-relative path"
}
$bootstrapToolRoot = Join-Path $projectRoot $bootstrapConfig.toolRoot
$resolvedBootstrapToolRoot = [System.IO.Path]::GetFullPath($bootstrapToolRoot)
$resolvedProjectPrefix = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd("\", "/") +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedBootstrapToolRoot.StartsWith(
    $resolvedProjectPrefix,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "config.toolRoot must stay within the project root"
}
$bootstrapCli = Join-Path $resolvedBootstrapToolRoot "src\cli.ts"
if (-not (Test-Path -LiteralPath $bootstrapCli)) {
    throw "CRDD-IR CLI not found: $bootstrapCli"
}
& node $bootstrapCli "project" "check" $configPath
if ($LASTEXITCODE -ne 0) {
    throw "Invalid CRDD-IR project config"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
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
    Invoke-CrddIr @("project", "doctor", $configPath)
    Invoke-CrddIr @("check", $source)
    Invoke-CrddIr @("generate", "unreal", $source, "--out-dir", $generatedSource)
    Invoke-CrddIr @("generate", "assets", $source, "--out-dir", $generatedAssets)
}

switch ($Command) {
    "doctor" {
        Invoke-CrddIr @("project", "doctor", $configPath)
    }
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
