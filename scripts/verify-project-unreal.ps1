param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [ValidateRange(1, 86400)]
    [int]$LockTimeoutSeconds = 1800
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$configPath = Join-Path $resolvedProjectRoot "crdd-ir.config.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.protocol -ne "crdd-ir/project-config-v0.2") {
    throw "Unsupported CRDD-IR project config protocol: $($config.protocol)"
}
if ($null -eq $config.targets.unreal) {
    throw "Unreal integration is not configured in $configPath"
}
$targetConfig = $config.targets.unreal
$unreal = $targetConfig.options
if ($null -eq $unreal) {
    throw "Unreal target requires target.options for project verification"
}

function Resolve-ProjectPath([string]$RelativePath) {
    return [System.IO.Path]::GetFullPath((Join-Path $resolvedProjectRoot $RelativePath))
}

function Assert-ExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

$project = Resolve-ProjectPath $unreal.project
. (Join-Path $PSScriptRoot "verify-lock.ps1")
$verifyLock = Enter-CrddVerifyLock `
    -ProjectPath $project `
    -MetadataRoot $resolvedProjectRoot `
    -TimeoutSeconds $LockTimeoutSeconds
$verifySucceeded = $false
try {
$engineRoot = [System.IO.Path]::GetFullPath($unreal.engineRoot)
$buildTool = Join-Path $engineRoot "Engine\Build\BatchFiles\Build.bat"
$runUat = Join-Path $engineRoot "Engine\Build\BatchFiles\RunUAT.bat"
$editorCmd = Join-Path $engineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$manifest = Resolve-ProjectPath (
    Join-Path ([string]$unreal.assetsOutput) "assets.manifest.json"
)
$sources = @($config.sources | ForEach-Object { Resolve-ProjectPath ([string]$_) })
$evidence = Resolve-ProjectPath $config.evidence
$editorProfile = Resolve-ProjectPath ([string]$targetConfig.profile)
$shippingProfile = Resolve-ProjectPath ([string]$unreal.shippingProfile)
$pythonScript = Join-Path $resolvedProjectRoot "tools\crdd-import-generated-assets.py"
$projectName = [System.IO.Path]::GetFileNameWithoutExtension($project)
$editorTarget = if ([string]::IsNullOrWhiteSpace($unreal.editorTarget)) {
    "${projectName}Editor"
}
else {
    $unreal.editorTarget
}
$gameTarget = if ([string]::IsNullOrWhiteSpace($unreal.gameTarget)) {
    $projectName
}
else {
    $unreal.gameTarget
}
$configuration = if ([string]::IsNullOrWhiteSpace($unreal.configuration)) {
    "Development"
}
else {
    $unreal.configuration
}

foreach ($requiredPath in @(
    $project, $buildTool, $runUat, $editorCmd, $manifest, $pythonScript,
    $editorProfile, $shippingProfile
)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Unreal verification path not found: $requiredPath"
    }
}

$runId = [Guid]::NewGuid().ToString("N")
$runDir = Join-Path $resolvedProjectRoot ".crdd-ir\reports\$runId"
$reportPath = Join-Path $runDir "index.json"
$markerPath = Join-Path $runDir "asset-import-success.json"
$packageDir = Join-Path $resolvedProjectRoot ".crdd-ir\packages\$runId"
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
            @{ Path = "/Game/CRDD/Generated/$($removed.id)"; Extension = ".uasset" },
            @{ Path = "/Game/CRDD/Generated/$($removed.id)Material"; Extension = ".uasset" },
            @{ Path = "/Game/CRDD/Generated/$($removed.previewScene)"; Extension = ".umap" }
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

& $buildTool $gameTarget Win64 Shipping $project -WaitMutex -NoHotReload -NoUBA
Assert-ExitCode "CRDD Unreal Shipping build"

$assetManifest = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$runtimeMap = "/Game/CRDD/Generated/$([string]$assetManifest.scene.id)"
if ([string]::IsNullOrWhiteSpace($runtimeMap) -or
    -not $runtimeMap.StartsWith("/Game/", [System.StringComparison]::Ordinal)) {
    throw "Generated asset manifest must declare a /Game/ runtime scene"
}
& $runUat BuildCookRun `
    "-project=$project" `
    -noP4 `
    -platform=Win64 `
    -clientconfig=Shipping `
    -skipbuild `
    -cook `
    -stage `
    -pak `
    -archive `
    "-archivedirectory=$packageDir" `
    "-map=$runtimeMap" `
    -utf8output
Assert-ExitCode "CRDD Unreal Shipping cook and package"

$cli = Join-Path $toolRoot "src\cli.ts"
foreach ($source in $sources) {
    $json = (& node $cli compile $source 2>$null) -join [Environment]::NewLine
    Assert-ExitCode "CRDD operation inspection"
    $operationId = [string](($json | ConvertFrom-Json).operation.id)
    & node $cli generate evidence `
        $source --out-dir (Join-Path $evidence $operationId)
    Assert-ExitCode "CRDD evidence generation for $operationId"
    & node $cli unreal evidence $source `
        --profile $shippingProfile `
        --automation-report $reportPath `
        --package-dir $packageDir `
        --verify-events $verifyLock.EventPath `
        --verify-run-id $verifyLock.Id `
        --out (Join-Path $evidence "$operationId\unreal-build-evidence.json")
    Assert-ExitCode "Normalized Unreal build evidence for $operationId"
}

Write-Host "CRDD Unreal project verification succeeded."
Write-Host "Report: $reportPath"
Write-Host "Shipping package: $packageDir"
$verifySucceeded = $true
}
finally {
    Exit-CrddVerifyLock `
        -Lock $verifyLock `
        -Outcome $(if ($verifySucceeded) { "succeeded" } else { "failed" })
}
