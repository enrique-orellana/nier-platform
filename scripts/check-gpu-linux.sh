#!/usr/bin/env bash
set -u -o pipefail

NAMESPACE="${OPENSHORTS_NAMESPACE:-openshorts}"
BACKEND_POD="${OPENSHORTS_BACKEND_POD:-}"
RENDERER_POD="${OPENSHORTS_RENDERER_POD:-}"

failures=0
check() {
  local name="$1"
  shift
  printf '\n==> %s\n' "$name"
  if "$@"; then
    printf 'PASS: %s\n' "$name"
  else
    printf 'FAIL: %s\n' "$name" >&2
    failures=$((failures + 1))
  fi
}

command -v nvidia-smi >/dev/null 2>&1 || { echo "nvidia-smi is required" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 2; }
command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required" >&2; exit 2; }

check "Host NVIDIA driver" nvidia-smi
check "Docker NVIDIA runtime" docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi
check "Kubernetes GPU allocatable" kubectl get nodes \
  -o custom-columns='NAME:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'

if [[ -z "$BACKEND_POD" ]]; then
  BACKEND_POD="$(kubectl -n "$NAMESPACE" get pod -l app=openshorts-backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
fi
if [[ -z "$RENDERER_POD" ]]; then
  RENDERER_POD="$(kubectl -n "$NAMESPACE" get pod -l app=openshorts-renderer -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
fi

if [[ -n "$BACKEND_POD" ]]; then
  check "Backend PyTorch CUDA" kubectl -n "$NAMESPACE" exec "$BACKEND_POD" -- \
    python -c 'import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'
else
  echo "SKIP: no backend pod found in namespace $NAMESPACE" >&2
  failures=$((failures + 1))
fi

if [[ -n "$RENDERER_POD" ]]; then
  check "Renderer NVENC encoder" kubectl -n "$NAMESPACE" exec "$RENDERER_POD" -- \
    sh -c 'ffmpeg -hide_banner -encoders 2>/dev/null | grep -E "h264_nvenc|hevc_nvenc"'
else
  echo "SKIP: no renderer pod found in namespace $NAMESPACE" >&2
  failures=$((failures + 1))
fi

if [[ "$failures" -eq 0 ]]; then
  echo "Linux GPU preflight passed."
  exit 0
fi

echo "Linux GPU preflight failed checks: $failures" >&2
exit 1
