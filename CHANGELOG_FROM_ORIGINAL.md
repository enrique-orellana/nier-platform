# Changes From The Original Repo

This document summarizes the committed changes in this branch compared with the original repository snapshot.

## High-Level Summary

The repo has grown from a basic video tooling project into a multi-service OpenShorts platform with:

- a FastAPI backend for video processing and AI orchestration
- a React dashboard for uploads, settings, project browsing, and AI-assisted workflows
- a Remotion-based render service
- Kubernetes deployment manifests and environment examples
- S3/MinIO-backed persistence for clips, thumbnails, avatars, and project history
- provider-aware AI support for both Gemini and Ollama

The current diff from the original repo is large:

- 104 files changed
- about 36k insertions
- about 200 deletions

## Main Functional Changes

### 1. AI provider abstraction

The app now supports selecting the AI provider instead of hard-coding a single path.

- Gemini remains supported for cloud usage.
- Ollama is supported for local or cluster-hosted models.
- AI settings are normalized in the backend so old or stale values do not leak into the wrong provider.
- The frontend sends provider and model headers on every request.

Key areas:

- `ai_client.py`
- `app.py`
- `dashboard/src/App.jsx`

### 2. Model selection and defaults

The UI now exposes model selection for:

- text models
- vision models
- image models

The app also applies provider-aware defaults and normalization so switching providers does not accidentally keep a Gemini model name in Ollama mode, or vice versa.

### 3. Ollama integration

The local model path was made explicit and configurable.

- Ollama requests now require a reachable Base URL.
- The UI no longer silently guesses localhost or `host.docker.internal`.
- Kubernetes defaults were switched to Ollama so the cluster starts in local-model mode by default, while Gemini remains selectable from the UI.

Key areas:

- `ai_client.py`
- `app.py`
- `dashboard/src/App.jsx`
- `k8s/openshorts.yaml`
- `k8s/openshorts.env.example`

### 4. Video processing and AI-assisted creation

The project now includes a full pipeline for:

- clip generation from long-form video
- scene detection and reframing
- subtitle generation
- hook text overlays
- AI-generated thumbnails and descriptions
- UGC / AI shorts workflows

Key areas:

- `main.py`
- `thumbnail.py`
- `subtitles.py`
- `translate.py`
- `saasshorts.py`
- `hooks.py`
- `editor.py`

### 5. Project history and gallery storage

The app now persists generated assets and project metadata in a browsable format.

- clip and thumbnail projects are stored and listed
- public gallery pages and SEO metadata were added
- legacy thumbnail project data can be migrated into the new structure

Key areas:

- `s3_uploader.py`
- `app.py`
- `dashboard/src/components/ProjectLibrary.jsx`
- `dashboard/src/components/UGCGallery.jsx`
- `dashboard/src/components/ThumbnailStudio.jsx`

### 6. Dashboard and UI expansion

The frontend grew into a full control surface for the platform.

- settings for AI provider, models, and base URL
- upload and processing flows
- project browsing
- thumbnail studio
- UGC gallery
- scheduling and publishing helpers

Key areas:

- `dashboard/src/App.jsx`
- `dashboard/src/components/*`
- `dashboard/src/Landing.jsx`
- `dashboard/src/index.css`
- `dashboard/src/App.css`

### 7. Deployment and infrastructure

The repo now includes a self-hosted deployment story.

- Dockerfiles for the backend, frontend, and render service
- docker compose support
- Kubernetes manifests and MinIO/ingress configs
- runtime env examples

Key areas:

- `Dockerfile`
- `docker-compose.yml`
- `dashboard/Dockerfile`
- `render-service/Dockerfile`
- `k8s/README.md`
- `k8s/openshorts.yaml`
- `k8s/minio-ingress-values.yaml`
- `k8s/ingress-nginx-values.yaml`

## Notable Defaults

Current defaults in the committed branch:

- AI provider defaults to Ollama in Kubernetes
- Ollama Base URL is expected to be explicitly reachable
- Gemini is still available in the UI as an option
- Ollama model defaults are `qwen3:latest` for text and `qwen2.5vl:latest` for vision
- thumbnail image generation uses provider-aware fallback logic instead of assuming a Gemini-only path

## Additional Repo Additions

The branch also added:

- README and docs updates
- screenshots and demo assets
- fonts and static public assets
- verification scripts for hooks and aesthetics

## Important Note

This summary reflects the committed repository changes from the original snapshot up to `HEAD`.
There is also a separate in-progress local edit in `dashboard/src/components/ProjectLibrary.jsx` that is not part of this summary.

