param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$configPath = Join-Path $resolvedProjectRoot "crdd-ir.config.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.protocol -ne "crdd-ir/project-config-v0.1") {
    throw "Unsupported CRDD-IR project config protocol: $($config.protocol)"
}
if ($null -eq $config.unreal) {
    throw "Unreal integration is not configured in $configPath"
}

function Resolve-ProjectPath([string]$RelativePath) {
    return [System.IO.Path]::GetFullPath((Join-Path $resolvedProjectRoot $RelativePath))
}

function Assert-ExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

$project = Resolve-ProjectPath $config.unreal.project
$engineRoot = [System.IO.Path]::GetFullPath($config.unreal.engineRoot)
$buildTool = Join-Path $engineRoot "Engine\Build\BatchFiles\Build.bat"
$editorCmd = Join-Path $engineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$manifest = Resolve-ProjectPath (
    Join-Path $config.generatedAssets "assets.manifest.json"
)
$sources = @($config.source | ForEach-Object { Resolve-ProjectPath ([string]$_) })
$evidence = Resolve-ProjectPath $config.evidence
$pythonScript = Join-Path $resolvedProjectRoot "tools\crdd-import-generated-assets.py"
$projectName = [System.IO.Path]::GetFileNameWithoutExtension($project)
$editorTarget = if ([string]::IsNullOrWhiteSpace($config.unreal.editorTarget)) {
    "${projectName}Editor"
}
else {
    $config.unreal.editorTarget
}
$configuration = if ([string]::IsNullOrWhiteSpace($config.unreal.configuration)) {
    "Development"
}
else {
    $config.unreal.configuration
}

foreach ($requiredPath in @($project, $buildTool, $editorCmd, $manifest, $pythonScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Unreal verification path not found: $requiredPath"
    }
}

$runId = [Guid]::NewGuid().ToString("N")
$runDir = Join-Path $resolvedProjectRoot ".crdd-ir\reports\$runId"
$reportPath = Join-Path $runDir "index.json"
$markerPath = Join-Path $runDir "asset-import-success.json"
$savedManifestDir = Join-Path (Split-Path -Parent $project) "Saved\CRDDIR"
$savedManifest = Join-Path $savedManifestDir "assets.manifest.json"
$previousManifest = Join-Path $savedManifestDir "previous-assets.manifest.json"
New-Item -ItemType Directory -Force -Path $runDir, $savedManifestDir | Out-Null

if (Test-Path -LiteralPath $savedManifest) {
    Copy-Item -LiteralPath $savedManifest -Destination $previousManifest -Force
}
Copy-Item -LiteralPath $manifest -Destination $savedManifest -Force

& $buildTool $editorTarget Win64 $configuration $project -WaitMutex -NoHotReload -NoUBA
Assert-ExitCode "Unreal build"

$env:CRDD_ASSET_MANIFEST = $manifest
$env:CRDD_PREVIOUS_ASSET_MANIFEST = $previousManifest
$env:CRDD_ASSET_IMPORT_MARKER = $markerPath
try {
    & $editorCmd `
        $project `
        "-ExecutePythonScript=$pythonScript" `
        -unattended -nop4 -NullRHI -nosplash -NoSound
}
finally {
    Remove-Item Env:CRDD_ASSET_MANIFEST -ErrorAction SilentlyContinue
    Remove-Item Env:CRDD_PREVIOUS_ASSET_MANIFEST -ErrorAction SilentlyContinue
    Remove-Item Env:CRDD_ASSET_IMPORT_MARKER -ErrorAction SilentlyContinue
}
Assert-ExitCode "Generated asset import"
if (-not (Test-Path -LiteralPath $markerPath)) {
    throw "Generated asset import did not produce success marker: $markerPath"
}

if (Test-Path -LiteralPath $previousManifest) {
    $previous = Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json
    $current = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $currentIds = @($current.assets | ForEach-Object { $_.id })
    $contentRoot = [System.IO.Path]::GetFullPath(
        (Join-Path (Split-Path -Parent $project) "Content")
    )
    foreach ($removed in @($previous.assets | Where-Object { $_.id -notin $currentIds })) {
        $virtualFiles = @(
            @{ Path = "$($removed.unrealDestination)/$($removed.id)"; Extension = ".uasset" },
            @{ Path = "$($removed.unrealDestination)/$($removed.id)Material"; Extension = ".uasset" },
            @{ Path = $removed.previewLevel; Extension = ".umap" }
        )
        foreach ($virtualFile in $virtualFiles) {
            if (-not $virtualFile.Path.StartsWith("/Game/", [System.StringComparison]::Ordinal)) {
                throw "Refusing to clean non-/Game Unreal path: $($virtualFile.Path)"
            }
            $relative = $virtualFile.Path.Substring("/Game/".Length).Replace("/", "\")
            $physical = [System.IO.Path]::GetFullPath(
                (Join-Path $contentRoot ($relative + $virtualFile.Extension))
            )
            if (-not $physical.StartsWith(
                $contentRoot + [System.IO.Path]::DirectorySeparatorChar,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                throw "Refusing to clean Unreal path outside Content: $physical"
            }
            if (Test-Path -LiteralPath $physical) {
                Remove-Item -LiteralPath $physical -Force
                Write-Host "Removed stale generated Unreal file $physical"
            }
        }
    }
}

& $editorCmd `
    $project `
    "-ExecCmds=Automation RunTests CRDD.Integration." `
    "-TestExit=Automation Test Queue Empty" `
    -unattended -nop4 -NullRHI -nosplash -NoSound `
    "-ReportExportPath=$runDir" -log
Assert-ExitCode "CRDD Unreal Automation Test"
if (-not (Test-Path -LiteralPath $reportPath)) {
    throw "Unreal Automation Test did not produce a report: $reportPath"
}

$cli = Join-Path $toolRoot "src\cli.ts"
foreach ($source in $sources) {
    $json = (& node $cli compile $source 2>$null) -join [Environment]::NewLine
    Assert-ExitCode "CRDD operation inspection"
    $operationId = [string](($json | ConvertFrom-Json).operation.id)
    & node $cli generate evidence `
        $source --out-dir (Join-Path $evidence $operationId) --unreal-report $reportPath
    Assert-ExitCode "CRDD evidence generation for $operationId"
}

Write-Host "CRDD Unreal project verification succeeded."
Write-Host "Report: $reportPath"
