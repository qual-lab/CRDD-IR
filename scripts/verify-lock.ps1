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
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
        }
        catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            $owner = if (Test-Path -LiteralPath $lockPath) {
                Get-Content -LiteralPath $lockPath -Raw
            }
            else {
                "owner metadata unavailable"
            }
            throw "CRDD_VERIFY_LOCK_TIMEOUT: project '$scope' is locked: $owner"
        }

        $id = [Guid]::NewGuid().ToString("N")
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockPath) | Out-Null
        [System.IO.File]::WriteAllText(
            $lockPath,
            (([ordered]@{
                protocol = "crdd-ir/verify-lock-v0.1"
                id = $id
                pid = $PID
                startedAt = [DateTime]::UtcNow.ToString("o")
                project = $scope
                command = [Environment]::CommandLine
            } | ConvertTo-Json) + [Environment]::NewLine),
            [System.Text.UTF8Encoding]::new($false)
        )
        return [PSCustomObject]@{
            Mutex = $mutex
            LockPath = $lockPath
            Id = $id
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
        [PSCustomObject]$Lock
    )
    try {
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
