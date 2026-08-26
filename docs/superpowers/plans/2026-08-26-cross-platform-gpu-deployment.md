# Cross-Platform GPU Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-platform NVIDIA/AMD GPU detection with CPU fallback and deploy the complete OpenShorts stack on the Linux Kubernetes machine `hinzky`.

**Architecture:** The renderer will use a runtime acceleration adapter that probes NVENC, Windows AMF, or Linux VAAPI before enabling hardware encoding. Backend image variants will keep ROCm for supported AMD deployments and add an official CUDA PyTorch image for NVIDIA deployments. Kubernetes will use a Linux shared PVC and NVIDIA GPU resource requests for the `hinzky` profile; all published media remains in S3.

**Tech Stack:** TypeScript, Remotion, FFmpeg, Python/PyTorch, Docker, Kubernetes, NVIDIA Container Toolkit, NVIDIA device plugin/GPU Operator, Vitest, pytest, Go tests.

---

## Files and responsibilities

- Modify `render-service/src/hardware-acceleration.ts`: define adapter selection, FFmpeg probes, NVENC/AMF/VAAPI argument overrides, and fallback reasons.
- Modify `render-service/src/hardware-acceleration.test.ts`: cover every OS/vendor path, probe success/failure, and argument rewriting.
- Modify `render-service/src/render-worker.ts`: pass the selected adapter’s override and report the selected mode without assuming AMF.
- Modify `render-service/src/render-worker.test.ts`: verify the selected adapter is forwarded to Remotion and metrics preserve CPU/GPU semantics.
- Modify `render-service/src/master-policy.ts` and `render-service/src/master-policy.test.ts`: make hardware options encoder-neutral while preserving the master output contract.
- Create `Dockerfile.cuda`: build the backend from `pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime` with the existing Go control plane and Python dependencies.
- Create `Dockerfile.rocm-linux`: build the backend from ROCm without WSL2/DXG-only packages or mounts.
- Modify `tests/test_rocm_deployment_config.py`: keep ROCm Linux coverage and add CUDA profile assertions.
- Modify `k8s/openshorts.yaml`: replace Docker Desktop storage and DXG mounts with Linux storage, shared backend/renderer PVC mounts, NVIDIA GPU requests, and Linux renderer settings.
- Modify `k8s/openshorts.env.example`: document the Linux/NVIDIA defaults and hardware mode controls.
- Modify `scripts/deploy-remote.ps1` and `scripts/deploy-remote.sh`: build the selected backend profile, apply the Linux manifest, and avoid assuming an AMD/WSL2 backend.
- Modify `scripts/deploy-local.ps1` and `scripts/deploy-local.sh`: preserve local profile behavior while allowing explicit backend image selection.
- Create `scripts/verify-gpu-linux.sh`: run host/container/Kubernetes GPU checks and a focused render smoke test without silently treating CPU fallback as GPU success.
- Modify `k8s/README.md` and `docs/native-windows-amd-renderer.md`: document Linux NVIDIA, Linux AMD, Windows NVIDIA, and Windows AMD deployment profiles.
- Create or modify focused deployment tests under `tests/`: validate manifest paths, resource requests, shared storage, and profile selection.

## Task 1: Add renderer acceleration adapters

**Files:**
- Modify: `render-service/src/hardware-acceleration.ts`
- Test: `render-service/src/hardware-acceleration.test.ts`

- [ ] **Step 1: Write failing adapter tests.** Add tests for:
  - Windows AMD selecting AMF and preserving the current `h264_nvenc` → `h264_amf` rewrite.
  - Windows NVIDIA selecting NVENC without AMF rewriting.
  - Linux NVIDIA selecting NVENC.
  - Linux AMD selecting VAAPI only when `/dev/dri/renderD128` and the VAAPI probe succeed.
  - unknown platforms/vendors and failed probes selecting CPU with a specific reason.
  - explicit `RENDER_HARDWARE_ACCELERATION=disabled` selecting CPU.

- [ ] **Step 2: Run the focused tests and confirm failure.**

Run from `render-service`:

```powershell
npm test -- --run src/hardware-acceleration.test.ts
```

Expected: FAIL because the current implementation only exposes Windows AMF and returns CPU on Linux.

- [ ] **Step 3: Implement the adapter contract.** Replace the AMF-only result with an adapter union containing `vendor`, `encoder`, `hardwareAcceleration`, optional `binariesDirectory`, optional `videoBitrate`, and `ffmpegOverride`. Add injectable command/file probes so unit tests do not require a GPU.

- [ ] **Step 4: Implement probes and overrides.** Probe a one-second synthetic frame with the candidate encoder. Use `h264_nvenc` unchanged for NVIDIA, `h264_amf` for Windows AMD, and `h264_vaapi` with `/dev/dri/renderD128` plus the required `format=nv12,hwupload` filter for Linux AMD. Return CPU when any required executable, device, or encoder check fails.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run:

```powershell
npm test -- --run src/hardware-acceleration.test.ts
```

Expected: PASS for all adapter and fallback cases.

## Task 2: Connect adapters to Remotion rendering and metrics

**Files:**
- Modify: `render-service/src/render-worker.ts`
- Test: `render-service/src/render-worker.test.ts`
- Modify: `render-service/src/master-policy.ts`
- Test: `render-service/src/master-policy.test.ts`

- [ ] **Step 1: Add failing integration assertions.** Extend the worker tests with a mocked NVIDIA adapter and assert `buildRenderOptions` receives the NVENC settings and its override. Assert that the AMF override is used only for the Windows AMD adapter.

- [ ] **Step 2: Remove the AMF-specific worker assumption.** Pass the selected adapter’s generic override into `buildRenderOptions`; preserve `hardwareAcceleration: "required"` only after the adapter probe succeeds. Keep `preserveVideo`, output normalization, and metric values unchanged.

- [ ] **Step 3: Make hardware policy fields encoder-neutral.** Allow `binariesDirectory` and `videoBitrate` to be optional for Linux adapters while retaining the current Windows AMF requirements. Do not alter dimensions, frame rate, color metadata, audio, or the CPU x264 policy.

- [ ] **Step 4: Run renderer tests and build.**

Run from `render-service`:

```powershell
npm test
npm run build
```

Expected: all tests pass and TypeScript compilation succeeds.

## Task 3: Add CUDA and native ROCm backend image profiles

**Files:**
- Create: `Dockerfile.cuda`
- Create: `Dockerfile.rocm-linux`
- Modify: `tests/test_rocm_deployment_config.py`

- [ ] **Step 1: Add image configuration tests.** Assert that the CUDA image uses `pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime`, installs the existing application dependencies without overwriting the base PyTorch build, and does not include WSL2 DXG mounts. Assert that the ROCm Linux image uses the ROCm PyTorch base without installing `rocdxg`.

- [ ] **Step 2: Run the configuration tests and confirm failure.**

Run from the repository root:

```powershell
python -m unittest tests.test_rocm_deployment_config -v
```

Expected: FAIL because the new profile files do not exist.

- [ ] **Step 3: Create the CUDA Dockerfile.** Copy the existing Go build stage and application setup into `Dockerfile.cuda`, use the official CUDA PyTorch runtime base, install FFmpeg and the existing native libraries, preserve UID 1000, preload `yolov8n.pt`, copy the Go API binary, and start `/usr/local/bin/openshorts-api`.

- [ ] **Step 4: Create the native ROCm Linux Dockerfile.** Reuse the same application layers with the ROCm PyTorch base, omit ROCDXG installation and all WSL2-specific assumptions, retain CPU fallback, and keep the same command and output paths.

- [ ] **Step 5: Run profile tests and build both images.**

Run:

```powershell
python -m unittest tests.test_rocm_deployment_config -v
docker build -f Dockerfile.cuda -t openshorts-backend:cuda-local .
docker build -f Dockerfile.rocm-linux -t openshorts-backend:rocm-linux-local .
```

Expected: tests pass; both builds complete successfully.

## Task 4: Convert Kubernetes to the Linux shared-storage/NVIDIA profile

**Files:**
- Modify: `k8s/openshorts.yaml`
- Modify: `k8s/openshorts.env.example`
- Create or modify: `tests/test_linux_kubernetes_deployment.py`

- [ ] **Step 1: Add failing manifest tests.** Assert that the backend and renderer mount the same PVC, no active container references `/dev/dxg`, `libdxcore.so`, or Docker Desktop paths, the renderer requests `nvidia.com/gpu: 1`, and `RENDER_SERVICE_URL` points to the in-cluster renderer service.

- [ ] **Step 2: Run the manifest tests and confirm failure.**

Run:

```powershell
python -m unittest tests.test_linux_kubernetes_deployment -v
```

Expected: FAIL against the current Docker Desktop/DXG manifest.

- [ ] **Step 3: Replace the storage definition.** Use a Linux hostPath/local volume rooted at `/srv/openshorts/workdir` with node affinity for the `hinzky` node and `DirectoryOrCreate`. Keep the PVC name `openshorts-workdir` so backend and renderer continue sharing all source, manifest, master, and `render-cache` files.

- [ ] **Step 4: Update backend and renderer GPU wiring.** Remove WSL2 DXG mounts and privileged settings from the Linux backend profile. Add `nvidia.com/gpu: 1` to the renderer. Keep the backend GPU request disabled by default so the single GTX 1050 Ti is reserved for rendering; expose a documented optional time-slicing profile if AI inference is later scheduled on the same GPU.

- [ ] **Step 5: Configure Linux renderer defaults.** Set `RENDER_HARDWARE_ACCELERATION=if-possible`, `RENDER_GPU_VENDOR=auto`, `RENDER_HARDWARE_VIDEO_BITRATE=40M`, and preserve the renderer metrics endpoint. Keep frontend `/render` and `/output` routes pointed at `openshorts-renderer`.

- [ ] **Step 6: Run manifest validation.**

Run:

```powershell
python -m unittest tests.test_linux_kubernetes_deployment -v
kubectl apply --dry-run=client -f k8s/openshorts.yaml
```

Expected: tests pass and Kubernetes accepts the manifest syntax.

## Task 5: Update deployment helpers and documentation

**Files:**
- Modify: `scripts/deploy-remote.ps1`
- Modify: `scripts/deploy-remote.sh`
- Modify: `scripts/deploy-local.ps1`
- Modify: `scripts/deploy-local.sh`
- Modify: `k8s/README.md`
- Modify: `docs/native-windows-amd-renderer.md`

- [ ] **Step 1: Add profile selection tests.** Test that remote deployment defaults to `Dockerfile.cuda`, local Windows AMD defaults to the existing ROCm/WSL2-compatible Dockerfile, and an explicit backend Dockerfile override is passed through without changing renderer deployment behavior.

- [ ] **Step 2: Add backend profile selection.** Add `OPENSHORTS_BACKEND_DOCKERFILE` and matching script parameters. Build and tag one backend image using the selected Dockerfile; do not build a renderer image with a Windows-only assumption.

- [ ] **Step 3: Remove unconditional WSL2 assumptions from remote deployment.** Ensure remote deployment updates only the Linux configuration and does not add DXG mounts, Docker Desktop node affinity, or `host.docker.internal` renderer URLs.

- [ ] **Step 4: Document the four platform/vendor profiles.** Document the image/profile selection, required host runtime, expected CPU fallback, shared PVC path, and the fact that Linux AMD video encoding uses VAAPI while ROCm is for supported AI workloads.

- [ ] **Step 5: Run shell/script syntax checks.**

Run:

```powershell
bash -n scripts/deploy-remote.sh
bash -n scripts/deploy-local.sh
```

Expected: both scripts parse successfully.

## Task 6: Add Linux GPU verification and run repository validation

**Files:**
- Create: `scripts/verify-gpu-linux.sh`
- Test: `tests/test_linux_gpu_verification.py`

- [ ] **Step 1: Add failing verifier tests.** Assert that the verifier checks host `nvidia-smi`, a CUDA container, the Kubernetes `nvidia.com/gpu` capacity, and a renderer health/render request; assert that it exits nonzero when any check fails.

- [ ] **Step 2: Implement the verifier.** Use strict shell mode, run `nvidia-smi`, run an NVIDIA CUDA sample container with `--gpus all`, inspect the selected Kubernetes node’s GPU capacity, then submit a one-frame render and poll until it is done. Print the selected acceleration mode and fail if the render reports CPU when GPU was required.

- [ ] **Step 3: Run focused repository tests.**

Run:

```powershell
python -m unittest discover -s tests -p 'test_*gpu*.py' -v
python -m unittest tests.test_runtime_acceleration -v
go test ./...
```

Expected: all focused tests and Go tests pass.

- [ ] **Step 4: Run frontend checks if dashboard files changed.**

Run from `dashboard`:

```powershell
npm run format
npm run format:check
npm run lint
```

Expected: all commands pass.

## Task 7: Validate and deploy on `hinzky`

**Files:**
- No source files; remote host and cluster state only.

- [ ] **Step 1: Confirm host prerequisites without mutation.** Check Ubuntu version, GPU model, kernel, `nvidia-smi`, Docker GPU runtime, kubeconfig/context, and cluster node labels/capacity.

- [ ] **Step 2: Repair NVIDIA host support if required.** Install a compatible NVIDIA driver and NVIDIA Container Toolkit, configure the container runtime, restart the runtime, and reboot `hinzky` only if the driver requires it. Follow NVIDIA’s official toolkit and Kubernetes device-plugin procedures.

- [ ] **Step 3: Validate the GPU stack before OpenShorts.** Run `nvidia-smi`, `docker run --rm --gpus all ... nvidia-smi`, deploy/verify the NVIDIA device plugin or GPU Operator, and confirm the node advertises `nvidia.com/gpu`.

- [ ] **Step 4: Build/push the CUDA backend and renderer images.** Use the remote registry/tag configuration, then apply the Linux Kubernetes manifest and config map.

- [ ] **Step 5: Run smoke tests before restart.** Verify backend `/health` and `/ready`, renderer `/health`, shared PVC visibility, `torch.cuda.is_available()`, FFmpeg `h264_nvenc`, and a short end-to-end render.

- [ ] **Step 6: Restart and verify the complete stack.** Restart backend, frontend, renderer, and PostgreSQL only after smoke tests pass. Run rollout status, service health checks, and one final render; record whether the result used GPU or CPU fallback.

## Final GitNexus and handoff checks

- [ ] Run `git diff --check` and inspect the complete diff.
- [ ] Run GitNexus `detect_changes({repo: "openshorts", scope: "all"})` and investigate unexpected symbols or processes.
- [ ] Stage only files belonging to this feature and commit with a focused message.
- [ ] Report the commit, image tags, Kubernetes namespace/context, GPU validation result, and any remaining CPU fallback limitations.

