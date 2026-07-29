param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [string[]]$Source = @("contracts/operation.md"),
    [string[]]$Target = @("typescript"),
    [string]$GeneratedRoot = "generated/crdd-ir",
    [string]$Evidence = "evidence/crdd-ir",
    [string]$ToolRoot = "tools/CRDD-IR"
)

$ErrorActionPreference = "Stop"
$installerRoot = Split-Path -Parent $PSScriptRoot
$root = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "Project root not found: $root"
}

function Write-Utf8([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-TextHash([string]$Content) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes)) -replace "-", "").ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

$targets = [ordered]@{}
foreach ($id in $Target) {
    if ($id -notmatch "^[a-z][a-z0-9-]*$") { throw "Invalid target ID: $id" }
    $targets[$id] = [ordered]@{
        output = ($GeneratedRoot.TrimEnd("/", "\") + "/" + $id).Replace("\", "/")
    }
}

$config = [ordered]@{
    protocol = "crdd-ir/project-config-v0.2"
    toolRoot = $ToolRoot.Replace("\", "/")
    sources = @($Source | ForEach-Object { $_.Replace("\", "/") })
    evidence = $Evidence.Replace("\", "/")
    targets = $targets
}
$configContent = ($config | ConvertTo-Json -Depth 8) + "`n"
$wrapperContent = Get-Content -LiteralPath (Join-Path $installerRoot "templates\crdd-ir.ps1") -Raw
Write-Utf8 (Join-Path $root "crdd-ir.config.json") $configContent
Write-Utf8 (Join-Path $root "tools\crdd-ir.ps1") $wrapperContent

$manifest = [ordered]@{
    protocol = "crdd-ir/install-manifest-v0.2"
    toolVersion = (Get-Content -LiteralPath (Join-Path $installerRoot "package.json") -Raw |
        ConvertFrom-Json).version
    files = @(
        [ordered]@{ path = "crdd-ir.config.json"; kind = "file"; sha256 = Get-TextHash $configContent },
        [ordered]@{ path = "tools/crdd-ir.ps1"; kind = "file"; sha256 = Get-TextHash $wrapperContent }
    )
}
Write-Utf8 (Join-Path $root ".crdd-ir.install.json") (($manifest | ConvertTo-Json -Depth 8) + "`n")
Write-Host "Installed target-neutral CRDD-IR integration in $root"
