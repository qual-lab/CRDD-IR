$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot ".crdd-ir\installer-test"
$installer = Join-Path $repoRoot "scripts\install-project.ps1"

if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
try {
    & $installer -ProjectRoot $target
    & $installer -ProjectRoot $target

    $manifest = Get-Content -LiteralPath (
        Join-Path $target ".crdd-ir.install.json"
    ) -Raw | ConvertFrom-Json
    if ($manifest.protocol -ne "crdd-ir/install-manifest-v0.1" -or
        $manifest.files.Count -lt 5) {
        throw "Installer did not record managed ownership"
    }

    $wrapper = Join-Path $target "tools\crdd-ir.ps1"
    [System.IO.File]::AppendAllText($wrapper, "# user change")
    $failedSafely = $false
    try {
        & $installer -ProjectRoot $target
    }
    catch {
        $failedSafely = $_.Exception.Message -match "Managed file was modified"
    }
    if (-not $failedSafely) {
        throw "Installer did not stop on a modified managed file"
    }
    if (@(Get-ChildItem -LiteralPath (
        Join-Path $target ".crdd-ir\backups"
    ) -Filter "crdd-ir.ps1" -File -Recurse).Count -eq 0) {
        throw "Installer did not back up the modified managed file"
    }

    & $installer -ProjectRoot $target -ForceManagedUpdate
    Write-Host "CRDD-IR installer regression test succeeded."
}
finally {
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
