# Native Windows AMD renderer

The Docker containers remain the backend and UI. The render worker can run natively on Windows so FFmpeg can use AMD AMF. GPU mode is opt-in and falls back to CPU when the AMF probe fails.

From the repository root, manage all components with:

```powershell
.\scripts\manage-local.ps1 -Action Update
.\scripts\manage-local.ps1 -Action Start
.\scripts\manage-local.ps1 -Action Status
.\scripts\manage-local.ps1 -Action Stop
```

`Restart` runs all three update/start phases in the correct order. It stops containers without removing volumes.

Target one or more components with `-Component`:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component renderer
.\scripts\manage-local.ps1 -Action Restart -Component backend
.\scripts\manage-local.ps1 -Action Restart -Component backend,frontend
```

`renderer` manages both the native AMD renderer and the Docker renderer. Use `native-renderer` or `docker-renderer` to target only one of them. Available Docker components are `db`, `backend`, and `frontend`.

To start only the worker manually:

```powershell
.\scripts\start-native-renderer.ps1 -FfmpegPath C:\path\to\ffmpeg.exe
```

The host FFmpeg must expose `h264_amf`. The script builds the small FFmpeg dispatcher, copies the Remotion helper binaries, and starts the worker on port `13101`. It does not cache or transcode source media.

Point the Docker backend at the native worker by setting this in `.env`:

```dotenv
RENDER_SERVICE_URL=http://host.docker.internal:13101
```

Then restart the backend container. The native worker uses the shared Windows output directory (`D:\openshorts-docker-data\workdir` by default), so the backend can publish completed files normally.
