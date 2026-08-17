# Build the Go control plane separately so the runtime image stays focused on
# the ROCm/PyTorch environment used by the Python worker.
FROM golang:1.26-alpine AS go-builder

WORKDIR /go-src
COPY backend-go/go.mod ./
COPY backend-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY backend-go/cmd ./cmd
COPY backend-go/internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/openshorts-api ./cmd/api

# ROCm's PyTorch runtime exposes AMD GPUs through torch.cuda over WSL2/DXG.
FROM rocm/pytorch:rocm7.2.1_ubuntu24.04_py3.12_pytorch_release_2.9.1

WORKDIR /app

# Install build/runtime dependencies and the application packages. The
# requirements file intentionally leaves torch/torchvision out so pip cannot
# replace the ROCm-provided builds with CUDA wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    nodejs \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r requirements.txt

# The official ROCm image contains HIP/PyTorch but not the WSL2 DXG bridge.
# Install the pinned ROCDXG runtime in the image; only libdxcore.so remains a
# host-provided mount at runtime.
ARG ROCDXG_VERSION=1.2.1
RUN wget -q "https://github.com/ROCm/librocdxg/releases/download/v${ROCDXG_VERSION}/rocdxg-roct_${ROCDXG_VERSION}_amd64.deb" \
    -O /tmp/rocdxg-roct.deb \
    && dpkg -i /tmp/rocdxg-roct.deb \
    && ldconfig \
    && rm -f /tmp/rocdxg-roct.deb

ENV PYTHONUNBUFFERED=1

# The ROCm base already provides UID/GID 1000 as `ubuntu`; reuse that
# identity so Kubernetes can continue running the worker as UID 1000.
RUN groupmod --new-name appuser ubuntu \
    && usermod --login appuser --home /app ubuntu

# Create directories including Ultralytics cache config
RUN mkdir -p /app/uploads /app/output /tmp/Ultralytics
# Fix permissions: /app for code/uploads, /tmp/Ultralytics for AI cache
RUN chown -R appuser:appuser /app /tmp/Ultralytics

# Switch to non-root user
USER appuser
ENV USER=appuser

# Pre-download YOLO model on build (now running as appuser, fully cached before source code copy)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# LOCAL_WHISPER_REACTIVATE: Local Whisper is intentionally not preloaded into
# the image. Transcription uses the configured remote provider by default, and
# downloading large-v3 here made every uncached backend build unnecessarily
# slow and large. The optional faster-whisper package remains installed for
# local-editor/fallback compatibility when local transcription is explicitly
# selected.
# To reactivate the preload, uncomment this exact command:
# RUN python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')"

# Keep the Go binary copy after the large model layers. Backend source changes
# now invalidate only the small control-plane layer instead of redownloading
# YOLO and Whisper models.
COPY --from=go-builder /out/openshorts-api /usr/local/bin/openshorts-api

# Copy application code (doing this last maximizes layer cache hits)
COPY --chown=appuser:appuser . .

# Expose the Go control-plane port
EXPOSE 8000

# Go owns HTTP; Python remains an internal worker launched by the control plane.
CMD ["/usr/local/bin/openshorts-api"]
