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
$sourceValues = @($config.source)
$sources = @($sourceValues | ForEach-Object { Join-Path $projectRoot ([string]$_) })
$assetSourceValue = if ($null -ne $config.assetSource) {
    [string]$config.assetSource
}
elseif ($sourceValues.Count -eq 1) {
    [string]$sourceValues[0]
}
else {
    throw "Multiple sources require config.assetSource for 3D asset generation"
}
$assetSource = Join-Path $projectRoot $assetSourceValue
$generatedSource = Join-Path $projectRoot $config.generatedSource
$generatedAssets = Join-Path $projectRoot $config.generatedAssets
$evidence = Join-Path $projectRoot $config.evidence

foreach ($requiredPath in @($cli) + $sources) {
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

function Get-OperationId([string]$Source) {
    $json = (& node $cli "compile" $Source 2>$null) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect operation ID for $Source"
    }
    return [string](($json | ConvertFrom-Json).operation.id)
}

function Invoke-Generate {
    Invoke-CrddIr @("project", "doctor", $configPath)
    foreach ($source in $sources) {
        Invoke-CrddIr @("check", $source)
    }
    if ($sources.Count -eq 1) {
        Invoke-CrddIr @("generate", "unreal", $sources[0], "--out-dir", $generatedSource)
    }
    else {
        Invoke-CrddIr (@("batch", "unreal") + $sources + @(
            "--out-dir", $generatedSource, "--flat"
        ))
    }
    Invoke-CrddIr @("generate", "assets", $assetSource, "--out-dir", $generatedAssets)
}

switch ($Command) {
    "doctor" {
        Invoke-CrddIr @("project", "doctor", $configPath)
    }
    "check" {
        foreach ($source in $sources) {
            Invoke-CrddIr @("check", $source)
        }
    }
    "generate" {
        Invoke-Generate
    }
    "verify" {
        Invoke-Generate
        foreach ($source in $sources) {
            Invoke-CrddIr @("test", "run", $source)
        }
        if ($null -ne $config.unreal) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (
                Join-Path $toolRoot "scripts\verify-project-unreal.ps1"
            ) -ProjectRoot $projectRoot
            if ($LASTEXITCODE -ne 0) {
                throw "CRDD Unreal project verification failed with exit code $LASTEXITCODE"
            }
        }
        else {
            foreach ($source in $sources) {
                Invoke-CrddIr @("generate", "evidence", $source, "--out-dir", (
                    Join-Path $evidence (Get-OperationId $source)
                ))
            }
        }
    }
}
