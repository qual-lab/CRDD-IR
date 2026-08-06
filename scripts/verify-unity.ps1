[CmdletBinding()]
param(
    [string]$UnityEditor = "C:\Program Files\Unity\Hub\Editor\6000.5.5f1\Editor\Unity.exe",
    [string]$Project = "",
    [string]$Source = "",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
if (-not $Project) {
    $Project = Join-Path $repository "examples\unity\CrddCompilerFixture"
}
if (-not $Source) {
    $Source = Join-Path $repository "test\fixtures\contracts\numeric-boundary.md"
}
if (-not $Profile) {
    $Profile = Join-Path $repository "examples\unity\profiles\unity-6-il2cpp.json"
}
if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) {
    throw "Unity Editor was not found: $UnityEditor"
}

$runtime = Join-Path $Project "Assets\CRDD\Runtime\Generated"
$tests = Join-Path $Project "Assets\CRDD\Tests\Generated"
$staging = Join-Path $repository ".crdd-ir\unity-verification\generated"
$results = Join-Path $repository ".crdd-ir\unity-verification"
$build = Join-Path $results "Player\CrddCompilerFixture.exe"
$portableSource = Join-Path $repository "test\fixtures\contracts\portable-contract.md"
$compoundEvidenceSource = Join-Path $repository "test\fixtures\contracts\compound-evidence-contract.md"
$conditionalEffectsSource = Join-Path $repository "test\fixtures\contracts\conditional-effects.md"
$multiFieldConformanceSource = Join-Path $repository "test\fixtures\contracts\multi-field-conformance.md"
$resultSemanticsSource = Join-Path $repository "test\fixtures\contracts\collection-result-events.md"
$sources = @($Source, $portableSource, $compoundEvidenceSource, $conditionalEffectsSource, $multiFieldConformanceSource, $resultSemanticsSource) |
    ForEach-Object { [System.IO.Path]::GetFullPath($_) } |
    Select-Object -Unique

New-Item -ItemType Directory -Force -Path $runtime, $tests, $staging, $results | Out-Null
Get-ChildItem -LiteralPath $runtime -Filter "*.cs" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
Get-ChildItem -LiteralPath $tests -Filter "*.cs" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force

& node (Join-Path $repository "src\cli.ts") batch unity @sources `
    --profile $Profile `
    --out-dir $staging `
    --flat `
    --force
if ($LASTEXITCODE -ne 0) {
    throw "CRDD Unity generation failed: $LASTEXITCODE"
}

Get-ChildItem -LiteralPath $staging -Filter "*.cs" -File | ForEach-Object {
    $destination = if ($_.Name.EndsWith(".Tests.cs", [StringComparison]::Ordinal)) {
        $tests
    } else {
        $runtime
    }
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Force
}

$testProcess = Start-Process -FilePath $UnityEditor -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
    "-batchmode",
    "-nographics",
    "-projectPath", $Project,
    "-runTests",
    "-testPlatform", "EditMode",
    "-testResults", (Join-Path $results "editmode-results.xml"),
    "-logFile", (Join-Path $results "editmode.log")
)
if ($testProcess.ExitCode -ne 0) {
    throw "Unity EditMode tests failed: $($testProcess.ExitCode)"
}
$testResults = Join-Path $results "editmode-results.xml"
if (-not (Test-Path -LiteralPath $testResults -PathType Leaf)) {
    throw "Unity did not produce EditMode test results: $testResults"
}
[xml]$testReport = Get-Content -LiteralPath $testResults
$testRun = $testReport."test-run"
if ($testRun.result -ne "Passed" -or [int]$testRun.failed -ne 0) {
    throw "Unity EditMode tests did not pass: result=$($testRun.result), failed=$($testRun.failed)"
}

$buildProcess = Start-Process -FilePath $UnityEditor -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
    "-batchmode",
    "-nographics",
    "-quit",
    "-projectPath", $Project,
    "-executeMethod", "CrddFixture.BuildPlayer",
    "-crddBuildPath", $build,
    "-logFile", (Join-Path $results "il2cpp-build.log")
)
if ($buildProcess.ExitCode -ne 0) {
    throw "Unity IL2CPP build failed: $($buildProcess.ExitCode)"
}

if (-not (Test-Path -LiteralPath $build -PathType Leaf)) {
    throw "Unity IL2CPP build did not produce: $build"
}
$buildLog = Join-Path $results "il2cpp-build.log"
if (-not (Select-String -LiteralPath $buildLog -SimpleMatch "Build Finished, Result: Success." -Quiet)) {
    throw "Unity IL2CPP build success marker was not found: $buildLog"
}
Write-Host "Unity EditMode tests passed: $($testRun.passed)/$($testRun.total)"
Write-Host "Unity IL2CPP build passed: $build"
