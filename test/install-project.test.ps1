$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot ".crdd-ir\installer-test"
$installer = Join-Path $repoRoot "scripts\install-project.ps1"

if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
try {
    & $installer -ProjectRoot $target `
        -Source @("contracts/read.md", "contracts/change.md") `
        -Target @("typescript", "ir") `
        -GeneratedRoot "generated/contracts"

    $config = Get-Content -LiteralPath (Join-Path $target "crdd-ir.config.json") -Raw |
        ConvertFrom-Json
    if ($config.protocol -ne "crdd-ir/project-config-v0.2") {
        throw "Installer generated an unexpected configuration protocol"
    }
    if (@($config.sources).Count -ne 2 -or @($config.targets.PSObject.Properties).Count -ne 2) {
        throw "Installer did not preserve generic sources and targets"
    }
    if ($null -ne $config.unreal -or $null -ne $config.assetSource) {
        throw "Installer leaked legacy target-specific configuration"
    }

    $manifest = Get-Content -LiteralPath (Join-Path $target ".crdd-ir.install.json") -Raw |
        ConvertFrom-Json
    if ($manifest.protocol -ne "crdd-ir/install-manifest-v0.2" -or $manifest.files.Count -ne 2) {
        throw "Installer did not record generic managed ownership"
    }
    Write-Host "CRDD-IR installer regression test succeeded."
}
finally {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
