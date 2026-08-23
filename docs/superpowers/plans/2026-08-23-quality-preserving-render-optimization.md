# Quality-Preserving Render Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce render time and resource usage without changing the final video or audio quality.

**Architecture:** Optimize caching, browser lifecycle, and redundant processing while keeping the existing final export policy unchanged. Persist one structured render-performance record per job through the Go backend into PostgreSQL. Do not enable hardware encoding by default or alter resolution, FPS, CRF, color, or audio settings in this plan.

**Tech Stack:** Node.js, Remotion, Puppeteer, FFmpeg, Go, PostgreSQL, Docker Compose, Kubernetes.

---

### Task 1: Add render-stage measurements

**Files:**
- Modify: `render-service/src/render-worker.ts`
- Test: `render-service/src/render-worker.test.ts`

- [x] Add timings for bundle preparation, composition selection, source preparation, `renderMedia`, normalization, and validation.
- [x] Log one structured summary per render containing the job ID and each duration.
- [x] Verify the existing output bytes and media metadata are unchanged by the instrumentation.

### Task 2: Reuse the Remotion browser

**Files:**
- Modify: `render-service/src/render-worker.ts`
- Modify: `render-service/src/server.ts`
- Test: `render-service/src/render-worker.test.ts`

- [x] Open one reusable Puppeteer browser for the renderer process.
- [x] Pass the browser instance to both `selectComposition` and `renderMedia`.
- [x] Close the browser during graceful server shutdown.
- [x] Keep the existing rendering options and export policy unchanged.

### Task 3: Remove redundant output re-encoding

**Files:**
- Modify: `render-service/src/output-normalization.ts`
- Modify: `render-service/src/output-validation.ts`
- Test: `render-service/src/output-normalization.test.ts`

- [x] Normalize only when codec, dimensions, FPS, pixel format, color metadata, audio format, or fast-start requirements fail.
- [x] Replace the full-file fast-start read with a bounded metadata check.
- [x] Do not re-encode a file that already satisfies the export policy.
- [x] Retain full decode validation only for files that were normalized or fail lightweight checks.

### Task 4: Tune concurrency without changing output

**Files:**
- Modify: `render-service/src/server.ts`
- Modify: `docker-compose.yml`
- Modify: `k8s/openshorts.yaml`
- Test: `render-service/src/server.test.ts`

- [x] Benchmark `RENDER_CONCURRENCY=2`, `4`, `6`, and `8` with the same clip.
- [x] Select the fastest stable value that does not cause memory pressure or failed renders.
- [x] Keep `RENDER_MAX_CONCURRENCY` at one until the benchmark confirms safe parallel jobs.
- [x] Set explicit CPU and memory limits for the selected production values.

### Task 5: Persist render-performance metrics

**Files:**
- Create: `backend-go/internal/jobs/migrations/006_render_performance_metrics.sql`
- Modify: `backend-go/internal/jobs/postgres.go`
- Modify: `backend-go/internal/jobs/store.go`
- Create: `backend-go/internal/jobs/render_metrics.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Create: `backend-go/internal/httpapi/render_metrics_handlers.go`
- Modify: `render-service/src/server.ts`
- Modify: `render-service/src/render-worker.ts`
- Modify: `docker-compose.yml`
- Modify: `k8s/openshorts.yaml`
- Test: `backend-go/internal/jobs/render_metrics_test.go`
- Test: `backend-go/internal/httpapi/render_metrics_handlers_test.go`
- Test: `render-service/src/render-worker.test.ts`

- [x] Create a PostgreSQL table with one row per render containing `render_id`, `job_id`, optional `version_id`, `clip_index`, status, start/end timestamps, total duration, stage durations as JSONB, render concurrency, worker count, output bytes, and error text.
- [x] Add indexes on `created_at`, `job_id`, `status`, and `version_id`.
- [x] Add a backend repository method that upserts by `render_id`, so retries or duplicate callbacks cannot create duplicate metric rows.
- [x] Add `POST /api/render-metrics` to validate and persist completed and failed render metrics.
- [x] Include the render ID, job ID, clip index, and optional version ID in the renderer job state.
- [x] Send metrics to the backend when a render completes or fails; keep rendering successful if metrics persistence is temporarily unavailable, but log the persistence error.
- [x] Configure the renderer metrics URL in Docker Compose and Kubernetes.
- [x] Test PostgreSQL persistence across close and reopen, duplicate callbacks, completed renders, failed renders, and unavailable metrics storage.

### Task 6: Gate GPU rendering with a real canary export

**Files:**
- Create: `render-service/src/hardware-acceleration.ts`
- Create: `render-service/src/hardware-acceleration.test.ts`
- Modify: `render-service/src/render-worker.ts`
- Modify: `render-service/src/server.ts`
- Modify: `docker-compose.yml`
- Create: `render-service/tools/ffmpeg-amd-wrapper/main.go`
- Create: `render-service/tools/ffmpeg-amd-wrapper/main_test.go`
- Create: `scripts/start-native-renderer.ps1`

- [ ] Detect the actual GPU device and usable FFmpeg acceleration path on the Windows host; compiled FFmpeg encoder support alone is insufficient.
- [ ] Add opt-in GPU mode using `RENDER_HARDWARE_ACCELERATION=if-possible`; keep CPU rendering as the automatic fallback.
- [x] Run a real reference export through the GPU path before enabling it for production jobs.
- [x] Reject the GPU path when device access, hardware encoding, or export completion fails.
- [x] Compare GPU and CPU outputs for dimensions, FPS, duration, codecs, audio format, color metadata, sampled frames, and perceptual quality.
- [ ] Enable GPU rendering only when the canary passes all checks and improves render time or resource usage without a quality regression.
- [ ] Add a repeatable command that records GPU/CPU timings, peak memory, failure reason, and comparison results.

Benchmark result: CPU was faster than GPU on the 1-second canary (2.389s vs 3.411s end-to-end) with matching export metadata and SSIM 0.993833. GPU remains opt-in with CPU fallback and is not enabled as the default path.

Concurrency benchmark on the same 1-second clip: `2=2.932s`, `4=2.945s`, `6=3.128s`, `8=3.223s`. Three-run stability checks selected `4` (`2.570s` average) over `2` (`2.774s` average); `RENDER_MAX_CONCURRENCY` remains `1`.

### Task 7: Verify quality and performance

**Files:**
- Create: `render-service/scripts/benchmark-render.mjs`

- [ ] Render the same reference clip before and after each optimization.
- [ ] Compare duration, peak memory, output dimensions, FPS, video/audio codecs, color metadata, audio sample rate, and clip duration.
- [ ] Use a frame-by-frame or perceptual comparison to confirm no visible quality regression.
- [ ] Keep only optimizations that improve timing or resource usage without changing the quality contract.
