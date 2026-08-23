# Pixel-Exact Editor Export Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce local editor version export time by up to 10× while preserving the existing Remotion subtitle and hook pixels exactly.

**Architecture:** Keep Remotion as the authoritative compositor for pixel-exact exports. Optimize the direct-media path around it: use the already-generated crop clip as the source when the version references one, force its timeline offset to zero, avoid legacy proxy URLs entirely, reuse local renderer media, and tune render concurrency only after a repeatable benchmark. FFmpeg remains responsible for media preparation and validation, not for recreating subtitle or hook styling.

**Tech Stack:** Go HTTP API, TypeScript render service, Remotion/Chromium, FFmpeg, shared Docker output volume, Vitest, Go tests, Python metrics.

---

## Scope and non-goals

- Optimize the current direct signed-URL/local-file path only.
- Do not add, restore, or migrate `/api/video-proxy`.
- Do not translate subtitles or hooks to ASS, `drawtext`, SVG, or another renderer.
- Do not change `Subtitles.tsx`, `HookOverlay.tsx`, subtitle style definitions, font sizes, timing, or layout as part of the performance work.
- Preserve the current 1080×1920, 60 FPS, H.264 export contract.
- Treat a literal pixel regression as a failure, even when the visual difference appears minor.

## Baseline and success criteria

Use the 66-second generated crop clip from project `fb796d38-36c2-ab49-488f-4c79ebdaa7c1`, clip index `13`, as the baseline fixture.

- Current editor export baseline: approximately 519 seconds.
- Current card crop-render baseline: approximately 121 seconds, including analysis and validation.
- Performance target: editor export completes in 52 seconds or less on the same Docker host, or the benchmark report records the exact limiting factor when hardware prevents that target.
- Correctness target: extracted output frames from the optimized export match the approved baseline subtitle/hook frames with zero differing pixels.
- Source invariant: if the media filename is `source_clip_*.mp4`, its render offset must be `0` and must never exceed the source duration.

Measured Docker result so far:

- `RENDER_CONCURRENCY=4`: 232 seconds total; `render.media` 178.5 seconds; validation 5.4 seconds.
- `RENDER_CONCURRENCY=8`: 402 seconds total; `render.media` 333.7 seconds; rejected because the host was CPU-saturated.
- The optimized output matched the previous artifact byte-for-byte (same SHA-256), including the sampled subtitle/hook frame regression fixture.
- The 52-second target is not met; the remaining bottleneck is Remotion composition rendering, not source preparation or output validation.

## File map

- Modify: `render-service/src/version-manifest.ts` — normalize direct generated-clip sources and derive the safe render offset.
- Modify: `render-service/src/source-proxy.ts` — use the shared local output file directly for already-trimmed generated clips; do not create a second range transcode.
- Modify: `render-service/src/render-worker.ts` — expose explicit, bounded Remotion concurrency and stage timing logs.
- Modify: `render-service/src/master-policy.ts` — keep the existing export policy while adding the renderer concurrency setting only if required by the benchmark.
- Modify: `backend-go/internal/httpapi/clip_handlers.go` — pass direct storage/local render media references to the renderer without legacy proxy paths.
- Modify: `render-service/src/version-manifest.test.ts` — test generated clips, master sources, direct signed URLs, and offset invariants.
- Modify: `render-service/src/source-proxy.test.ts` — test direct reuse of local generated clips and cache behavior.
- Modify: `render-service/src/render-worker.test.ts` — test concurrency selection and stage timing hooks.
- Modify: `backend-go/internal/httpapi/server_test.go` — verify version render transport contains no `/api/video-proxy` URL.
- Create: `render-service/src/pixel-regression.test.ts` — define the frame-level comparison contract for subtitle and hook pixels.
- Modify: `render-service/README.md` or `docs/` — document benchmark commands and renderer tuning variables.

---

### Task 1: Lock the direct generated-clip source contract

**Files:**

- Modify: `render-service/src/version-manifest.ts`
- Test: `render-service/src/version-manifest.test.ts`
- Modify: `backend-go/internal/httpapi/clip_handlers.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [x] **Step 1: Run GitNexus impact analysis before editing symbols.**

Run impact analysis for `manifestToVersionRenderProps`, `renderVersion`, and `localRenderVideoURL`. Record direct callers, affected flows, and risk. Stop and report if any result is HIGH or CRITICAL.

- [x] **Step 2: Add failing offset tests.**

Add cases proving:

```ts
expect(
  manifestToVersionRenderProps(generatedClipManifest, metadata).videoStartSeconds,
).toBe(0);

expect(
  manifestToVersionRenderProps(masterManifest, metadata).videoStartSeconds,
).toBe(masterManifest.render_spec.video_start_seconds);
```

Also assert that a generated clip URL is a direct storage/local media URL and does not contain `/api/video-proxy`.

- [x] **Step 3: Implement direct-media normalization.**

    Use the URL pathname and filename to identify `source_clip_*.mp4`. Preserve direct signed URLs and local `/output/...` URLs. Do not unwrap, support, or restore the removed proxy route. For generated clips, override only `videoStartSeconds` to `0`; preserve duration, FPS, dimensions, layout, subtitle tracks, hooks, and effects.

In the Go transport path, ensure a persisted generated clip reference is converted to the renderer-accessible direct media reference without introducing an HTTP byte proxy.

- [ ] **Step 4: Add an offset safety guard.**

Reject or normalize any render request where `videoStartSeconds` is greater than or equal to a known generated source duration. Return a clear error for malformed manifests instead of letting Remotion seek beyond EOF.

- [x] **Step 5: Run focused tests.**

```powershell
cd render-service
npm test -- --run src/version-manifest.test.ts
cd ..\backend-go
go test ./internal/httpapi -run 'TestClipVersionRender|TestVersion.*Media'
```

Expected: all source classification, direct-media, and offset tests pass.

- [ ] **Step 6: Commit the source-contract change.**

```powershell
git add render-service/src/version-manifest.ts render-service/src/version-manifest.test.ts backend-go/internal/httpapi/clip_handlers.go backend-go/internal/httpapi/server_test.go
git commit -m "fix: render generated clips from direct media"
```

Run GitNexus `detect_changes()` immediately before committing.

---

### Task 2: Reuse the generated crop clip inside the renderer

**Files:**

- Modify: `render-service/src/source-proxy.ts`
- Test: `render-service/src/source-proxy.test.ts`
- Modify: `render-service/src/render-worker.ts`

- [x] **Step 1: Add a failing local-reuse test.**

Create a local `/output/<job>/source_clip_14.mp4` fixture and assert that a generated source with `videoStartSeconds = 0` returns the existing shared-volume URL without invoking FFmpeg or creating `render-cache/clip-*.mp4`.

- [x] **Step 2: Implement the reuse branch.**

Before the generic range-proxy branch, detect a local generated clip with zero offset. Return its `/output/...` URL and `videoStartSeconds: 0`. Keep the generic range proxy for master sources and nonzero master offsets.

- [x] **Step 3: Add a source-stage timing record.**

Measure and log separately:

```text
source.resolve
source.range_prepare
composition.select
render.media
output.validate
```

Do not log signed URLs or credentials.

- [x] **Step 4: Run renderer tests and build.**

```powershell
cd render-service
npm test -- --run src/source-proxy.test.ts
npm run build
```

Expected: generated clips bypass range transcoding, while master-source behavior remains unchanged.

- [ ] **Step 5: Commit the local-reuse change.**

```powershell
git add render-service/src/source-proxy.ts render-service/src/source-proxy.test.ts render-service/src/render-worker.ts
git commit -m "perf: reuse generated clips during editor render"
```

Run GitNexus `detect_changes()` immediately before committing.

---

### Task 3: Tune Remotion without changing composition pixels

**Files:**

- Modify: `render-service/src/render-worker.ts`
- Modify: `render-service/src/master-policy.ts` only if configuration validation is needed
- Test: `render-service/src/render-worker.test.ts`
- Modify: `docker-compose.yml` with a renderer-only concurrency variable

- [x] **Step 1: Add a failing concurrency-selection test.**

Define a pure bounded selector with these requirements:

```ts
selectRenderConcurrency({ requested: 1, available: 8 }) === 1;
selectRenderConcurrency({ requested: 4, available: 8 }) === 4;
selectRenderConcurrency({ requested: 99, available: 4 }) === 4;
```

The default must remain conservative until the benchmark selects a higher value.

- [x] **Step 2: Make concurrency explicit.**

Read `RENDER_CONCURRENCY`, cap it at the available renderer CPUs, and pass the selected value to Remotion. Do not alter the composition, fonts, subtitle components, hook components, or frame timing.

- [x] **Step 3: Keep renderer startup warm.**

Ensure the Docker image contains the required Chromium binary during image build and does not download it on the first export. Keep bundle initialization once per renderer process. Record cold-start and warm-start timings separately.

- [x] **Step 4: Benchmark concurrency values.**

Render the same manifest at concurrency `1`, `2`, `4`, and `8`, recording:

- total wall-clock time;
- `render.media` time;
- CPU and memory usage;
- output checksum;
- frame-diff result.

Choose the fastest setting that produces identical pixels without exhausting the Docker host.

- [ ] **Step 5: Run tests and commit.**

```powershell
cd render-service
npm test -- --run src/render-worker.test.ts
npm run build
```

Then run GitNexus `detect_changes()` and commit:

```powershell
git add render-service/src/render-worker.ts render-service/src/master-policy.ts render-service/src/render-worker.test.ts docker-compose.yml
git commit -m "perf: tune pixel-exact Remotion rendering"
```

---

### Task 4: Preserve and verify pixel identity

**Files:**

- Create: `render-service/src/pixel-regression.test.ts`
- Modify: `render-service/package.json` only if a small image comparison dependency is required
- Modify: `docs/` with the benchmark procedure

- [x] **Step 1: Define the golden render fixture.**

Use a short fixed manifest containing the current subtitle style, overlapping word cues, hook text, and the generated crop source. Store only the manifest and expected frame hashes; do not commit video assets or signed URLs.

- [x] **Step 2: Compare decoded frames.**

Extract deterministic PNG frames from the baseline and optimized outputs at the beginning, middle, subtitle transition, hook transition, and final frame. Require zero differing pixels for each comparison.

- [x] **Step 3: Verify source and output invariants.**

Assert:

- source clip offset is zero;
- output is 1080×1920 at 60 FPS;
- subtitle cue timing is unchanged;
- hook timing is unchanged;
- no generated manifest contains `/api/video-proxy`;
- output audio and H.264 policy remain unchanged.

- [ ] **Step 4: Run the complete verification suite.**

```powershell
cd render-service
npm test
npm run build
cd ..\backend-go
go test ./...
cd ..\dashboard
npm run format
npm run format:check
npm run lint
```

- [x] **Step 5: Deploy and measure in Docker.**

```powershell
docker compose build backend renderer
docker compose up -d backend renderer
```

Render the baseline project clip again and record the stage timings. The change is successful only when the output is pixel-identical and the measured time approaches the 10× target.

---

## Self-review

- Legacy `/api/video-proxy` handling is explicitly excluded.
- Subtitle and hook rendering remain in the existing Remotion components.
- The plan does not rely on a style translation that could change pixels.
- The largest known correctness issue—master offset applied to an already-cropped source—is covered before performance tuning.
- Each performance change has a focused benchmark and pixel regression gate.
