param(
    [string]$UnrealRoot = $env:CRDD_UNREAL_ROOT,
    [string]$Configuration = "Development"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($UnrealRoot)) {
    $UnrealRoot = "C:\Program Files\Epic Games\UE_5.8"
}

$buildTool = Join-Path $UnrealRoot "Engine\Build\BatchFiles\Build.bat"
$runUat = Join-Path $UnrealRoot "Engine\Build\BatchFiles\RunUAT.bat"
$editorCmd = Join-Path $UnrealRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$project = Join-Path $repoRoot "examples\unreal\CrddCompilerFixture\CrddCompilerFixture.uproject"
$assetImportScript = Join-Path $repoRoot "examples\unreal\CrddCompilerFixture\Scripts\import_generated_assets.py"
$integrationPluginSource = Join-Path $repoRoot "templates\unreal\CRDDIRIntegration"
$integrationPluginTarget = Join-Path (
    Split-Path -Parent $project
) "Plugins\CRDDIRIntegration"
$spec = "examples/create-entity/05_SPEC/01_Behavior_Specification.md"
$updateEntitySpec = "examples/update-entity/05_SPEC/01_Behavior_Specification.md"
$fixtureGenerated = "examples/unreal/CrddCompilerFixture/Source/CrddCompilerFixture/Generated"
$evidenceDir = "examples/create-entity/07_Quality/CRDD_IR"
$runId = [Guid]::NewGuid().ToString("N")
$reportDir = Join-Path $repoRoot ".crdd-ir\reports\$runId"
$reportPath = Join-Path $reportDir "index.json"
$assetImportMarker = Join-Path $reportDir "asset-import-success.json"
$packageDir = Join-Path $repoRoot ".crdd-ir\packages\$runId"
$savedAssetManifest = Join-Path (
    Split-Path -Parent $project
) "Saved\CRDDIR\assets.manifest.json"

foreach ($requiredPath in @(
    $buildTool, $runUat, $editorCmd, $project, $assetImportScript, $integrationPluginSource
)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Unreal path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $integrationPluginTarget | Out-Null
Copy-Item -Path (Join-Path $integrationPluginSource "*") `
    -Destination $integrationPluginTarget -Recurse -Force

function Assert-LastExitCode([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

Write-Host "[1/10] Node contract tests"
& npm.cmd test
Assert-LastExitCode "Node contract tests"

Write-Host "[2/10] Compile and validate CRDD Markdown"
& node src/cli.ts check $spec
Assert-LastExitCode "CRDD source validation"

Write-Host "[3/10] Generate Conformance Bundle"
& node src/cli.ts test bundle $spec --out generated/create-entity.conformance.json
Assert-LastExitCode "Conformance Bundle generation"

Write-Host "[4/10] Generate Unreal C++ and 3D assets"
& node src/cli.ts generate unreal $spec --out-dir generated/unreal --force
Assert-LastExitCode "Unreal reference generation"
& node src/cli.ts batch unreal $spec $updateEntitySpec --out-dir $fixtureGenerated --flat
Assert-LastExitCode "Multi-operation Unreal fixture generation"
& node src/cli.ts generate assets $spec --out-dir generated/assets --force
Assert-LastExitCode "3D asset generation"
New-Item -ItemType Directory -Force -Path (
    Split-Path -Parent $savedAssetManifest
) | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "generated\assets\assets.manifest.json") `
    -Destination $savedAssetManifest -Force

Write-Host "[5/10] Build Unreal Editor fixture"
& $buildTool CrddCompilerFixtureEditor Win64 $Configuration $project -WaitMutex -NoHotReload -NoUBA
Assert-LastExitCode "Unreal build"

Write-Host "[6/10] Import generated 3D assets"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$env:CRDD_ASSET_IMPORT_MARKER = $assetImportMarker
try {
    & $editorCmd `
        $project `
        "-ExecutePythonScript=$assetImportScript" `
        -unattended `
        -nop4 `
        -NullRHI `
        -nosplash `
        -NoSound
}
finally {
    Remove-Item Env:CRDD_ASSET_IMPORT_MARKER -ErrorAction SilentlyContinue
}
Assert-LastExitCode "Generated 3D asset import"
if (-not (Test-Path -LiteralPath $assetImportMarker)) {
    throw "Generated 3D asset import did not produce its success marker: $assetImportMarker"
}

Write-Host "[7/10] Run Unreal Automation Tests"
& $editorCmd `
    $project `
    "-ExecCmds=Automation RunTests CRDD." `
    "-TestExit=Automation Test Queue Empty" `
    -unattended `
    -nop4 `
    -NullRHI `
    -nosplash `
    -NoSound `
    "-ReportExportPath=$reportDir" `
    -log
Assert-LastExitCode "Unreal Automation Test"
if (-not (Test-Path -LiteralPath $reportPath)) {
    throw "Unreal Automation Test did not produce a report: $reportPath"
}

Write-Host "[8/10] Build Game Shipping target"
& $buildTool CrddCompilerFixture Win64 Shipping $project -WaitMutex -NoHotReload -NoUBA
Assert-LastExitCode "Unreal Shipping build"

Write-Host "[9/10] Cook and package generated runtime assets"
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
    "-map=/Game/CRDD/Generated/CreateEntityScene" `
    -utf8output
Assert-LastExitCode "Unreal Shipping cook and package"

Write-Host "[10/10] Generate traceability and execution evidence"
& node src/cli.ts generate evidence $spec --out-dir $evidenceDir --unreal-report $reportPath
Assert-LastExitCode "Evidence generation"

Write-Host "CRDD Unreal verification succeeded."
Write-Host "Raw Unreal report: $reportPath"
Write-Host "Evidence: $(Join-Path $repoRoot $evidenceDir)"
Write-Host "Shipping package: $packageDir"
