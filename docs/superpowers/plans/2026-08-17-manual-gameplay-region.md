# Manual Streamer Stack Gameplay Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make each Streamer Stack clip use manually selected webcam and gameplay rectangles, with optional face/person tracking disabled by default and manual-fill gameplay cropping when tracking is off.

**Architecture:** Keep clip discovery unchanged and extend deferred-render metadata with \`gameplay_region\` and \`streamer_tracking_enabled\`. Share the current source-video rectangle interaction between webcam and gameplay selectors, persist each setting per clip through dedicated PATCH endpoints, and pass the saved settings through Go child-job metadata into the Python compositor. The Python renderer will never initialize or call detection for Streamer Stack clips unless the per-clip tracking flag is true; when tracking is enabled, candidate filtering and crop focus stay inside the saved gameplay rectangle and outside the webcam rectangle.

**Tech Stack:** Python 3.12, OpenCV/NumPy, pytest; Go HTTP API and in-memory job store; React/Vite, Testing Library, Vitest; GitNexus impact analysis.

---

## File map

| File | Responsibility |
|---|---|
| \`streamer_layout.py\` | Validate gameplay rectangles, crop selected gameplay content with centered fill behavior, and constrain optional tracking focus. |
| \`tests/test_streamer_layout.py\` | Test gameplay validation, manual-fill cropping, and bounded focus. |
| \`main.py\` | Carry both regions and the tracking flag through manifests and deferred rendering; skip detector/tracker work when tracking is off. |
| \`tests/test_main_generation_pipeline.py\` | Test forwarding, metadata, detector bypass, bounded tracking, fallback rendering, and standard-layout compatibility. |
| \`backend-go/internal/httpapi/deferred_clip_rendering.go\` | Validate and persist gameplay selections and tracking settings; copy them into child render metadata; reject incomplete Streamer Stack renders. |
| \`backend-go/internal/httpapi/server_test.go\` | Test gameplay/tracking PATCH routes, invalid values, child metadata, and missing-field conflicts. |
| \`dashboard/src/components/ResultCard/SourceRegionSelector.jsx\` | Shared draw/move/resize/reset source-region modal used by both selectors. |
| \`dashboard/src/components/ResultCard/WebcamRegionSelector.jsx\` | Backward-compatible webcam selector wrapper. |
| \`dashboard/src/components/ResultCard/GameplayRegionSelector.jsx\` | Gameplay selector wrapper. |
| \`dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx\` | Test shared selector interaction and save behavior. |
| \`dashboard/src/components/ClipRenderControls.jsx\` | Show both selector actions, tracking checkbox, and Streamer Stack render gating. |
| \`dashboard/src/components/ClipRenderControls.test.jsx\` | Test control states and default-off tracking. |
| \`dashboard/src/components/ProjectLibrary.jsx\` | Persist gameplay region and tracking state per clip. |
| \`dashboard/src/components/ProjectLibrary.test.jsx\` | Test per-clip PATCH requests and render gating. |
| \`dashboard/src/components/ResultCard.jsx\` | Open the correct selector and pass saved per-clip settings to render controls. |
| \`dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx\` | Preserve existing webcam-selector coverage. |

Before editing any existing Python, Go, or React symbol, run GitNexus \`impact({target: "<symbol>", direction: "upstream"})\`, record the callers and risk, and stop to warn me if GitNexus reports HIGH or CRITICAL risk. Before committing implementation changes, run \`detect_changes()\` and confirm that only the files and execution flows listed above changed.

### Task 1: Add gameplay-region layout primitives

**Files:**
- Modify: \`streamer_layout.py\`
- Test: \`tests/test_streamer_layout.py\`

- [ ] **Step 1: Add failing layout tests.**

Add tests beside the existing webcam-region tests:

~~~python
def test_normalize_gameplay_region_rejects_out_of_bounds_values():
    with pytest.raises(ValueError, match="gameplay_region must fit inside"):
        normalize_gameplay_region({"x": 0.8, "y": 0.1, "width": 0.3, "height": 0.2})


def test_crop_gameplay_region_fills_panel_from_selected_rectangle():
    source = np.zeros((100, 200, 3), dtype=np.uint8)
    source[:, :, 0] = np.arange(200, dtype=np.uint8)
    region = {"x": 0.25, "y": 0.0, "width": 0.5, "height": 1.0}

    result = crop_gameplay_region(source, region, target_width=40, target_height=80)

    assert result.shape == (80, 40, 3)
    assert int(result[:, :, 0].min()) >= 50
    assert int(result[:, :, 0].max()) <= 150


def test_gameplay_focus_is_clamped_inside_selected_region():
    region = {"x": 0.25, "y": 0.2, "width": 0.5, "height": 0.6}

    assert clamp_focus_to_region((0.0, 1.0), region) == (0.25, 0.8)


def test_streamer_stack_manual_gameplay_region_composes_without_detection_focus():
    source = np.zeros((100, 200, 3), dtype=np.uint8)
    source[:, :100] = (0, 0, 255)
    source[:, 100:] = (0, 255, 0)

    result = compose_streamer_stack_frame(
        source,
        output_width=40,
        output_height=80,
        facecam_size="medium",
        webcam_region={"x": 0.0, "y": 0.0, "width": 0.25, "height": 1.0},
        gameplay_region={"x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0},
    )

    _, gameplay_height = streamer_panel_heights(40, 80, "medium")
    assert result.shape == (80, 40, 3)
    assert result[-gameplay_height:, :, 1].mean() > result[-gameplay_height:, :, 2].mean()
~~~

- [ ] **Step 2: Run the focused layout tests and verify they fail.**

Run:

~~~powershell
pytest tests/test_streamer_layout.py -q
~~~

Expected: the new imports/functions are missing and the new tests fail while the existing webcam tests continue to run.

- [ ] **Step 3: Implement the shared normalized-region and crop helpers.**

Keep \`normalize_webcam_region\` as the public compatibility function and add the gameplay equivalent using the same finite-number, positive-size, and \`[0, 1]\` bounds rules. Add \`crop_gameplay_region\` with the same centered aspect-ratio crop used by the webcam crop, but validate and report \`gameplay_region\` errors. Add \`clamp_focus_to_region(focus, region)\` so a global normalized focus is clamped to the selected rectangle before the lower-panel crop is calculated.

Update \`compose_streamer_stack_frame\` to accept:

~~~python
def compose_streamer_stack_frame(
    frame: np.ndarray,
    output_width: int,
    output_height: int,
    facecam_size: str = "medium",
    face_focus: tuple[float, float] | None = None,
    webcam_region: Mapping[str, object] | None = None,
    gameplay_region: Mapping[str, object] | None = None,
    gameplay_focus: tuple[float, float] | None = None,
) -> np.ndarray:
~~~

When \`gameplay_region\` is present, crop that rectangle to the lower-panel aspect and fill the panel with no letterbox padding. If a focus is present, clamp it to the gameplay rectangle before cropping. Retain the current centered lower crop only for callers that do not pass a gameplay rectangle, so existing direct helper calls remain compatible.

- [ ] **Step 4: Run layout tests and inspect the diff.**

Run:

~~~powershell
pytest tests/test_streamer_layout.py -q
git diff --check
~~~

Expected: all layout tests pass and the diff contains only the helper/compositor changes and their tests.

- [ ] **Step 5: Commit the layout primitives.**

~~~powershell
git add -- streamer_layout.py tests/test_streamer_layout.py
git commit -m "feat: add manual gameplay region composition"
~~~

### Task 2: Make Python Streamer Stack processing opt-in for tracking

**Files:**
- Modify: \`main.py\`
- Test: \`tests/test_main_generation_pipeline.py\`

- [ ] **Step 1: Add failing pipeline tests for the new arguments and bypass.**

Add a Streamer Stack test using the existing fake capture/process fixtures and patches:

~~~python
def test_streamer_render_skips_detection_when_tracking_is_disabled(self):
    with patch.object(main, "detect_face_candidates") as faces, patch.object(
        main, "detect_person_yolo"
    ) as people, patch.object(main, "SpeakerTracker") as tracker:
        main.process_video_to_vertical(
            "source.mp4",
            "streamer.mp4",
            source_analysis=self.analysis,
            source_media=source_media(),
            layout_format="streamer_stack",
            webcam_region=WEBCAM_REGION,
            gameplay_region=GAMEPLAY_REGION,
            streamer_tracking_enabled=False,
        )

    faces.assert_not_called()
    people.assert_not_called()
    tracker.assert_not_called()
~~~

Add a forwarding assertion to the existing \`render_clip_plan\` test:

~~~python
assert render.call_args.kwargs["gameplay_region"] == GAMEPLAY_REGION
assert render.call_args.kwargs["streamer_tracking_enabled"] is True
~~~

Add \`GAMEPLAY_REGION = {"x": 0.28, "y": 0.08, "width": 0.70, "height": 0.84}\` beside the existing \`WEBCAM_REGION\` fixture and pass both regions to current Streamer Stack tests.

- [ ] **Step 2: Run the focused pipeline tests and verify they fail.**

Run:

~~~powershell
pytest tests/test_main_generation_pipeline.py -q
~~~

Expected: the new keyword arguments are rejected or the current code still invokes detector/tracker code.

- [ ] **Step 3: Thread the new settings through Python render functions.**

Add \`gameplay_region: dict | None = None\` and \`streamer_tracking_enabled: bool = False\` to \`process_video_to_vertical\`, \`render_clip_plan\`, \`render_deferred_clip\`, and \`_write_clip_manifest\`. For Streamer Stack, require and normalize both rectangles before starting the frame loop; missing tracking metadata must normalize to \`False\`.

The Streamer Stack validation branch must have this behavior:

~~~python
if layout_options.layout_format == STREAMER_STACK_LAYOUT:
    if webcam_region is None:
        raise ValueError("webcam_region is required for streamer_stack rendering")
    if gameplay_region is None:
        raise ValueError("gameplay_region is required for streamer_stack rendering")
    normalized_webcam_region = normalize_webcam_region(webcam_region)
    normalized_gameplay_region = normalize_gameplay_region(gameplay_region)
else:
    normalized_webcam_region = None
    normalized_gameplay_region = None
~~~

Only create \`SpeakerTracker\`, call \`detect_face_candidates\`, or call \`detect_person_yolo\` inside the \`streamer_tracking_enabled\` branch. When tracking is enabled, filter candidates first to the gameplay rectangle and then remove candidates touching the webcam rectangle. Pass the resulting focus to the compositor; when no candidate is usable, pass \`None\) so the compositor uses the centered manual gameplay crop. Every Streamer Stack composition call must pass both normalized regions and \`gameplay_focus\`.

Persist both regions and the flag in the manifest layout/export policy and in each clip metadata record. \`render_deferred_clip\` must read all three values from the saved clip and forward them to \`render_clip_plan\`; \`render_clip_plan\` must forward the per-clip values to \`process_video_to_vertical\`, allowing defaults only for non-Streamer layouts.

- [ ] **Step 4: Add bounded-tracking and manual-fallback tests.**

Add a test where detections contain one candidate inside \`GAMEPLAY_REGION\`, one outside it, and one touching \`WEBCAM_REGION\`; assert only the valid gameplay candidate changes \`gameplay_focus\). Add a test with tracking enabled and no candidates; assert \`compose_streamer_stack_frame\` receives \`gameplay_focus=None\`. Add a manifest test that expects \`gameplay_region\` and \`streamer_tracking_enabled\` in both \`layers.layout\` and \`export_policy\`.

- [ ] **Step 5: Run Python regression coverage.**

Run:

~~~powershell
pytest tests/test_streamer_layout.py tests/test_main_generation_pipeline.py -q
~~~

Expected: all focused tests pass, including the existing standard-layout and cleanup tests.

- [ ] **Step 6: Commit the Python processing change.**

~~~powershell
git add -- main.py tests/test_main_generation_pipeline.py
git commit -m "feat: make Streamer Stack tracking optional"
~~~

### Task 3: Persist gameplay selection and tracking settings in the Go API

**Files:**
- Modify: \`backend-go/internal/httpapi/deferred_clip_rendering.go\`
- Test: \`backend-go/internal/httpapi/server_test.go\`

- [ ] **Step 1: Add failing API tests.**

Add tests using the existing \`createDeferredRegionTestJob\`, \`NewServerWithStore\`, \`httptest.NewRequest\`, and temporary sidecar pattern. Cover these exact behaviors:

1. PATCH \`/gameplay-region\` saves the normalized gameplay rectangle in the selected result clip and metadata sidecar without changing a neighboring clip.
2. PATCH \`/streamer-tracking\` accepts \`{"streamer_tracking_enabled":true}\`, saves it in the selected result clip and sidecar, and leaves an omitted flag false when a child render is created.
3. A Streamer Stack render with a webcam region but no gameplay region returns \`409\` and creates no child.
4. A valid render copies webcam region, gameplay region, and tracking flag into child metadata.
5. Missing gameplay fields, non-positive dimensions, and out-of-bounds coordinates return \`400\`.

- [ ] **Step 2: Run the focused Go tests and verify they fail.**

Run:

~~~powershell
go test ./backend-go/internal/httpapi -run 'DeferredClip(Gameplay|Tracking|Render)' -count=1
~~~

Expected: the new routes and metadata fields are not yet recognized.

- [ ] **Step 3: Implement shared Go region validation and the two PATCH routes.**

Reuse the existing \`webcamRegionInput\` shape for gameplay validation through a field-aware validator so errors identify \`gameplay_region\`. Add route recognition for:

~~~text
PATCH /api/jobs/{job_id}/clips/{clip_index}/gameplay-region
PATCH /api/jobs/{job_id}/clips/{clip_index}/streamer-tracking
~~~

The gameplay route must update only the selected clip’s \`gameplay_region\`. The tracking route must decode \`{"streamer_tracking_enabled": true|false}\` and update only that clip’s flag. Both routes must validate parent job/status/clip index, update the metadata sidecar through the existing temporary-file-plus-rename helper, then update the parent result. Return \`clip_index\` plus the saved field in each response.

- [ ] **Step 4: Extend child-render validation and metadata copying.**

In the render route, parse and copy \`webcam_region\`, \`gameplay_region\`, and \`streamer_tracking_enabled\` from the clip into child metadata. Missing tracking remains \`false\). For \`streamer_stack\`, return \`409\` with explicit messages when either rectangle is absent, and return \`400\` for invalid saved coordinates. Preserve standard-layout behavior without requiring either field.

- [ ] **Step 5: Run Go tests and verify sidecar isolation.**

Run:

~~~powershell
go test ./backend-go/internal/httpapi -count=1
~~~

Expected: existing webcam-region tests and all new gameplay/tracking tests pass, including assertions that neighboring clips are unchanged.

- [ ] **Step 6: Commit the Go API change.**

~~~powershell
git add -- backend-go/internal/httpapi/deferred_clip_rendering.go backend-go/internal/httpapi/server_test.go
git commit -m "feat: persist Streamer Stack clip regions"
~~~

### Task 4: Add the reusable gameplay selector and per-clip controls

**Files:**
- Create: \`dashboard/src/components/ResultCard/SourceRegionSelector.jsx\`
- Create: \`dashboard/src/components/ResultCard/GameplayRegionSelector.jsx\`
- Modify: \`dashboard/src/components/ResultCard/WebcamRegionSelector.jsx\`
- Create: \`dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx\`
- Modify: \`dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx\`
- Modify: \`dashboard/src/components/ClipRenderControls.jsx\`
- Test: \`dashboard/src/components/ClipRenderControls.test.jsx\`

- [ ] **Step 1: Add failing selector and control tests.**

The shared selector tests must verify that a saved initial region is displayed, a drag creates a normalized rectangle, the reset action clears it, and the save callback receives \`{ x, y, width, height }\`. The controls tests must cover both missing-region gating and tracking default-off:

~~~jsx
it('requires both regions before Streamer Stack rendering', () => {
  render(
    <ClipRenderControls
      status="found"
      layoutFormat="streamer_stack"
      webcamRegion={{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }}
      onRender={vi.fn()}
      onSelectWebcamRegion={vi.fn()}
      onSelectGameplayRegion={vi.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Select Gameplay Area' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze & Render' })).toBeDisabled();
});

it('defaults tracking off and reports the explicit toggle value', () => {
  const onTrackingChange = vi.fn();
  render(
    <ClipRenderControls
      status="found"
      layoutFormat="streamer_stack"
      webcamRegion={{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }}
      gameplayRegion={{ x: 0.3, y: 0.1, width: 0.6, height: 0.8 }}
      streamerTrackingEnabled={false}
      onTrackingChange={onTrackingChange}
      onRender={vi.fn()}
    />,
  );

  const toggle = screen.getByRole('checkbox', { name: 'Use Face/Person Tracking' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(onTrackingChange).toHaveBeenCalledWith(true);
});
~~~

- [ ] **Step 2: Run the dashboard tests and verify they fail.**

Run:

~~~powershell
Set-Location dashboard
npm test -- --run src/components/ClipRenderControls.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
~~~

Expected: the new selector and props are missing.

- [ ] **Step 3: Extract the existing selector into a configurable source-region component.**

Move the current content-box letterbox math and pointer draw/move/resize logic into \`SourceRegionSelector\` with configurable \`title\`, \`description\`, \`selectionLabel\`, \`regionTestId\`, \`accentClass\`, \`initialRegion\`, \`onSave\`, \`onClose\`, \`isSaving\`, and \`error\` props. Retain the normalized minimum region size and add a \`Reset selection\` button that sets the region to \`null\`.

Make \`WebcamRegionSelector\` a thin wrapper with the existing labels and test IDs. Make \`GameplayRegionSelector\` use the same component with gameplay labels and help text stating that the selected rectangle becomes the lower panel and is center-cropped to fill it.

- [ ] **Step 4: Extend \`ClipRenderControls\` without changing standard clips.**

Add \`gameplayRegion\`, \`onSelectGameplayRegion\`, \`isSavingGameplayRegion\`, \`gameplayRegionError\`, \`streamerTrackingEnabled\`, and \`onTrackingChange\` props. For Streamer Stack, show both Select/Edit buttons, show an unchecked \`Use Face/Person Tracking\` checkbox when the prop is false or absent, and disable \`Analyze & Render\` until both regions pass the existing normalized-region validation. Show missing-selection guidance in found and failed states. For standard clips, keep the existing single \`Analyze & Render\` action with no new controls.

- [ ] **Step 5: Run dashboard component tests.**

Run:

~~~powershell
npm test -- --run src/components/ClipRenderControls.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
~~~

Expected: all selector and control tests pass.

- [ ] **Step 6: Commit the selector/control change.**

~~~powershell
git add -- dashboard/src/components/ResultCard/SourceRegionSelector.jsx dashboard/src/components/ResultCard/GameplayRegionSelector.jsx dashboard/src/components/ResultCard/WebcamRegionSelector.jsx dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx dashboard/src/components/ClipRenderControls.jsx dashboard/src/components/ClipRenderControls.test.jsx
git commit -m "feat: add manual gameplay selection controls"
~~~

### Task 5: Wire per-clip persistence into the project library and result card

**Files:**
- Modify: \`dashboard/src/components/ProjectLibrary.jsx\`
- Test: \`dashboard/src/components/ProjectLibrary.test.jsx\`
- Modify: \`dashboard/src/components/ResultCard.jsx\`

- [ ] **Step 1: Add failing project-library tests.**

Extend the existing Streamer Stack test with a saved gameplay selection and verify these requests are clip-specific:

~~~jsx
expect(fetchMock).toHaveBeenCalledWith(
  '/api/jobs/job-5/clips/0/gameplay-region',
  expect.objectContaining({
    method: 'PATCH',
    body: expect.stringContaining('gameplay_region'),
  }),
);
expect(fetchMock).toHaveBeenCalledWith(
  '/api/jobs/job-5/clips/0/streamer-tracking',
  expect.objectContaining({
    method: 'PATCH',
    body: '{"streamer_tracking_enabled":true}',
  }),
);
~~~

Also assert that clicking \`Analyze & Render\` before gameplay save leaves the render endpoint untouched, and that a second clip’s saved state does not enable the first clip.

- [ ] **Step 2: Run the project-library test and verify it fails.**

Run:

~~~powershell
Set-Location dashboard
npm test -- --run src/components/ProjectLibrary.test.jsx
~~~

Expected: the gameplay selector and PATCH requests are not present.

- [ ] **Step 3: Add per-clip state and persistence handlers.**

In \`ProjectLibrary\`, add state maps keyed by clip index for gameplay-region saving/errors and tracking updates. Add a handler with this request contract:

~~~jsx
const handleSaveGameplayRegion = async (clipIndex, gameplayRegion) => {
  const jobId = selectedProject?.job_id || selectedProject?.session_id || selectedProject?.id;
  if (!jobId) return false;

  const response = await fetch(
    getApiUrl('/api/jobs/' + encodeURIComponent(jobId) + '/clips/' + encodeURIComponent(clipIndex) + '/gameplay-region'),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameplay_region: gameplayRegion }),
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || 'Could not save gameplay area');

  const savedRegion = payload.gameplay_region || gameplayRegion;
  setProjectClips((current) => current.map((clip, index) =>
    (Number.isInteger(clip.index) ? clip.index : index) === clipIndex
      ? { ...clip, gameplay_region: savedRegion }
      : clip,
  ));
  return savedRegion;
};
~~~

Add the equivalent tracking PATCH to \`/streamer-tracking\`, update only the matching clip’s \`streamer_tracking_enabled\`, and restore the previous value on a failed request. Keep separate saving/error state for each setting and preserve the current webcam handler.

- [ ] **Step 4: Wire both selectors and controls into \`ResultCard\`.**

Track two modal states, render \`WebcamRegionSelector\` and \`GameplayRegionSelector\` with the selected clip’s source URL/start time/current region, and pass all state/handlers into \`ClipRenderControls\`. Use \`clip.streamer_tracking_enabled === true\` as the checked value so missing legacy metadata is off. Close only the modal that saved successfully.

- [ ] **Step 5: Run frontend tests and build.**

Run:

~~~powershell
npm test -- --run src/components/ProjectLibrary.test.jsx src/components/ClipRenderControls.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
npm run build
~~~

Expected: all targeted tests pass and the dashboard build completes successfully.

- [ ] **Step 6: Commit the project-library wiring.**

~~~powershell
git add -- dashboard/src/components/ProjectLibrary.jsx dashboard/src/components/ProjectLibrary.test.jsx dashboard/src/components/ResultCard.jsx
git commit -m "feat: wire per-clip Streamer Stack selections"
~~~

### Task 6: Run cross-layer verification and review scope

**Files:**
- Modify: none unless verification exposes a failing test.

- [ ] **Step 1: Run the complete focused regression suite.**

Run:

~~~powershell
pytest tests/test_streamer_layout.py tests/test_main_generation_pipeline.py -q
go test ./backend-go/internal/httpapi -count=1
Set-Location dashboard
npm test -- --run src/components/ClipRenderControls.test.jsx src/components/ProjectLibrary.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
npm run build
~~~

Expected: all commands exit successfully and standard-layout tests remain green.

- [ ] **Step 2: Verify the changed execution scope with GitNexus.**

Run \`detect_changes()\` and compare the result to the file map above. Confirm the only changed execution flows are Streamer Stack deferred rendering, its clip-region PATCH routes, and the associated dashboard result-card workflow. Inspect any unexpected callers or flows before the final handoff.

- [ ] **Step 3: Inspect the final behavior manually.**

Open a deferred Streamer Stack project and verify:

1. A clip with no saved regions shows both selection actions and a disabled render button.
2. Saving webcam and gameplay rectangles enables rendering while tracking remains unchecked.
3. Enabling tracking sends only that clip’s tracking PATCH and does not change another clip.
4. Rendering with tracking off produces the selected webcam panel and a centered, edge-cropped gameplay panel without detector log lines.
5. Standard 9:16 clips retain their existing single render action and output behavior.

- [ ] **Step 4: Confirm the final worktree contains only intended files.**

Run:

~~~powershell
git status --short
git diff --check
~~~

Expected: no unrelated user files are staged or modified; any remaining changes are limited to this feature and its tests.

