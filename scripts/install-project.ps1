param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [string[]]$Source = @("05_SPEC/01_Behavior_Specification.md"),
    [string]$AssetSource = "",
    [string]$GeneratedSource = "40_Develop/Generated/Source",
    [string]$GeneratedAssets = "40_Develop/Generated/Assets",
    [string]$Evidence = "07_Quality/CRDD_IR",
    [string]$ToolRoot = "tools/CRDD-IR",
    [string]$UnrealProject = "",
    [string]$UnrealEngineRoot = "C:/Program Files/Epic Games/UE_5.8",
    [string]$UnrealEditorTarget = "",
    [switch]$ForceManagedUpdate
)

$ErrorActionPreference = "Stop"
$installerRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path -LiteralPath $resolvedProjectRoot -PathType Container)) {
    throw "Project root not found: $resolvedProjectRoot"
}
$manifestPath = Join-Path $resolvedProjectRoot ".crdd-ir.install.json"
$backupRoot = Join-Path $resolvedProjectRoot (
    ".crdd-ir\backups\" + [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
)
$toolVersion = (Get-Content -LiteralPath (Join-Path $installerRoot "package.json") -Raw |
    ConvertFrom-Json).version
$previousManifest = if (Test-Path -LiteralPath $manifestPath) {
    Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}
else {
    $null
}
$installedEntries = [System.Collections.Generic.List[object]]::new()

function Get-ContentHash([string]$Content) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $algorithm.ComputeHash($bytes)
        return ([BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-FileHashValue([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ManagedRelativePath([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $prefix = $resolvedProjectRoot.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Managed path escapes project root: $fullPath"
    }
    return $fullPath.Substring($prefix.Length).Replace("\", "/")
}

function Backup-ManagedConflict([string]$Path, [string]$RelativePath) {
    $backup = Join-Path $backupRoot $RelativePath
    $parent = Split-Path -Parent $backup
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Warning "Backed up modified managed file to $backup"
}

function Install-ManagedFile([string]$Path, [string]$Content, [string]$Kind = "file") {
    $relative = Get-ManagedRelativePath $Path
    $desiredHash = Get-ContentHash $Content
    $previous = @($previousManifest.files | Where-Object { $_.path -eq $relative }) |
        Select-Object -First 1

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $currentHash = Get-FileHashValue $Path
        $expectedHash = if ($null -ne $previous) { [string]$previous.sha256 } else { "" }
        if ($currentHash -ne $desiredHash -and $currentHash -ne $expectedHash) {
            Backup-ManagedConflict $Path $relative
            if (-not $ForceManagedUpdate) {
                throw "Managed file was modified: $relative. Review the backup and rerun with -ForceManagedUpdate."
            }
        }
    }
    Write-Utf8File $Path $Content
    $installedEntries.Add([ordered]@{
        path = $relative
        kind = $Kind
        sha256 = $desiredHash
    })
}

function Write-Utf8File([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [System.IO.File]::WriteAllText(
        $Path,
        $Content,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Install-ManagedBlock([string]$RelativePath, [string]$TemplateName) {
    $target = Join-Path $resolvedProjectRoot $RelativePath
    $shared = Get-Content -LiteralPath (
        Join-Path $installerRoot "templates\shared-agent-guidance.md"
    ) -Raw
    $template = Get-Content -LiteralPath (
        Join-Path $installerRoot "templates\$TemplateName"
    ) -Raw
    $rendered = $template.Replace(
        "<!-- CRDD-IR:INCLUDE shared-agent-guidance.md -->",
        $shared.Trim()
    )
    $begin = "<!-- CRDD-IR:BEGIN -->"
    $end = "<!-- CRDD-IR:END -->"
    $block = $shared.Trim()
    $relative = $RelativePath.Replace("\", "/")
    $previous = @($previousManifest.files | Where-Object { $_.path -eq $relative }) |
        Select-Object -First 1

    if (Test-Path -LiteralPath $target) {
        $current = Get-Content -LiteralPath $target -Raw
        $start = $current.IndexOf($begin, [System.StringComparison]::Ordinal)
        $finish = $current.IndexOf($end, [System.StringComparison]::Ordinal)
        if ($start -ge 0 -and $finish -ge $start) {
            $finish += $end.Length
            $currentBlock = $current.Substring($start, $finish - $start)
            $expectedHash = if ($null -ne $previous) { [string]$previous.sha256 } else { "" }
            if ((Get-ContentHash $currentBlock) -ne (Get-ContentHash $block) -and
                (Get-ContentHash $currentBlock) -ne $expectedHash) {
                Backup-ManagedConflict $target $relative
                if (-not $ForceManagedUpdate) {
                    throw "Managed guidance block was modified: $relative. Review the backup and rerun with -ForceManagedUpdate."
                }
            }
            $updated = $current.Substring(0, $start) + $block + $current.Substring($finish)
        }
        else {
            $updated = $current.TrimEnd() + [Environment]::NewLine * 2 + $block + [Environment]::NewLine
        }
    }
    else {
        $updated = $rendered.TrimEnd() + [Environment]::NewLine
    }
    Write-Utf8File $target $updated
    $installedEntries.Add([ordered]@{
        path = $relative
        kind = "managed-block"
        sha256 = Get-ContentHash $block
    })
}

$wrapperSource = Join-Path $installerRoot "templates\crdd-ir.ps1"
$wrapperTarget = Join-Path $resolvedProjectRoot "tools\crdd-ir.ps1"
Install-ManagedFile $wrapperTarget (Get-Content -LiteralPath $wrapperSource -Raw)

$normalizedSources = @($Source | ForEach-Object { $_.Replace("\", "/") })
$config = [ordered]@{
    protocol = "crdd-ir/project-config-v0.1"
    toolRoot = $ToolRoot.Replace("\", "/")
    source = if ($normalizedSources.Count -eq 1) { $normalizedSources[0] } else { $normalizedSources }
    generatedSource = $GeneratedSource.Replace("\", "/")
    generatedAssets = $GeneratedAssets.Replace("\", "/")
    evidence = $Evidence.Replace("\", "/")
    unreal = if ([string]::IsNullOrWhiteSpace($UnrealProject)) {
        $null
    }
    else {
        [ordered]@{
            project = $UnrealProject.Replace("\", "/")
            engineRoot = $UnrealEngineRoot.Replace("\", "/")
            editorTarget = $UnrealEditorTarget
            configuration = "Development"
            integrationPlugin = "CRDDIRIntegration"
        }
    }
}
if (-not [string]::IsNullOrWhiteSpace($AssetSource)) {
    $config["assetSource"] = $AssetSource.Replace("\", "/")
}
Install-ManagedFile (
    Join-Path $resolvedProjectRoot "crdd-ir.config.json"
) (($config | ConvertTo-Json) + [Environment]::NewLine)

Install-ManagedBlock "AGENTS.md" "AGENTS.md.template"
Install-ManagedBlock "CLAUDE.md" "CLAUDE.md.template"
Install-ManagedBlock ".github\copilot-instructions.md" "copilot-instructions.md.template"

if (-not [string]::IsNullOrWhiteSpace($UnrealProject)) {
    $unrealProjectPath = Join-Path $resolvedProjectRoot $UnrealProject
    if (-not (Test-Path -LiteralPath $unrealProjectPath -PathType Leaf)) {
        throw "Unreal project not found: $unrealProjectPath"
    }
    $unrealRoot = Split-Path -Parent $unrealProjectPath
    $pluginSource = Join-Path $installerRoot "templates\unreal\CRDDIRIntegration"
    $pluginTarget = Join-Path $unrealRoot "Plugins\CRDDIRIntegration"
    Get-ChildItem -LiteralPath $pluginSource -File -Recurse | ForEach-Object {
        $pluginPrefix = [System.IO.Path]::GetFullPath($pluginSource).TrimEnd("\", "/") +
            [System.IO.Path]::DirectorySeparatorChar
        $pluginRelative = $_.FullName.Substring($pluginPrefix.Length)
        Install-ManagedFile (
            Join-Path $pluginTarget $pluginRelative
        ) (Get-Content -LiteralPath $_.FullName -Raw)
    }

    $pythonSource = Join-Path $installerRoot "templates\unreal\import_generated_assets.py"
    $pythonTarget = Join-Path $resolvedProjectRoot "tools\crdd-import-generated-assets.py"
    Install-ManagedFile $pythonTarget (Get-Content -LiteralPath $pythonSource -Raw)
}

$gitignorePath = Join-Path $resolvedProjectRoot ".gitignore"
$gitignore = if (Test-Path -LiteralPath $gitignorePath) {
    Get-Content -LiteralPath $gitignorePath -Raw
}
else {
    ""
}
if ($gitignore -notmatch "(?m)^/\.crdd-ir/$") {
    $gitignore = $gitignore.TrimEnd() + [Environment]::NewLine + "/.crdd-ir/" + [Environment]::NewLine
    Write-Utf8File $gitignorePath $gitignore
}

$installManifest = [ordered]@{
    protocol = "crdd-ir/install-manifest-v0.1"
    toolVersion = $toolVersion
    installedAtUtc = [DateTime]::UtcNow.ToString("o")
    files = @($installedEntries | Sort-Object path)
}
Write-Utf8File $manifestPath (($installManifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine)

Write-Host "Installed CRDD-IR project integration into $resolvedProjectRoot"
Write-Host "Next: git submodule add <CRDD-IR repository URL> $ToolRoot"
Write-Host "Then: .\tools\crdd-ir.ps1 check"
