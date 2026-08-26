# Cross-Platform GPU Deployment Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Run OpenShorts fully on the Linux Kubernetes machine hinzky while supporting automatic GPU acceleration for Windows/Linux NVIDIA and AMD hosts with CPU fallback.

**Architecture:** Replace the renderer's Windows-AMF-only decision with a probed adapter layer for NVIDIA NVENC, Windows AMD AMF, and Linux AMD VAAPI. Keep backend AI images selectable by runtime profile: CUDA/NVIDIA for hinzky, ROCm for supported AMD Linux/WSL2 environments, and CPU fallback where no accelerator is usable. Make Kubernetes backend and renderer share a Linux PVC and request the NVIDIA GPU through Kubernetes.

**Tech Stack:** TypeScript/Remotion, Node.js, FFmpeg, Python/PyTorch, Go, Docker, Kubernetes, NVIDIA Container Toolkit/device plugin, ROCm, pytest, Vitest, Go tests.

---

## File map

- Modify render-service/src/hardware-acceleration.ts — generic platform/vendor adapter selection and FFmpeg probes.
- Modify render-service/src/hardware-acceleration.test.ts — adapter and fallback coverage.
- Modify render-service/src/master-policy.ts and render-service/src/master-policy.test.ts — adapter-neutral hardware options.
- Modify render-service/src/render-worker.ts and render-service/src/render-worker.test.ts — use the selected adapter and verify metrics.
- Modify Dockerfile — preserve the current ROCm/WSL2 image profile.
- Create Dockerfile.cuda — CUDA/PyTorch backend image for NVIDIA hosts.
- Create Dockerfile.rocm-linux — native Linux ROCm/PyTorch backend image without WSL2/DXG dependencies.
- Modify tests/test_rocm_deployment_config.py and create tests/test_cuda_deployment_config.py.
- Modify k8s/openshorts.yaml and k8s/openshorts.env.example — Linux storage, GPU resources, and renderer routing.
- Modify scripts/deploy-remote.ps1, scripts/deploy-remote.sh, scripts/deploy-local.ps1, and scripts/deploy-local.sh — runtime profile selection.
- Create tests/test_linux_kubernetes_deployment_config.py and tests/test_deployment_scripts.py.
- Create scripts/check-gpu-linux.sh and docs/linux-nvidia-kubernetes.md.
- Modify k8s/README.md.

## Task 1: Add the cross-platform renderer acceleration adapter

**Files:**
- Modify: render-service/src/hardware-acceleration.ts
- Test: render-service/src/hardware-acceleration.test.ts
- Modify: render-service/src/master-policy.ts
- Test: render-service/src/master-policy.test.ts

- [ ] Step 1: Write failing tests for Linux NVIDIA, Windows NVIDIA, Windows AMD AMF, Linux AMD VAAPI, failed-probe CPU fallback, and explicit disable. The tests must inject platform, environment, file-existence, and probe functions; they must not call real FFmpeg or the filesystem.
- [ ] Step 2: Run from render-service: npm test -- --run src/hardware-acceleration.test.ts src/master-policy.test.ts. Expected: failure because the current resolver supports only Windows AMF.
- [ ] Step 3: Implement these public contracts in hardware-acceleration.ts:

    export type RenderEncoder = "h264_nvenc" | "h264_amf" | "h264_vaapi";
    export type RenderVendor = "nvidia" | "amd";
    export type AcceleratorPreference = "auto" | "nvidia" | "amd" | "cpu";

    export type RenderAcceleration =
      | { mode: "gpu"; vendor: RenderVendor; encoder: RenderEncoder;
          hardwareAcceleration: "required"; videoBitrate: `${number}${"k" | "K" | "M"}`;
          ffmpegOverride: FfmpegOverrideFn; binariesDirectory?: string;
          vaapiDevice?: string }
      | { mode: "cpu"; reason: string };

- [ ] Step 4: Implement selection rules: disabled or cpu selects CPU; Windows NVIDIA probes h264_nvenc; Windows AMD probes h264_amf and keeps the existing AMF rewrite; Linux NVIDIA probes h264_nvenc without rewriting it; Linux AMD requires /dev/dri/renderD128 or RENDER_VAAPI_DEVICE and probes h264_vaapi; auto tries visible NVIDIA, then the platform's AMD adapter, then CPU. Every hardware adapter must pass a one-second testsrc2 encode. Linux VAAPI must inject format=nv12,hwupload exactly once and remove x264-only flags.
- [ ] Step 5: Update master-policy hardware options so binariesDirectory and vaapiDevice are optional adapter fields. Keep output dimensions, audio, color, and validation settings unchanged.
- [ ] Step 6: Run npm test -- --run src/hardware-acceleration.test.ts src/master-policy.test.ts. Expected: PASS, including the existing AMF tests.

## Task 2: Connect adapter selection to rendering and metrics

**Files:**
- Modify: render-service/src/render-worker.ts
- Test: render-service/src/render-worker.test.ts

- [ ] Step 1: Add a failing test where the resolver returns a GPU NVIDIA adapter and assert renderMedia receives hardwareAcceleration=required, videoBitrate, and the NVIDIA override; assert the metrics payload reports acceleration_mode=gpu.
- [ ] Step 2: Run from render-service: npm test -- --run src/render-worker.test.ts. Expected: failure because the worker currently creates the AMF override for every GPU result.
- [ ] Step 3: Pass the adapter-provided ffmpegOverride, optional binariesDirectory, optional vaapiDevice, and videoBitrate into buildRenderOptions. Log vendor, encoder, and fallback reason without logging credentials or source URLs.
- [ ] Step 4: Run npm test and npm run build from render-service. Expected: PASS and a successful TypeScript build.

## Task 3: Add CUDA and native ROCm backend image profiles

**Files:**
- Modify: Dockerfile
- Create: Dockerfile.cuda
- Modify: tests/test_rocm_deployment_config.py
- Create: tests/test_cuda_deployment_config.py

- [ ] Step 1: Add failing tests. Dockerfile.cuda must contain pytorch/pytorch:2.9.1-cuda12.6-cudnn9-runtime, OPENSHORTS_GPU_RUNTIME=cuda, NVIDIA_VISIBLE_DEVICES=all, and NVIDIA_DRIVER_CAPABILITIES=compute,utility,video; it must not contain /dev/dxg or libdxcore.so. ROCm tests must preserve the existing WSL2 profile and validate the native rocm-linux profile has no DXG dependency.
- [ ] Step 2: Run python -m pytest -q tests/test_cuda_deployment_config.py tests/test_rocm_deployment_config.py. Expected: failure because Dockerfile.cuda and native profile handling do not exist.
- [ ] Step 3: Create Dockerfile.cuda by preserving the Go builder, application dependencies, UID-1000 user, output/uploads/Ultralytics directories, preloaded YOLO model, and openshorts-api command from Dockerfile, using pytorch/pytorch:2.9.1-cuda12.6-cudnn9-runtime as the runtime base. Do not add torch pins to requirements.txt because the base image supplies CUDA PyTorch.
- [ ] Step 4: Create Dockerfile.rocm-linux from the existing backend build layout with the ROCm PyTorch base, no ROCDXG package, and no WSL2-specific files. Make the deployment profile handling distinguish rocm-wsl, rocm-linux, cuda, and cpu. rocm-wsl alone may install ROCDXG; rocm-linux uses /dev/kfd and /dev/dri; cuda uses NVIDIA runtime injection; cpu uses the CUDA image with OPENSHORTS_DEVICE=cpu but does not request a Kubernetes GPU. Keep OPENSHORTS_DEVICE=auto fallback for accelerator profiles.
- [ ] Step 5: Run python -m pytest -q tests/test_cuda_deployment_config.py tests/test_rocm_deployment_config.py tests/test_runtime_acceleration.py and python -m compileall -q main.py python_worker.py runtime_acceleration.py. Expected: PASS.

## Task 4: Update Kubernetes for Linux NVIDIA and shared storage

**Files:**
- Modify: k8s/openshorts.yaml
- Modify: k8s/openshorts.env.example
- Create: tests/test_linux_kubernetes_deployment_config.py

- [ ] Step 1: Add failing tests requiring no WSL2 mounts, Linux storage at /var/lib/openshorts/workdir, node affinity for hinzky, shared openshorts-workdir PVC on backend and renderer, nvidia.com/gpu=1 on backend and renderer, NVIDIA runtime environment, renderer RENDER_SERVICE_URL, and ingress routes for /render and /output.
- [ ] Step 2: Run python -m pytest -q tests/test_linux_kubernetes_deployment_config.py. Expected: failure against the Docker Desktop/WSL2 manifest.
- [ ] Step 3: Replace the Docker Desktop PV with a local PV using storageClassName openshorts-local, hostPath /var/lib/openshorts/workdir with DirectoryOrCreate, and kubernetes.io/hostname affinity value hinzky. Preserve the existing 50Gi PVC name.
- [ ] Step 4: Remove backend /dev/dxg, libdxcore.so, privileged, SYS_PTRACE, and HSA_ENABLE_DXG_DETECTION settings. Add nvidia.com/gpu: 1 plus NVIDIA_VISIBLE_DEVICES=all and NVIDIA_DRIVER_CAPABILITIES=compute,utility,video to backend and renderer. Keep frontend CPU-only.
- [ ] Step 5: Add the renderer /render ingress path while retaining /output. Keep /api/render as the backend proxy endpoint.
- [ ] Step 6: Run python -m pytest -q tests/test_linux_kubernetes_deployment_config.py and kubectl apply --dry-run=client -f k8s/openshorts.yaml. Expected: PASS and valid Kubernetes YAML.

## Task 5: Make deployment scripts select the runtime profile

**Files:**
- Modify: scripts/deploy-remote.ps1
- Modify: scripts/deploy-remote.sh
- Modify: scripts/deploy-local.ps1
- Modify: scripts/deploy-local.sh
- Test: tests/test_deployment_scripts.py

- [ ] Step 1: Add failing tests for OPENSHORTS_GPU_RUNTIME values cuda, rocm-linux, rocm-wsl, and cpu; remote default cuda; local default preserving the current ROCm/Windows flow; and build selection for Dockerfile.cuda versus Dockerfile.
- [ ] Step 2: Run python -m pytest -q tests/test_deployment_scripts.py. Expected: failure because the scripts always build the root Dockerfile and assume the Docker Desktop profile.
- [ ] Step 3: Add explicit validated environment variables OPENSHORTS_GPU_RUNTIME, OPENSHORTS_NODE_NAME, and OPENSHORTS_STORAGE_PATH. Remote defaults are cuda, hinzky, and /var/lib/openshorts/workdir. The remote script must build Dockerfile.cuda for cuda, the root image for rocm-wsl, Dockerfile.rocm-linux for rocm-linux, and Dockerfile.cuda with OPENSHORTS_DEVICE=cpu for cpu.
- [ ] Step 4: Make scripts set RENDER_ACCELERATOR and RENDER_HARDWARE_ACCELERATION in the generated ConfigMap, preserve S3/AI overrides, and omit GPU resource requests only for cpu. Keep image values and allowed profiles explicit; do not interpolate arbitrary shell commands.
- [ ] Step 5: Run the script tests and parse PowerShell files with pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/deploy-remote.ps1)) | Out-Null" and the equivalent local command. Expected: PASS.

## Task 6: Validate and document Linux NVIDIA prerequisites

**Files:**
- Create: scripts/check-gpu-linux.sh
- Create: docs/linux-nvidia-kubernetes.md
- Modify: k8s/README.md

- [ ] Step 1: Create a read-only smoke script that runs nvidia-smi, a Docker CUDA nvidia-smi container, node GPU allocatable inspection, torch.cuda.is_available() in the backend pod, and ffmpeg -encoders in the renderer pod. It must not install, delete, restart, or reboot anything.
- [ ] Step 2: Document Ubuntu 24.04 host setup: repair/install the NVIDIA driver and reboot if needed; install NVIDIA Container Toolkit; configure Docker/containerd with nvidia-ctk; install the NVIDIA device plugin or GPU Operator; verify nvidia.com/gpu; create /var/lib/openshorts/workdir owned by UID/GID 1000; then run the smoke script.
- [ ] Step 3: Document the current hinzky blocker: nvidia-smi fails until the host driver is operational. Include the official NVIDIA Toolkit and device-plugin links and the exact Kubernetes resource request.
- [ ] Step 4: Document the render canary: submit a short render, poll /api/render/{renderId} until done, verify the S3/output artifact, and confirm /api/render-metrics reports acceleration_mode=gpu.

## Task 7: Full verification, commit, and remote rollout

**Files:**
- Review all files from Tasks 1–6.

- [ ] Step 1: Run python -m pytest -q tests/test_cuda_deployment_config.py tests/test_rocm_deployment_config.py tests/test_linux_kubernetes_deployment_config.py tests/test_deployment_scripts.py tests/test_runtime_acceleration.py; run npm test and npm run build in render-service; run go test ./... in backend-go; run git diff --check.
- [ ] Step 2: Run GitNexus detect_changes with repo openshorts and scope all. Review changed symbols and affected processes; investigate anything outside renderer acceleration, image profiles, Kubernetes deployment, and validation.
- [ ] Step 3: Stage only the implementation files and commit with git commit -m "feat: support cross-platform GPU deployments".
- [ ] Step 4: Run the read-only Linux GPU smoke checks on hinzky. If nvidia-smi or Kubernetes GPU allocation fails, stop before restarting application deployments and report the exact prerequisite.
- [ ] Step 5: Deploy all components with OPENSHORTS_GPU_RUNTIME=cuda, wait for backend/frontend/renderer rollouts, run the render canary, and report health, readiness, GPU mode, shared PVC, and artifact publication results.
