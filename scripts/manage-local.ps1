param(
    [ValidateSet("Update", "Start", "Stop", "Restart", "Status")]
    [string]$Action = "Status",
    [string[]]$Component = @("all"),
    [string]$FfmpegPath = "",
    [string]$OutputDir = "D:\openshorts-docker-data\workdir",
    [int]$NativeRendererPort = 13101,
    [string]$HardwareVideoBitrate = "40M"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\")).Path
$composeFile = Join-Path $repoRoot "docker-compose.yml"
$nativeRendererScript = Join-Path $repoRoot "scripts\start-native-renderer.ps1"
$nativeLogDir = Join-Path $repoRoot ".native-renderer-logs"
$nativeStdout = Join-Path $nativeLogDir "stdout.log"
$nativeStderr = Join-Path $nativeLogDir "stderr.log"
$selectedComponents = @($Component | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$allowedComponents = @("all", "native-renderer", "docker-renderer", "renderer", "backend", "frontend", "db")
$invalidComponents = @($selectedComponents | Where-Object { $_ -notin $allowedComponents })
if ($invalidComponents.Count -gt 0) {
    throw "Unknown component(s): $($invalidComponents -join ', '). Allowed values: $($allowedComponents -join ', ')."
}

if ($selectedComponents -contains "all" -and $selectedComponents.Count -gt 1) {
    throw "Use 'all' by itself or specify individual components."
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Invoke-Compose {
    param([string[]]$Arguments)
    & docker compose --project-directory $repoRoot --file $composeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE."
    }
}

function Selects-Component {
    param([string]$Name)
    return $selectedComponents -contains "all" -or $selectedComponents -contains $Name
}

function Uses-NativeRenderer {
    return (Selects-Component "native-renderer") -or (Selects-Component "renderer")
}

function Get-DockerServices {
    $services = @()
    if (Selects-Component "db") { $services += "db" }
    if (Selects-Component "backend") { $services += "backend" }
    if (Selects-Component "frontend") { $services += "frontend" }
    if ((Selects-Component "docker-renderer") -or (Selects-Component "renderer")) {
        $services += "renderer"
    }
    return @($services | Select-Object -Unique)
}

function Get-NativeRendererListener {
    Get-NetTCPConnection -LocalPort $NativeRendererPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Wait-ForNativeRenderer {
    param([int]$TimeoutSeconds = 90)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$NativeRendererPort/health" -TimeoutSec 2
            if ($health.ok -eq $true) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)

    throw "Native renderer did not become healthy on port $NativeRendererPort. See $nativeStdout and $nativeStderr."
}

function Start-NativeRenderer {
    if (Get-NativeRendererListener) {
        Write-Host "Native renderer is already listening on port $NativeRendererPort."
        return
    }

    Require-Command "powershell.exe"
    New-Item -ItemType Directory -Force -Path $nativeLogDir | Out-Null

    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $nativeRendererScript,
        "-OutputDir", $OutputDir,
        "-Port", [string]$NativeRendererPort,
        "-HardwareVideoBitrate", $HardwareVideoBitrate
    )
    if ($FfmpegPath) {
        $arguments += @("-FfmpegPath", $FfmpegPath)
    }

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $nativeStdout `
        -RedirectStandardError $nativeStderr `
        -WindowStyle Hidden | Out-Null

    Wait-ForNativeRenderer
    Write-Host "Native AMD renderer is healthy on http://127.0.0.1:$NativeRendererPort."
}

function Stop-NativeRenderer {
    $listener = Get-NativeRendererListener
    if (-not $listener) {
        Write-Host "Native renderer is not running."
        return
    }

    $listenerPid = $listener.OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid"
    Stop-Process -Id $listenerPid -Force

    if ($process.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
        if ($parent -and $parent.CommandLine -like "*start-native-renderer.ps1*") {
            Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Native renderer stopped."
}

function Update-Components {
    $dockerServices = Get-DockerServices
    if ($dockerServices.Count -gt 0) {
        Require-Command "docker"
        $composeArguments = @("build") + $dockerServices
        Invoke-Compose $composeArguments
    }

    if (Uses-NativeRenderer) {
        Require-Command "npm"
        Require-Command "go.exe"
        Push-Location (Join-Path $repoRoot "render-service")
        try {
            npm run build
            if ($LASTEXITCODE -ne 0) {
                throw "Render-service TypeScript build failed."
            }
        } finally {
            Pop-Location
        }
    }

    Write-Host "Selected components are up to date: $($selectedComponents -join ', ')."
}

function Start-Components {
    $dockerServices = Get-DockerServices
    if (Uses-NativeRenderer) {
        Start-NativeRenderer
    }

    if ($dockerServices.Count -gt 0) {
        Require-Command "docker"
        if (Uses-NativeRenderer) {
            $env:RENDER_SERVICE_URL = "http://host.docker.internal:$NativeRendererPort"
        } else {
            $env:RENDER_SERVICE_URL = "http://renderer:3100"
        }
        $composeArguments = @("up", "-d") + $dockerServices
        Invoke-Compose $composeArguments
    }

    if (Uses-NativeRenderer -and $dockerServices.Count -gt 0) {
        try {
            docker exec openshorts-backend python -c "import urllib.request; urllib.request.urlopen('http://host.docker.internal:$NativeRendererPort/health', timeout=5)"
            if ($LASTEXITCODE -ne 0) {
                throw "Docker backend cannot reach the native renderer."
            }
        } catch {
            throw "Docker backend cannot reach the native renderer: $($_.Exception.Message)"
        }
    }

    Write-Host "Selected components are running: $($selectedComponents -join ', ')."
}

function Stop-Components {
    $dockerServices = Get-DockerServices
    if (Uses-NativeRenderer) {
        Stop-NativeRenderer
    }
    if ($dockerServices.Count -gt 0) {
        Require-Command "docker"
        Invoke-Compose (@("stop") + $dockerServices)
    }
    Write-Host "Selected components are stopped. Docker volumes were preserved."
}

function Show-Status {
    $dockerServices = Get-DockerServices
    if (Uses-NativeRenderer) {
        $listener = Get-NativeRendererListener
        if ($listener) {
            Write-Host "Native renderer: running on port $NativeRendererPort (PID $($listener.OwningProcess))"
        } else {
            Write-Host "Native renderer: stopped"
        }
    }
    if ($dockerServices.Count -gt 0) {
        Require-Command "docker"
        Invoke-Compose (@("ps") + $dockerServices)
    }
}

switch ($Action) {
    "Update" { Update-Components }
    "Start" { Start-Components }
    "Stop" { Stop-Components }
    "Restart" {
        Stop-Components
        Update-Components
        Start-Components
    }
    "Status" { Show-Status }
}
