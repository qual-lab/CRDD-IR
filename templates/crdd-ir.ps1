param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "check", "generate", "verify")]
    [string]$Command = "check"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "crdd-ir.config.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "CRDD-IR config not found: $configPath"
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$toolRoot = Join-Path $projectRoot ([string]$config.toolRoot)
$cli = Join-Path $toolRoot "src\cli.ts"
$sources = @($config.sources | ForEach-Object { Join-Path $projectRoot ([string]$_) })

function Invoke-CrddIr([string[]]$Arguments) {
    & node $cli @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "CRDD-IR command failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Generate {
    foreach ($property in $config.targets.PSObject.Properties) {
        $targetId = [string]$property.Name
        $target = $property.Value
        $arguments = @(
            "batch", $targetId
        ) + $sources + @(
            "--out-dir", (Join-Path $projectRoot ([string]$target.output))
        )
        if (-not [string]::IsNullOrWhiteSpace([string]$target.profile)) {
            $arguments += @("--profile", (Join-Path $projectRoot ([string]$target.profile)))
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$target.module)) {
            $arguments += @("--target-module", (Join-Path $projectRoot ([string]$target.module)))
        }
        Invoke-CrddIr $arguments
    }
}

Invoke-CrddIr @("project", "check", $configPath)
switch ($Command) {
    "doctor" {
        Invoke-CrddIr @("project", "doctor", $configPath)
    }
    "check" {
        foreach ($source in $sources) { Invoke-CrddIr @("check", $source) }
    }
    "generate" {
        Invoke-CrddIr @("project", "doctor", $configPath)
        Invoke-Generate
    }
    "verify" {
        Invoke-CrddIr @("project", "doctor", $configPath)
        Invoke-Generate
        foreach ($source in $sources) { Invoke-CrddIr @("test", "run", $source) }
    }
}
