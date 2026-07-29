function Write-CrddVerifyEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EventPath,
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Event
    )

    $eventScope = [System.IO.Path]::GetFullPath($EventPath).ToLowerInvariant()
    $eventBytes = [System.Text.Encoding]::UTF8.GetBytes($eventScope)
    $eventAlgorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $eventHash = ([BitConverter]::ToString(
            $eventAlgorithm.ComputeHash($eventBytes)
        ) -replace "-", "")
    }
    finally {
        $eventAlgorithm.Dispose()
    }

    $eventMutex = [System.Threading.Mutex]::new(
        $false,
        "Local\CRDDIR-VerifyEvents-$eventHash"
    )
    $eventAcquired = $false
    try {
        try {
            $eventAcquired = $eventMutex.WaitOne([TimeSpan]::FromSeconds(30))
        }
        catch [System.Threading.AbandonedMutexException] {
            $eventAcquired = $true
        }
        if (-not $eventAcquired) {
            throw "CRDD_VERIFY_EVENT_TIMEOUT: could not append '$EventPath'"
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EventPath) |
            Out-Null
        $line = ($Event | ConvertTo-Json -Compress) + [Environment]::NewLine
        [System.IO.File]::AppendAllText(
            $EventPath,
            $line,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
    finally {
        if ($eventAcquired) {
            $eventMutex.ReleaseMutex()
        }
        $eventMutex.Dispose()
    }
}

function Enter-CrddVerifyLock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectPath,
        [Parameter(Mandatory = $true)]
        [string]$MetadataRoot,
        [ValidateRange(1, 86400)]
        [int]$TimeoutSeconds = 1800
    )

    $scope = [System.IO.Path]::GetFullPath($ProjectPath).Replace("\", "/").ToLowerInvariant()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($scope)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = ([BitConverter]::ToString($algorithm.ComputeHash($bytes)) -replace "-", "")
    }
    finally {
        $algorithm.Dispose()
    }

    $mutex = [System.Threading.Mutex]::new($false, "Local\CRDDIR-Verify-$hash")
    $lockPath = Join-Path $MetadataRoot ".crdd-ir\verify.lock.json"
    $eventPath = Join-Path $MetadataRoot ".crdd-ir\verify-events.jsonl"
    $id = [Guid]::NewGuid().ToString("N")
    $waitStartedAt = [DateTime]::UtcNow
    Write-CrddVerifyEvent -EventPath $eventPath -Event ([ordered]@{
        protocol = "crdd-ir/verify-event-v0.1"
        event = "verify.lock.waiting"
        runId = $id
        pid = $PID
        timestamp = $waitStartedAt.ToString("o")
        project = $scope
        timeoutSeconds = $TimeoutSeconds
    })
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $acquired = $false
    $recoveredAbandoned = $false
    try {
        try {
            $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
        }
        catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
            $recoveredAbandoned = $true
        }
        $stopwatch.Stop()
        if (-not $acquired) {
            Write-CrddVerifyEvent -EventPath $eventPath -Event ([ordered]@{
                protocol = "crdd-ir/verify-event-v0.1"
                event = "verify.lock.timeout"
                runId = $id
                pid = $PID
                timestamp = [DateTime]::UtcNow.ToString("o")
                project = $scope
                waitMilliseconds = $stopwatch.ElapsedMilliseconds
            })
            $owner = if (Test-Path -LiteralPath $lockPath) {
                Get-Content -LiteralPath $lockPath -Raw
            }
            else {
                "owner metadata unavailable"
            }
            throw "CRDD_VERIFY_LOCK_TIMEOUT: project '$scope' is locked: $owner"
        }

        $acquiredAt = [DateTime]::UtcNow
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockPath) | Out-Null
        [System.IO.File]::WriteAllText(
            $lockPath,
            (([ordered]@{
                protocol = "crdd-ir/verify-lock-v0.1"
                id = $id
                pid = $PID
                startedAt = $acquiredAt.ToString("o")
                project = $scope
                command = [Environment]::CommandLine
            } | ConvertTo-Json) + [Environment]::NewLine),
            [System.Text.UTF8Encoding]::new($false)
        )
        Write-CrddVerifyEvent -EventPath $eventPath -Event ([ordered]@{
            protocol = "crdd-ir/verify-event-v0.1"
            event = "verify.lock.acquired"
            runId = $id
            pid = $PID
            timestamp = $acquiredAt.ToString("o")
            project = $scope
            waitMilliseconds = $stopwatch.ElapsedMilliseconds
            recoveredAbandoned = $recoveredAbandoned
        })
        return [PSCustomObject]@{
            Mutex = $mutex
            LockPath = $lockPath
            EventPath = $eventPath
            Id = $id
            Project = $scope
            AcquiredAt = $acquiredAt
            WaitMilliseconds = $stopwatch.ElapsedMilliseconds
            RecoveredAbandoned = $recoveredAbandoned
        }
    }
    catch {
        if ($acquired) {
            $mutex.ReleaseMutex()
        }
        $mutex.Dispose()
        throw
    }
}

function Exit-CrddVerifyLock {
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Lock,
        [ValidateSet("succeeded", "failed")]
        [string]$Outcome = "succeeded"
    )
    try {
        $holdMilliseconds = [long](
            ([DateTime]::UtcNow - $Lock.AcquiredAt).TotalMilliseconds
        )
        Write-CrddVerifyEvent -EventPath $Lock.EventPath -Event ([ordered]@{
            protocol = "crdd-ir/verify-event-v0.1"
            event = "verify.lock.released"
            runId = $Lock.Id
            pid = $PID
            timestamp = [DateTime]::UtcNow.ToString("o")
            project = $Lock.Project
            holdMilliseconds = $holdMilliseconds
            outcome = $Outcome
        })
        if (Test-Path -LiteralPath $Lock.LockPath) {
            $owner = Get-Content -LiteralPath $Lock.LockPath -Raw | ConvertFrom-Json
            if ($owner.id -eq $Lock.Id) {
                Remove-Item -LiteralPath $Lock.LockPath -Force
            }
        }
    }
    finally {
        $Lock.Mutex.ReleaseMutex()
        $Lock.Mutex.Dispose()
    }
}
