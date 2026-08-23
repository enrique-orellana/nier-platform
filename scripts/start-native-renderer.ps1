param(
    [string]$FfmpegPath = "",
    [string]$OutputDir = "D:\openshorts-docker-data\workdir",
    [int]$Port = 13101,
    [string]$HardwareVideoBitrate = "40M"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\")).Path
$renderServiceRoot = Join-Path $repoRoot "render-service"
$bundlePath = Join-Path $repoRoot "remotion"
$nativeBinaryRoot = Join-Path $renderServiceRoot ".native-renderer\binaries"
$wrapperSource = Join-Path $renderServiceRoot "tools\ffmpeg-amd-wrapper\main.go"
$wrapperPath = Join-Path $nativeBinaryRoot "ffmpeg.exe"
$bundledFfmpegPath = Join-Path $renderServiceRoot "node_modules\@remotion\compositor-win32-x64-msvc\ffmpeg.exe"
$bundledRemotionPath = Join-Path $renderServiceRoot "node_modules\@remotion\compositor-win32-x64-msvc\remotion.exe"

function Require-File {
    param([string]$Path, [string]$Description)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description was not found: $Path"
    }
}

if (-not $FfmpegPath) {
    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if (-not $ffmpegCommand) {
        throw "FFmpeg was not found. Pass -FfmpegPath with the AMD-capable ffmpeg.exe path."
    }
    $FfmpegPath = $ffmpegCommand.Source
}

$FfmpegPath = (Resolve-Path -LiteralPath $FfmpegPath).Path
$ffprobePath = Join-Path (Split-Path -Parent $FfmpegPath) "ffprobe.exe"
$goCommand = Get-Command go.exe -ErrorAction SilentlyContinue
if (-not $goCommand) {
    throw "Go was not found. It is required once to build the FFmpeg dispatch wrapper."
}

Require-File $bundledFfmpegPath "Remotion's bundled FFmpeg"
Require-File $bundledRemotionPath "Remotion's native executable"
Require-File $ffprobePath "The host ffprobe executable"
New-Item -ItemType Directory -Force -Path $nativeBinaryRoot | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Push-Location $renderServiceRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Could not build the render service."
    }
} finally {
    Pop-Location
}

& $goCommand.Source build -o $wrapperPath $wrapperSource
if ($LASTEXITCODE -ne 0) {
    throw "Could not build the AMD FFmpeg dispatch wrapper."
}
Copy-Item -LiteralPath $ffprobePath -Destination (Join-Path $nativeBinaryRoot "ffprobe.exe") -Force
Copy-Item -LiteralPath $bundledRemotionPath -Destination (Join-Path $nativeBinaryRoot "remotion.exe") -Force

$env:PORT = [string]$Port
$env:OUTPUT_DIR = (Resolve-Path -LiteralPath $OutputDir).Path
$env:PATH = "$(Split-Path -Parent $FfmpegPath);$env:PATH"
$env:REMOTION_BUNDLE_PATH = $bundlePath
$env:RENDER_HARDWARE_ACCELERATION = "if-possible"
$env:RENDER_FFMPEG_PATH = $FfmpegPath
$env:RENDER_FFMPEG_DIRECTORY = $nativeBinaryRoot
$env:RENDER_HARDWARE_VIDEO_BITRATE = $HardwareVideoBitrate
$env:OPENSHORTS_HOST_FFMPEG_PATH = $FfmpegPath
$env:OPENSHORTS_BUNDLED_FFMPEG_PATH = $bundledFfmpegPath

Write-Host "Starting native renderer on http://127.0.0.1:$Port"
Write-Host "Output directory: $($env:OUTPUT_DIR)"
Write-Host "AMD hardware acceleration: opt-in with CPU fallback"
& node (Join-Path $renderServiceRoot "dist\server.js")
