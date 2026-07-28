param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [string]$Source = "05_SPEC/01_Behavior_Specification.md",
    [string]$GeneratedSource = "40_Develop/Generated/Source",
    [string]$GeneratedAssets = "40_Develop/Generated/Assets",
    [string]$Evidence = "07_Quality/CRDD_IR",
    [string]$ToolRoot = "tools/CRDD-IR"
)

$ErrorActionPreference = "Stop"
$installerRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path -LiteralPath $resolvedProjectRoot -PathType Container)) {
    throw "Project root not found: $resolvedProjectRoot"
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

    if (Test-Path -LiteralPath $target) {
        $current = Get-Content -LiteralPath $target -Raw
        $start = $current.IndexOf($begin, [System.StringComparison]::Ordinal)
        $finish = $current.IndexOf($end, [System.StringComparison]::Ordinal)
        if ($start -ge 0 -and $finish -ge $start) {
            $finish += $end.Length
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
}

$wrapperSource = Join-Path $installerRoot "templates\crdd-ir.ps1"
$wrapperTarget = Join-Path $resolvedProjectRoot "tools\crdd-ir.ps1"
Write-Utf8File $wrapperTarget (Get-Content -LiteralPath $wrapperSource -Raw)

$config = [ordered]@{
    protocol = "crdd-ir/project-config-v0.1"
    toolRoot = $ToolRoot.Replace("\", "/")
    source = $Source.Replace("\", "/")
    generatedSource = $GeneratedSource.Replace("\", "/")
    generatedAssets = $GeneratedAssets.Replace("\", "/")
    evidence = $Evidence.Replace("\", "/")
}
Write-Utf8File (
    Join-Path $resolvedProjectRoot "crdd-ir.config.json"
) (($config | ConvertTo-Json) + [Environment]::NewLine)

Install-ManagedBlock "AGENTS.md" "AGENTS.md.template"
Install-ManagedBlock "CLAUDE.md" "CLAUDE.md.template"
Install-ManagedBlock ".github\copilot-instructions.md" "copilot-instructions.md.template"

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

Write-Host "Installed CRDD-IR project integration into $resolvedProjectRoot"
Write-Host "Next: git submodule add <CRDD-IR repository URL> $ToolRoot"
Write-Host "Then: .\tools\crdd-ir.ps1 check"
