# Linux NVIDIA Kubernetes deployment

The remote profile runs the backend, renderer, and frontend on the Linux
Kubernetes cluster on `hinzky`. Backend and renderer share the
`openshorts-workdir` PVC at `/var/lib/openshorts/workdir`; backend and renderer
request one `nvidia.com/gpu` each. The frontend remains CPU-only.

## Host prerequisites

On Ubuntu 24.04, install a supported NVIDIA driver for the host GPU and reboot
when the driver installation requires it. Verify the host first:

```bash
nvidia-smi
```

Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
configure Docker/containerd with `nvidia-ctk`, and verify the container runtime:

```bash
docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi
```

Install the [NVIDIA Kubernetes device plugin](https://github.com/NVIDIA/k8s-device-plugin)
or NVIDIA GPU Operator. Kubernetes must report an allocatable GPU and the pod
spec must contain:

```yaml
resources:
  requests:
    nvidia.com/gpu: "1"
```

Create the shared workdir and grant it to the application UID/GID:

```bash
sudo install -d -o 1000 -g 1000 -m 0770 /var/lib/openshorts/workdir
```

The checked-in smoke test is read-only with respect to software and workloads:

```bash
bash ./scripts/check-gpu-linux.sh
```

It checks `nvidia-smi`, Docker GPU injection, Kubernetes allocatable GPU,
`torch.cuda.is_available()` in the backend pod, and NVENC availability in the
renderer pod. It does not install packages, delete data, restart workloads, or
reboot the host.

## Current hinzky status

The host is reachable and exposes an NVIDIA GeForce GTX 1050 Ti on PCIe, but
the current host-side `nvidia-smi` check fails because the NVIDIA kernel driver
is not operational. Do not deploy the GPU profile until `nvidia-smi` succeeds
on the host and in the Docker test container. The driver repair may require
administrator approval and a reboot.

The renderer uses NVENC only after a one-second FFmpeg probe succeeds. The
[NVIDIA Video Codec SDK support matrix](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-application-note/index.html)
should be checked against the installed driver and GPU. If the probe fails,
the renderer records a CPU fallback reason rather than claiming GPU encoding.

## Deployment and canary

Set the registry/tag and use the CUDA profile:

```bash
export OPENSHORTS_REGISTRY=ghcr.io/your-org
export OPENSHORTS_TAG=$(git rev-parse --short HEAD)
export OPENSHORTS_GPU_RUNTIME=cuda
bash ./scripts/deploy-remote.sh
```

After rollout, submit a short render and poll `/api/render/{renderId}` until it
reaches `done`. Verify the output is available through the renderer `/output`
route and the configured S3/MinIO artifact. Finally confirm the backend metrics
endpoint reports `acceleration_mode=gpu` for that render. A successful request
with `acceleration_mode=cpu` means the adapter correctly fell back and needs
GPU diagnostics before further tuning.

For supported AMD Linux hosts, use `OPENSHORTS_GPU_RUNTIME=rocm-linux`; native
ROCm support is GPU/driver/OS-specific, so check the
[ROCm compatibility matrix](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/native_linux/native_linux_compatibility.html).
