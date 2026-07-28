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
$editorCmd = Join-Path $UnrealRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$project = Join-Path $repoRoot "examples\unreal\CrddCompilerFixture\CrddCompilerFixture.uproject"
$spec = "examples/place-wall/05_SPEC/01_Behavior_Specification.md"
$fixtureGenerated = "examples/unreal/CrddCompilerFixture/Source/CrddCompilerFixture/Generated"
$evidenceDir = "examples/place-wall/07_Quality/CRDD_IR"
$runId = [Guid]::NewGuid().ToString("N")
$reportDir = Join-Path $repoRoot ".crdd-ir\reports\$runId"
$reportPath = Join-Path $reportDir "index.json"

foreach ($requiredPath in @($buildTool, $editorCmd, $project)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Unreal path not found: $requiredPath"
    }
}

function Assert-LastExitCode([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

Write-Host "[1/7] Node contract tests"
& npm.cmd test
Assert-LastExitCode "Node contract tests"

Write-Host "[2/7] Compile and validate CRDD Markdown"
& node src/cli.ts check $spec
Assert-LastExitCode "CRDD source validation"

Write-Host "[3/7] Generate Conformance Bundle"
& node src/cli.ts test bundle $spec --out generated/place-wall.conformance.json
Assert-LastExitCode "Conformance Bundle generation"

Write-Host "[4/7] Generate Unreal C++"
& node src/cli.ts generate unreal $spec --out-dir generated/unreal
Assert-LastExitCode "Unreal reference generation"
& node src/cli.ts generate unreal $spec --out-dir $fixtureGenerated
Assert-LastExitCode "Unreal fixture generation"
& node src/cli.ts generate assets $spec --out-dir generated/assets
Assert-LastExitCode "3D asset generation"

Write-Host "[5/7] Build Unreal fixture"
& $buildTool CrddCompilerFixtureEditor Win64 $Configuration $project -WaitMutex -NoHotReload
Assert-LastExitCode "Unreal build"

Write-Host "[6/7] Run Unreal Automation Test"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
& $editorCmd `
    $project `
    "-ExecCmds=Automation RunTests CRDD.PlaceWall.Conformance" `
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

Write-Host "[7/7] Generate traceability and execution evidence"
& node src/cli.ts generate evidence $spec --out-dir $evidenceDir --unreal-report $reportPath
Assert-LastExitCode "Evidence generation"

Write-Host "CRDD Unreal verification succeeded."
Write-Host "Raw Unreal report: $reportPath"
Write-Host "Evidence: $(Join-Path $repoRoot $evidenceDir)"
