# AMD ROCm GPU Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend container able to use the AMD Radeon RX 9070 XT through ROCm over WSL2/DXG, while preserving CPU fallback and avoiding any restart or deployment until validation is complete.

**Architecture:** Use AMD's ROCm PyTorch runtime as the image base so the existing `torch.cuda`-compatible device selection can detect the AMD GPU. Expose WSL2's `/dev/dxg` device and `libdxcore.so` to the backend pod, and enable ROCm's DXG detection. Keep the existing CPU fallback for components that are not ROCm-compatible, including the current MediaPipe face-analysis path.

**Tech Stack:** Docker, Kubernetes, Python 3.12, ROCm 7.2.1, PyTorch 2.9.1, WSL2/DXG, pytest/unittest.

---

## Implementation steps

- [ ] Add failing configuration tests covering the ROCm base image, removal of NVIDIA-only dependency pins, and the required DXG/Kubernetes wiring.
- [ ] Run the focused tests and confirm they fail against the current configuration.
- [ ] Update the Docker image to use the ROCm PyTorch runtime without overwriting it with CUDA/NVIDIA wheels.
- [ ] Update the backend deployment to expose `/dev/dxg`, mount `libdxcore.so`, and enable the ROCm WSL2 runtime settings while preserving non-root execution and CPU fallback.
- [ ] Run focused tests, the existing runtime tests, and Python compilation checks.
- [ ] Pull/build the image and run an elevated GPU smoke test that verifies `torch.cuda.is_available()` and reports the detected Radeon device. Diagnose any runtime incompatibility before deployment.
- [ ] Validate the rendered Kubernetes configuration without restarting the current workload. Deployment/restart remains a separate approval step after the image passes the smoke test.
- [ ] Run GitNexus change detection before any commit; commit only when explicitly requested or when the user confirms the validated change is ready.

## Review checklist

- [ ] Existing `OPENSHORTS_DEVICE=auto` behavior still falls back to CPU when ROCm is unavailable.
- [ ] No NVIDIA CUDA packages remain in the ROCm image dependency path.
- [ ] The live processing pod is not restarted during build or validation.
- [ ] MediaPipe CPU logs are correctly treated as expected unless that separate face-detector path is replaced.
