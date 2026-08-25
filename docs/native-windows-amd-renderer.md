# Native Windows AMD renderer

The Docker containers remain the backend and UI. The render worker can run natively on Windows so FFmpeg can use AMD AMF. GPU mode is opt-in and falls back to CPU when the AMF probe fails.

From the repository root, manage all components with:

```powershell
.\scripts\manage-local.ps1 -Action Update
.\scripts\manage-local.ps1 -Action Start
.\scripts\manage-local.ps1 -Action Status
.\scripts\manage-local.ps1 -Action Stop
```

### Applying code changes to the live local app

After changing application code, commit the verified change (unless the user
explicitly requests no commit), then rebuild and restart the affected component
so the running app uses the new code:

```powershell
.\scripts\manage-local.ps1 -Action Restart
```

For a focused update, use `-Component frontend`, `-Component backend`, or
`-Component renderer`. `-Action Update` only rebuilds and does not apply the
change to already-running services. Confirm the result with:

```powershell
.\scripts\manage-local.ps1 -Action Status
```

`Restart` runs all three update/start phases in the correct order. It stops containers without removing volumes.

Target one or more components with `-Component`:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component renderer
.\scripts\manage-local.ps1 -Action Restart -Component backend
.\scripts\manage-local.ps1 -Action Restart -Component backend,frontend
```

`renderer` manages the native AMD renderer. The Docker renderer service is intentionally commented out in Compose. Available Docker components are `db`, `backend`, and `frontend`. Starting or restarting `renderer` also recreates the backend so it cannot retain the obsolete `http://renderer:3100` URL; startup verifies the backend's effective renderer configuration before reporting success.

To start only the worker manually (GPU is preferred with CPU fallback):

```powershell
.\scripts\start-native-renderer.ps1 -FfmpegPath C:\path\to\ffmpeg.exe
```

GPU acceleration is enabled by default with CPU fallback when AMF is unavailable. Use
`-HardwareAcceleration disabled` to force CPU rendering.

The host FFmpeg must expose `h264_amf`. The script builds the small FFmpeg dispatcher, copies the Remotion helper binaries, and starts the worker on port `13101`. It does not cache or transcode source media.

Point the Docker backend at the native worker by setting this in `.env`:

```dotenv
RENDER_SERVICE_URL=http://host.docker.internal:13101
```

Then restart the backend container. The native worker uses the shared Windows output directory (`D:\openshorts-docker-data\workdir` by default), so the backend can publish completed files normally.
