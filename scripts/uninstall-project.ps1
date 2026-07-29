param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [switch]$ForceManagedRemoval,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($ProjectRoot)
$manifestPath = Join-Path $root ".crdd-ir.install.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "CRDD-IR installation manifest not found: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.protocol -ne "crdd-ir/install-manifest-v0.2") {
    throw "Unsupported CRDD-IR installation manifest: $($manifest.protocol)"
}
$backupRoot = Join-Path $root (
    ".crdd-ir\backups\uninstall-" + [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
)
$begin = "<!-- CRDD-IR:BEGIN -->"
$end = "<!-- CRDD-IR:END -->"

function Get-Hash([string]$Content) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (([BitConverter]::ToString($algorithm.ComputeHash($bytes))) -replace "-", "").
            ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Resolve-OwnedPath([string]$RelativePath) {
    if ([System.IO.Path]::IsPathRooted($RelativePath) -or
        ($RelativePath -split "[\\/]" -contains "..")) {
        throw "Unsafe managed path in installation manifest: $RelativePath"
    }
    $path = [System.IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    $prefix = $root.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
    if (-not $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Managed path escapes project root: $RelativePath"
    }
    return $path
}

function Backup-File([string]$Path, [string]$RelativePath) {
    $backup = Join-Path $backupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Warning "Backed up modified managed file to $backup"
}

$operations = [System.Collections.Generic.List[object]]::new()
foreach ($entry in $manifest.files) {
    $path = Resolve-OwnedPath ([string]$entry.path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $operations.Add([pscustomobject][ordered]@{ action = "missing"; path = [string]$entry.path })
        continue
    }
    $content = Get-Content -LiteralPath $path -Raw
    if ($entry.kind -eq "managed-block") {
        $start = $content.IndexOf($begin, [System.StringComparison]::Ordinal)
        $finish = $content.IndexOf($end, [System.StringComparison]::Ordinal)
        if ($start -lt 0 -or $finish -lt $start) {
            Backup-File $path ([string]$entry.path)
            if (-not $ForceManagedRemoval) {
                throw "Managed block is missing or modified: $($entry.path)"
            }
            $operations.Add([pscustomobject][ordered]@{
                action = "preserve-modified"
                path = [string]$entry.path
            })
            continue
        }
        $finish += $end.Length
        $block = $content.Substring($start, $finish - $start)
        if ((Get-Hash $block) -ne [string]$entry.sha256) {
            Backup-File $path ([string]$entry.path)
            if (-not $ForceManagedRemoval) {
                throw "Managed block was modified: $($entry.path)"
            }
        }
        $updated = ($content.Substring(0, $start) + $content.Substring($finish)).Trim()
        $operations.Add([pscustomobject][ordered]@{
            action = if ($updated.Length -eq 0) { "delete-empty-file" } else { "remove-block" }
            path = [string]$entry.path
            target = $path
            content = $updated
        })
    }
    else {
        if ((Get-Hash $content) -ne [string]$entry.sha256) {
            Backup-File $path ([string]$entry.path)
            if (-not $ForceManagedRemoval) {
                throw "Managed file was modified: $($entry.path)"
            }
        }
        $operations.Add([pscustomobject][ordered]@{
            action = "delete-file"
            path = [string]$entry.path
            target = $path
        })
    }
}

$operations | Select-Object action, path | Format-Table
if ($WhatIf) {
    Write-Host "WhatIf: no files were changed."
    exit 0
}
foreach ($operation in $operations) {
    if ($operation.action -eq "delete-file" -or $operation.action -eq "delete-empty-file") {
        Remove-Item -LiteralPath $operation.target -Force
    }
    elseif ($operation.action -eq "remove-block") {
        [System.IO.File]::WriteAllText(
            $operation.target,
            $operation.content + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}
Remove-Item -LiteralPath $manifestPath -Force
Write-Host "Uninstalled CRDD-IR managed integration from $root"
