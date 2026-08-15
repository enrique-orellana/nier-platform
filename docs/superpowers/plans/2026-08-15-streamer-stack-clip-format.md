# Streamer Stack clip format Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an opt-in streamer_stack generation format that renders a single streamer recording as a facecam-over-gameplay 9:16 clip while preserving the existing optional post-generation hook and subtitle workflows.

**Architecture:** Keep the current Standard path unchanged. Add a small Python layout module for format normalization, panel geometry, and frame composition; pass only layout_format and facecam_size through the dashboard, Go control plane, legacy FastAPI path, and Python worker. Persist the layout in clip metadata so the existing Hook endpoint can choose the streamer yellow/black treatment without forcing a hook during generation.

**Tech Stack:** React/Vitest, FastAPI compatibility API, Go HTTP control plane, Python/OpenCV/FFmpeg worker, PIL hook rendering, pytest/unittest, Go test.

---

## File map

- Create streamer_layout.py and tests/test_streamer_layout.py for layout settings, panel geometry, and frame composition.
- Modify main.py and tests/test_main_generation_pipeline.py for generation, CLI flags, and manifest metadata.
- Modify hooks.py and create tests/test_hooks.py for layout-aware post-generation hook styling.
- Modify app.py and create or extend tests/test_clip_process_options.py for compatibility API forwarding and hook style selection.
- Modify python_worker.py for protocol-to-CLI forwarding.
- Modify backend-go/internal/httpapi/server.go and server_test.go for JSON/multipart request validation.
- Modify backend-go/internal/workers/protocol.go, protocol_test.go, python.go, and python_test.go for worker propagation.
- Modify dashboard/src/components/MediaInput.jsx, MediaInput.test.jsx, and App.jsx for the format controls and request payload.
- Preserve all unrelated existing worktree changes, especially overlapping edits in main.py, python_worker.py, and backend-go/internal/workers/*.

### Task 1: Preflight, baseline, and GitNexus impact

**Files:** None.

- [ ] Step 1: Record the current dirty worktree and inspect overlapping diffs.

~~~powershell
git status --short
git diff -- main.py python_worker.py backend-go/internal/workers/protocol.go backend-go/internal/workers/protocol_test.go
~~~

Expected: existing user changes are understood and retained. Do not reset, stash, or overwrite them.

- [ ] Step 2: Run upstream GitNexus impact before changing each shared symbol.

Run impact for process_video_to_vertical, render_clip_plan, SmoothedCameraman, process_endpoint, add_hook_to_video, MediaInput, handleProcess, PythonAdapter.Run, and PythonWorkerAdapter.RunResult with repo openshorts. Resolve the exact GitNexus UID for each symbol before editing, review direct callers first, and report the returned risk before editing.

- [ ] Step 3: Run the baseline focused suites.

~~~powershell
pytest -q tests/test_main_generation_pipeline.py tests/test_video_output_validation.py
Push-Location dashboard; npm test -- --run src/components/MediaInput.test.jsx; Pop-Location
Push-Location backend-go; go test ./internal/httpapi ./internal/workers; Pop-Location
~~~

Expected: pre-existing failures are recorded before feature work begins.

### Task 2: Add and test the layout contract

**Files:** Create streamer_layout.py and tests/test_streamer_layout.py.

- [ ] Step 1: Add the failing contract tests.

~~~python
import pytest

from streamer_layout import ClipLayoutOptions, normalize_clip_layout, streamer_panel_heights

def test_standard_is_the_legacy_default():
    assert normalize_clip_layout() == ClipLayoutOptions("standard", "medium")

def test_streamer_panel_heights_are_stable():
    assert streamer_panel_heights(1080, 1920, "small") == (576, 1344)
    assert streamer_panel_heights(1080, 1920, "medium") == (728, 1192)
    assert streamer_panel_heights(1080, 1920, "large") == (882, 1038)

def test_invalid_values_fail_before_rendering():
    with pytest.raises(ValueError, match="layout_format"):
        normalize_clip_layout("split_screen", "medium")
    with pytest.raises(ValueError, match="facecam_size"):
        normalize_clip_layout("streamer_stack", "huge")
~~~

- [ ] Step 2: Run pytest -q tests/test_streamer_layout.py and verify it fails because the module/exports do not exist.

- [ ] Step 3: Implement the contract with Standard/Streamer Stack constants, Small/Medium/Large ratios of 0.30/0.38/0.46, a frozen ClipLayoutOptions dataclass, normalize_clip_layout, and streamer_panel_heights. Defaults must be standard and medium; hook state is deliberately not part of this contract.

- [ ] Step 4: Run pytest -q tests/test_streamer_layout.py and commit.

~~~powershell
git add streamer_layout.py tests/test_streamer_layout.py
git commit -m "feat: add streamer layout contract"
~~~

### Task 3: Add and test two-panel frame composition

**Files:** Modify streamer_layout.py and tests/test_streamer_layout.py.

- [ ] Step 1: Add a failing composition test using a 1920x1080 NumPy frame with the top half tinted red and bottom half tinted green. Call compose_streamer_stack_frame with medium and face_focus=(0.5, 0.35), then assert the result is shape (1920, 1080, 3), the upper region is red-dominant, and the lower region is green-dominant. Add a second test passing face_focus=None and assert the small layout still returns the exact output shape.

- [ ] Step 2: Run pytest -q tests/test_streamer_layout.py and verify the missing compositor failure.

- [ ] Step 3: Implement crop-to-panel and composition helpers:
  - crop to the target panel aspect ratio around a clamped normalized focus point;
  - use a bounded facecam zoom of 1.6;
  - use a stable lower-biased gameplay focus of (0.5, 0.58) and zoom 1.0;
  - resize each panel to the requested output width and its calculated height;
  - vertically stack the panels with NumPy;
  - use (0.5, 0.5) when face_focus is absent.
  Keep this module independent of MediaPipe and SpeakerTracker.

- [ ] Step 4: Run pytest -q tests/test_streamer_layout.py and commit.

~~~powershell
git add streamer_layout.py tests/test_streamer_layout.py
git commit -m "feat: compose streamer stack frames"
~~~

### Task 4: Integrate generation, manifest metadata, and CLI flags

**Files:** Modify main.py and tests/test_main_generation_pipeline.py.

- [ ] Step 1: Add a failing render_clip_plan test that calls layout_format="streamer_stack" and facecam_size="large", then asserts every process_video_to_vertical mock call receives those keyword values and every returned clip contains layout_format and facecam_size.

- [ ] Step 2: Run pytest -q tests/test_main_generation_pipeline.py -k layout and verify propagation fails.

- [ ] Step 3: Implement the minimal integration:
  - add keyword-only layout_format="standard" and facecam_size="medium" to process_video_to_vertical and render_clip_plan;
  - normalize once at each public generation boundary;
  - keep the existing Standard frame branch behavior unchanged;
  - for Streamer Stack, use the existing SpeakerTracker target box when available, convert its center to normalized x/y, and call compose_streamer_stack_frame; pass None for the centered fallback;
  - pass layout settings to every clip render and whole-video fallback;
  - write layout_format and facecam_size into each clip record and the manifest export policy/layer metadata;
  - add CLI flags --layout-format with standard/streamer_stack choices and --facecam-size with small/medium/large choices;
  - retain the existing 1080x1920 master dimensions, audio extraction, FPS, and output validation;
  - do not burn hook text in main.py.
  If SmoothedCameraman is changed to support a new crop ratio, rerun its GitNexus impact first and preserve its Standard defaults.

- [ ] Step 4: Run pytest -q tests/test_streamer_layout.py tests/test_main_generation_pipeline.py tests/test_video_output_validation.py and commit.

~~~powershell
git add streamer_layout.py tests/test_streamer_layout.py tests/test_main_generation_pipeline.py
# Stage only the feature hunks in the already-dirty main.py after reviewing git diff.
git add -p main.py
git commit -m "feat: add streamer stack generation format"
~~~

### Task 5: Keep hooks optional and style them after generation

**Files:** Modify hooks.py and app.py; create tests/test_hooks.py and extend tests/test_clip_process_options.py.

- [ ] Step 1: Add failing tests:
  - hook_style_for_layout(None) and hook_style_for_layout("standard") must return legacy;
  - hook_style_for_layout("streamer_stack") must return streamer;
  - a patched /api/hook request for a clip with layout_format streamer_stack must call add_hook_to_video with style="streamer";
  - a legacy clip without layout metadata must call it with style="legacy".

- [ ] Step 2: Run pytest -q tests/test_hooks.py tests/test_clip_process_options.py -k hook and verify the missing-style failure.

- [ ] Step 3: Implement hook_style_for_layout in hooks.py. Add style="legacy" to create_hook_image and add_hook_to_video. Leave the current white-box hook under legacy. Add the streamer branch as a transparent overlay with yellow text and a black stroke, centered at the requested position, while preserving the existing S/M/L scaling. In app.py run_hook, derive the style from clip_data.get("layout_format") and pass it to add_hook_to_video. Do not add a generation-time hook toggle or automatic hook render.

- [ ] Step 4: Run the hook tests and commit.

~~~powershell
git add hooks.py tests/test_hooks.py tests/test_clip_process_options.py
git add -p app.py
git commit -m "feat: style streamer hooks post-generation"
~~~

### Task 6: Forward options through legacy and Go worker paths

**Files:** Modify app.py, python_worker.py, backend-go/internal/httpapi/server.go, backend-go/internal/workers/protocol.go, backend-go/internal/workers/python.go, and their existing tests.

- [ ] Step 1: Add failing tests:
  - Go JSON and multipart /api/process requests with layout_format streamer_stack and facecam_size large store both values in job metadata;
  - invalid Go values return HTTP 400;
  - protocol and direct Python worker commands contain the two values;
  - python_worker.py emits --layout-format streamer_stack --facecam-size large;
  - legacy app.py forwards the same flags and defaults absent values to standard/medium.

- [ ] Step 2: Run Push-Location backend-go; go test ./internal/httpapi ./internal/workers; Pop-Location and pytest -q tests/test_clip_process_options.py tests/test_python_worker.py. Verify the new assertions fail.

- [ ] Step 3: Implement:
  - add LayoutFormat and FacecamSize fields to the Go process request;
  - parse JSON and multipart values, default missing fields, validate known values, and store them in job metadata;
  - copy metadata into backend-go worker protocol requests;
  - append the flags in backend-go/internal/workers/python.go;
  - read and append them in python_worker.py;
  - add equivalent form/JSON parsing, validation, and command flags in legacy app.py;
  - never add hook fields to the generation request.
  Preserve the existing source, acknowledgement, clip-count, AI-header, and worker protocol behavior.

- [ ] Step 4: Run the Go/Python propagation tests and commit.

~~~powershell
Push-Location backend-go; go test ./internal/httpapi ./internal/workers; Pop-Location
pytest -q tests/test_clip_process_options.py tests/test_python_worker.py
git add tests/test_clip_process_options.py backend-go/internal/httpapi/server_test.go backend-go/internal/workers/protocol_test.go backend-go/internal/workers/python_test.go
# These files already contain user changes. Review and stage only the feature hunks.
git add -p app.py python_worker.py backend-go/internal/httpapi/server.go backend-go/internal/workers/protocol.go backend-go/internal/workers/python.go
git commit -m "feat: propagate streamer layout options through workers"
~~~

### Task 7: Add Clip Generator controls and request payload

**Files:** Modify dashboard/src/components/MediaInput.jsx, dashboard/src/components/MediaInput.test.jsx, and dashboard/src/App.jsx.

- [ ] Step 1: Add failing Vitest cases:
  - default file submission includes layoutFormat: "standard" and facecamSize: "medium";
  - selecting the labeled Video format value streamer_stack and Facecam size value large includes those values in the onProcess payload;
  - no hook control is added to this pre-generation form.

- [ ] Step 2: Run Push-Location dashboard; npm test -- --run src/components/MediaInput.test.jsx; Pop-Location and verify the controls/payload assertions fail.

- [ ] Step 3: Implement:
  - initialize MediaInput layoutFormat to standard and facecamSize to medium;
  - render Standard 9:16 and Streamer Stack options;
  - render the facecam-size select only for Streamer Stack;
  - include only layoutFormat and facecamSize in file and remote onProcess payloads;
  - in App.handleProcess, include layout_format and facecam_size in JSON bodies and multipart FormData;
  - keep the existing Hook action after generation and do not add hookEnabled to this request.

- [ ] Step 4: Run the focused dashboard tests and commit.

~~~powershell
Push-Location dashboard; npm test -- --run src/components/MediaInput.test.jsx src/App.test.jsx; Pop-Location
git add dashboard/src/components/MediaInput.jsx dashboard/src/components/MediaInput.test.jsx dashboard/src/App.jsx
git commit -m "feat: add streamer stack clip generator controls"
~~~

### Task 8: Full verification and change-scope review

**Files:** None.

- [ ] Step 1: Run pytest -q. Expected: exit code 0 with no new failures.

- [ ] Step 2: Run the dashboard suite, lint, and build.

~~~powershell
Push-Location dashboard; npm test; npm run lint; npm run build; Pop-Location
~~~

Expected: tests pass, ESLint reports zero errors/warnings, and Vite exits successfully.

- [ ] Step 3: Run Push-Location backend-go; go test ./...; Pop-Location. Expected: all Go packages pass.

- [ ] Step 4: Run GitNexus detect_changes with scope all and repo openshorts. Review affected symbols/processes and confirm only the generation request path, layout compositor, manifest metadata, optional hook styling, and tests are affected. If unexpected high-risk flows appear, stop and review before claiming completion.

- [ ] Step 5: Run git diff --check and git status --short. Confirm existing unrelated user changes remain present and no destructive cleanup was performed.

- [ ] Step 6: If final verification required a test-only adjustment, stage only the feature files and commit with message test: verify streamer stack clip generation. Do not stage unrelated existing worktree changes.
