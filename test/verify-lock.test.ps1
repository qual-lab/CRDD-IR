$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$lockScript = Join-Path $repoRoot "scripts\verify-lock.ps1"
$root = Join-Path $repoRoot ".crdd-ir\verify-lock-test"
$project = Join-Path $root "Fixture.uproject"
$events = Join-Path $root "events.txt"
$first = $null
$second = $null

if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
[System.IO.File]::WriteAllText($project, "{}")
[System.IO.File]::WriteAllText($events, "")

try {
    $runHolder = {
        param($lockPath, $projectPath, $metadataPath, $eventsPath, $label, $hold)
        $ErrorActionPreference = "Stop"
        Invoke-Expression (Get-Content -LiteralPath $lockPath -Raw)
        $lock = Enter-CrddVerifyLock `
            -ProjectPath $projectPath `
            -MetadataRoot $metadataPath `
            -TimeoutSeconds 10
        try {
            Add-Content -LiteralPath $eventsPath -Value "${label}:start"
            if ($hold -gt 0) {
                Start-Sleep -Milliseconds $hold
            }
            Add-Content -LiteralPath $eventsPath -Value "${label}:end"
        }
        finally {
            Exit-CrddVerifyLock -Lock $lock
        }
    }
    $first = Start-Job `
        -ScriptBlock $runHolder `
        -ArgumentList $lockScript, $project, $root, $events, "first", 500
    $firstStarted = $false
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $startupDeadline) {
        if ($first.State -eq "Failed") {
            Receive-Job -Job $first
            throw "First verify lock holder failed during startup"
        }
        if ([string](Get-Content -LiteralPath $events -Raw) -match "first:start") {
            $firstStarted = $true
            break
        }
        Start-Sleep -Milliseconds 50
    }
    if (-not $firstStarted) {
        $details = (($first.ChildJobs[0].Error | Out-String) + (Receive-Job -Job $first -ErrorAction SilentlyContinue | Out-String))
        throw "First verify lock holder did not start before the timeout (state=$($first.State)): $details"
    }
    $second = Start-Job `
        -ScriptBlock $runHolder `
        -ArgumentList $lockScript, $project, $root, $events, "second", 0
    Wait-Job -Job $first, $second | Out-Null
    if ($first.State -ne "Completed" -or $second.State -ne "Completed") {
        Receive-Job -Job $first, $second
        throw "Verify lock holder failed: first=$($first.State), second=$($second.State)"
    }
    Receive-Job -Job $first, $second | Out-Null
    $actual = @(Get-Content -LiteralPath $events | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $expected = @("first:start", "first:end", "second:start", "second:end")
    if (($actual -join "|") -ne ($expected -join "|")) {
        throw "Verify lock did not serialize processes: $($actual -join ', ')"
    }
    if (Test-Path -LiteralPath (Join-Path $root ".crdd-ir\verify.lock.json")) {
        throw "Verify lock owner metadata was not cleaned up"
    }
    $eventPath = Join-Path $root ".crdd-ir\verify-events.jsonl"
    $lockEvents = @(
        Get-Content -LiteralPath $eventPath |
            ForEach-Object { $_ | ConvertFrom-Json }
    )
    $eventNames = @($lockEvents | ForEach-Object { $_.event })
    foreach ($requiredEvent in @(
        "verify.lock.waiting",
        "verify.lock.acquired",
        "verify.lock.released"
    )) {
        if ($requiredEvent -notin $eventNames) {
            throw "Missing machine-readable verify event: $requiredEvent"
        }
    }
    $acquiredEvents = @(
        $lockEvents | Where-Object { $_.event -eq "verify.lock.acquired" }
    )
    if ($acquiredEvents.Count -ne 2 -or
        @($acquiredEvents | Where-Object {
            $_.waitMilliseconds -isnot [long] -and
            $_.waitMilliseconds -isnot [int]
        }).Count -ne 0) {
        throw "Verify acquired events must record waitMilliseconds"
    }
    Write-Host "CRDD verify lock integration test succeeded."
}
finally {
    @($first, $second) |
        Where-Object { $null -ne $_ } |
        Remove-Job -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
