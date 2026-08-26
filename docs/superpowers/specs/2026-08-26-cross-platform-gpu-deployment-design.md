# Cross-Platform GPU Deployment Design

**Date:** 2026-08-26

**Status:** Approved for implementation

## Goal

Run OpenShorts fully on the Linux Kubernetes machine `hinzky` while retaining portable GPU acceleration across Windows and Linux hosts with NVIDIA and AMD hardware, including safe CPU fallback.

## Current constraints

- The renderer currently enables AMD AMF only on Windows and reports CPU mode on non-Windows platforms.
- The backend image currently uses the ROCm PyTorch image and WSL2/DXG mounts, which are specific to the existing Windows/Docker Desktop setup.
- The Kubernetes manifest uses a Docker Desktop hostPath and hard-coded `docker-desktop` node affinity.
- The remote Linux host exposes an NVIDIA GeForce GTX 1050 Ti, but `nvidia-smi` currently cannot communicate with the installed driver. Driver repair and possible reboot are prerequisites for GPU validation.
- The existing renderer and backend exchange source and output files through the shared output volume. The Kubernetes deployment must preserve that contract.

## Architecture

### Acceleration adapters

The renderer will resolve a platform/vendor adapter once per process. Each adapter supplies:

1. a capability probe;
2. the encoder name and FFmpeg argument transformation required by that backend;
3. the Remotion hardware-render options;
4. a human-readable fallback reason.

The resolver will prefer a usable hardware path and otherwise select the existing CPU path. An explicit disable setting will always select CPU. Hardware selection will never be based solely on OS or GPU presence; the encoder probe must succeed.

### Supported matrix

| Host platform | GPU vendor | AI inference | Video rendering |
| --- | --- | --- | --- |
| Windows | NVIDIA | CUDA when available | NVENC when the FFmpeg probe succeeds |
| Windows | AMD | ROCm/DirectML only where the installed stack supports it; otherwise CPU | AMF when the FFmpeg probe succeeds |
| Linux | NVIDIA | CUDA when available | NVENC when the FFmpeg probe succeeds |
| Linux | AMD | ROCm when the GPU is in the supported matrix; otherwise CPU | VAAPI when `/dev/dri/renderD128` and `h264_vaapi` are usable |
| Any | Any/unknown | CPU fallback | CPU fallback |

The initial implementation must preserve the existing AMD Windows path, add NVIDIA NVENC on Windows and Linux, and add Linux AMD VAAPI only behind a successful device and encoder probe. ROCm is used for Python model inference, not assumed to be the Linux video encoder.

### Kubernetes deployment on `hinzky`

All application components will run in Kubernetes on `hinzky`:

- backend/API and Python worker;
- frontend;
- Remotion renderer;
- PostgreSQL;
- existing MinIO/S3 integration.

The backend and renderer will mount the same output PVC. The PVC will use Linux storage on `hinzky`, not the Docker Desktop path. The renderer will write temporary render outputs and range proxies there; the backend will publish completed artifacts to S3 and retain the existing cache cleanup behavior.

The renderer deployment will request one GPU through the appropriate Kubernetes resource:

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

For AMD nodes, the equivalent device-plugin resource and `/dev/dri` access will be selected by the deployment profile. The base manifest will support NVIDIA on `hinzky`; AMD support remains available for other Linux deployments through the renderer’s runtime adapter and deployment profile.

### Container images

The backend image will be split by accelerator family at build time or selected through an explicit deployment profile:

- CUDA/NVIDIA image for NVIDIA Linux and Windows-compatible container environments;
- ROCm image for supported AMD Linux environments;
- CPU image/profile when no accelerator is requested.

The default Linux deployment for `hinzky` will use the CUDA/NVIDIA profile. WSL2-only `/dev/dxg`, `libdxcore.so`, and `HSA_ENABLE_DXG_DETECTION` settings will not be used in that profile.

The renderer image will remain Linux-compatible and will receive GPU devices through Kubernetes. It will use the system/container FFmpeg binaries appropriate for the selected adapter.

## Data flow and storage

1. The backend/Python worker writes job inputs, manifests, metadata, and intermediate cache files to the shared PVC.
2. The renderer reads source media from that same PVC and writes render outputs and `render-cache` files there.
3. The backend reads the completed renderer output from the shared PVC, uploads the canonical master or clip artifact to S3, and removes only files covered by the existing cleanup rules.
4. PostgreSQL stores job state, version state, and render metrics; it is not used for video bytes.
5. S3 remains the durable published-media store and recovery source for artifacts that the worker already knows how to hydrate.

This shared-volume contract is required for the current backend `publishRenderOutput` path. A later S3-native renderer architecture is out of scope.

## Error handling and observability

- Startup logs will state the selected adapter, encoder, GPU visibility, and fallback reason.
- A failed hardware probe will not prevent startup; it will select CPU and record `acceleration_mode=cpu`.
- A hardware render failure will fail the render job with the existing error status and will not publish a partial artifact.
- Render metrics will continue to report `cpu` or `gpu`; GPU means the hardware adapter was selected and the render passed output validation.
- Kubernetes readiness will verify application dependencies, while a separate GPU smoke test will verify actual device access and encoding.

## Validation

The implementation will include:

- unit tests for adapter selection across all platform/vendor combinations;
- tests for successful probes and CPU fallback on failed probes;
- tests proving the Windows AMF argument rewrite remains unchanged;
- tests proving Linux/NVIDIA uses NVENC without AMF rewriting;
- tests proving Linux/AMD VAAPI is selected only when `/dev/dri` and FFmpeg are usable;
- Dockerfile and Kubernetes configuration tests for the NVIDIA profile, GPU resource request, shared PVC, and removal of WSL2-only mounts from the Linux profile;
- a host smoke test on `hinzky` that verifies `nvidia-smi`, the NVIDIA container runtime, `torch.cuda.is_available()`, Kubernetes GPU allocation, and a real short render;
- output validation for dimensions, frame rate, duration, audio, codec, and color metadata.

## Rollout

1. Build and test images without touching the live workload.
2. Repair and validate the NVIDIA host/runtime on `hinzky`.
3. Apply the GPU device plugin or GPU Operator if the cluster does not already advertise `nvidia.com/gpu`.
4. Apply the Linux Kubernetes storage and application manifests.
5. Run a one-frame/container GPU smoke test, then a short OpenShorts render.
6. Only after both pass, restart the production deployments and verify health, readiness, and render completion.

