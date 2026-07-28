param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($ProjectRoot)
$configPath = Join-Path $root "crdd-ir.config.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "CRDD-IR project config not found: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$installer = Join-Path $PSScriptRoot "install-project.ps1"
$arguments = @{
    ProjectRoot = $root
    Source = @($config.source)
    GeneratedSource = [string]$config.generatedSource
    GeneratedAssets = [string]$config.generatedAssets
    Evidence = [string]$config.evidence
    ToolRoot = [string]$config.toolRoot
    ForceManagedUpdate = $true
}
if (-not [string]::IsNullOrWhiteSpace([string]$config.assetSource)) {
    $arguments.AssetSource = [string]$config.assetSource
}
if ($null -ne $config.unreal) {
    $arguments.UnrealProject = [string]$config.unreal.project
    $arguments.UnrealEngineRoot = [string]$config.unreal.engineRoot
    $arguments.UnrealEditorTarget = [string]$config.unreal.editorTarget
    if (-not [string]::IsNullOrWhiteSpace([string]$config.unreal.gameTarget)) {
        $arguments.UnrealGameTarget = [string]$config.unreal.gameTarget
    }
}
& $installer @arguments
Write-Host "Repaired CRDD-IR managed integration in $root"
