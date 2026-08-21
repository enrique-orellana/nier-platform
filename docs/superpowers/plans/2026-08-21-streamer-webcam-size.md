# Streamer Stack Per-Clip Webcam Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Small/Medium/Large webcam panel-size selector to the Streamer Stack “Select Webcam Area” modal and persist the choice for the current clip.

**Architecture:** Extend the shared source-region modal with an optional webcam-only size control. The webcam wrapper and `ResultCard` pass the current clip’s `facecam_size` into the modal, and the existing webcam-region save callback sends the rectangle and size together. Extend the existing Go webcam-region PATCH handler to validate and persist both values; reuse the existing deferred-render metadata propagation and Python panel-height implementation.

**Tech Stack:** React 18, Vitest Testing Library, Go HTTP handlers, JSON metadata sidecars, existing Streamer Stack rendering pipeline.

---

## File map and change boundaries

- Modify `dashboard/src/components/ResultCard/SourceRegionSelector.jsx` to render an optional panel-size select and return its value only when the option is enabled. Gameplay-region behavior remains unchanged.
- Modify `dashboard/src/components/ResultCard/WebcamRegionSelector.jsx` to provide the three supported size options and webcam-specific labels/props.
- Modify `dashboard/src/components/ResultCard.jsx` to initialize the modal from `clip.facecam_size || "medium"` and forward the selected value to the parent save callback.
- Modify `dashboard/src/components/ProjectLibrary.jsx` to include `facecam_size` in the current clip’s webcam-region PATCH and merge the saved value into local clip state.
- Modify `dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx` and `dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx` to cover defaulting, selection, and save payload compatibility.
- Modify `dashboard/src/components/ProjectLibrary.test.jsx` to cover per-clip persistence and request payloads.
- Modify `backend-go/internal/httpapi/deferred_clip_rendering.go` to validate the optional size, preserve the existing size when omitted, persist it in the selected result/metadata clip, and return it.
- Modify `backend-go/internal/httpapi/server_test.go` to cover successful persistence, invalid-size rejection, S3 metadata updates, and child-render metadata forwarding.
- Do not modify `streamer_layout.py`, `main.py`, or the gameplay selector: the renderer already supports `small`, `medium`, and `large` panel ratios.

## Pre-edit impact findings

GitNexus impact analysis was run before planning edits:

- `SourceRegionSelector` is LOW risk with 3 direct callers, 12 total affected symbols, and affected `ProjectLibrary`/`App` dashboard flows. The direct callers include both the webcam and gameplay wrappers, so the optional prop path must preserve gameplay defaults.
- `updateWebcamRegion` is LOW risk with one direct caller, `clipRenderRoute`, in the `Httpapi` module.
- The two React callback closures were not represented as graph callers, so their wiring must be verified with the existing dashboard tests and manual source inspection.
- No HIGH or CRITICAL blast-radius warning was returned.

### Task 1: Add the optional webcam-size control to the shared modal

**Files:**
- Modify: `dashboard/src/components/ResultCard/SourceRegionSelector.jsx`
- Modify: `dashboard/src/components/ResultCard/WebcamRegionSelector.jsx`
- Test: `dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx`
- Test: `dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx`

- [ ] **Step 1: Write failing tests for webcam-size initialization and save payload.**

In `WebcamRegionSelector.test.jsx`, add a test that renders a valid initial region with `initialFacecamSize="large"`, asserts the labeled select has value `large`, changes it to `small`, saves, and expects the existing normalized region plus the second argument `"small"`:

```jsx
it("restores the current facecam size and returns the selected size on save", () => {
  const onSave = vi.fn();
  render(
    <WebcamRegionSelector
      videoUrl="/videos/source.mp4"
      initialRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
      initialFacecamSize="large"
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );

  prepareStage();
  const size = screen.getByLabelText("Webcam panel size");
  expect(size).toHaveValue("large");
  fireEvent.change(size, { target: { value: "small" } });
  fireEvent.click(screen.getByRole("button", { name: "Save webcam area" }));

  expect(onSave).toHaveBeenCalledWith(
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    "small",
  );
});
```

In `SourceRegionSelector.test.jsx`, add a compatibility assertion that a selector rendered without size props still calls `onSave` with only the region, preserving the Gameplay Area contract.

Also assert that rendering `WebcamRegionSelector` without `initialFacecamSize` selects `medium`, covering the legacy-clip default.

- [ ] **Step 2: Run the focused dashboard tests and verify they fail for the missing control.**

Run from `dashboard`:

```bash
npm test -- --run src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
```

Expected: FAIL because `Webcam panel size` is not rendered and the save callback has no size argument.

- [ ] **Step 3: Implement the optional shared-modal props and webcam wrapper configuration.**

Add optional props to `SourceRegionSelector`:

```jsx
panelSizeOptions = null,
initialPanelSize = "medium",
panelSizeLabel = "Panel size",
```

Keep an internal `panelSize` state synchronized with `initialPanelSize`. Render the select in the right-hand aside only when `panelSizeOptions` is a non-empty array, with a visible `<label htmlFor="...">` and one `<option>` per `{ value, label }`. Save with:

```jsx
const normalized = normalizeRegion(region);
if (panelSizeOptions?.length) {
  onSave(normalized, panelSize);
} else {
  onSave(normalized);
}
```

Ensure the existing gameplay wrapper still receives no size options and therefore keeps its one-argument callback. Update `WebcamRegionSelector` to pass:

```jsx
panelSizeOptions={[
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
]}
initialPanelSize={props.initialFacecamSize || "medium"}
panelSizeLabel="Webcam panel size"
```

- [ ] **Step 4: Run the focused dashboard tests and verify they pass.**

Run:

```bash
npm test -- --run src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx
```

Expected: PASS, including the existing gameplay-region behavior.

- [ ] **Step 5: Commit the modal-only change.**

```bash
git add dashboard/src/components/ResultCard/SourceRegionSelector.jsx dashboard/src/components/ResultCard/WebcamRegionSelector.jsx dashboard/src/components/ResultCard/SourceRegionSelector.test.jsx dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx
git commit -m "feat: add webcam panel size selector"
```

### Task 2: Wire the selector to the current clip in the dashboard

**Files:**
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `dashboard/src/components/ProjectLibrary.jsx`
- Test: `dashboard/src/components/ProjectLibrary.test.jsx`

- [ ] **Step 1: Write the failing dashboard integration assertions.**

Extend the existing `saves a webcam region per Streamer Stack clip before enabling render` test fixture with `facecam_size: "large"`. After opening the modal, assert:

```jsx
expect(screen.getByLabelText("Webcam panel size")).toHaveValue("large");
```

Change the select to `small` before saving, and in the webcam PATCH mock assert:

```jsx
const body = JSON.parse(options.body);
expect(body.facecam_size).toBe("small");
```

Return `facecam_size: "small"` from the mock response. Reopen the webcam modal after the save and assert it initializes to `small`, proving local state was updated for the selected clip.

- [ ] **Step 2: Run the focused integration test and verify it fails.**

Run from `dashboard`:

```bash
npm test -- --run src/components/ProjectLibrary.test.jsx
```

Expected: FAIL because `ResultCard` does not pass the current size, the callback does not forward it, and `ProjectLibrary` does not send or store it.

- [ ] **Step 3: Forward the current clip size and selected value through `ResultCard`.**

Pass `initialFacecamSize={clip.facecam_size || "medium"}` to `WebcamRegionSelector`. Change the local handler signature to:

```jsx
const handleSaveWebcamRegion = async (region, facecamSize) => {
  if (!onSaveWebcamRegion) {
    setShowWebcamRegionSelector(false);
    return true;
  }
  const saved = await onSaveWebcamRegion(
    index,
    region,
    facecamSize || clip.facecam_size || "medium",
  );
  if (saved !== false) setShowWebcamRegionSelector(false);
  return saved;
};
```

The fallback ensures the current configuration is always sent, including legacy clips with no stored field.

- [ ] **Step 4: Extend `ProjectLibrary` save and local-state merging.**

Change the callback to accept `facecamSize`, send both fields in the existing PATCH body, and read both fields from the response:

```jsx
body: JSON.stringify({
  webcam_region: webcamRegion,
  facecam_size: facecamSize,
}),
```

Use `payload.facecam_size || facecamSize || "medium"` and merge it only into the matching clip:

```jsx
return currentIndex === clipIndex
  ? { ...clip, webcam_region: savedRegion, facecam_size: savedFacecamSize }
  : clip;
```

Keep the existing loading/error/failure behavior and return the saved object or `false` as before.

- [ ] **Step 5: Run the dashboard integration test and verify it passes.**

Run:

```bash
npm test -- --run src/components/ProjectLibrary.test.jsx
```

Expected: PASS, including the existing render gating and gameplay selection assertions.

- [ ] **Step 6: Commit the dashboard wiring.**

```bash
git add dashboard/src/components/ResultCard.jsx dashboard/src/components/ProjectLibrary.jsx dashboard/src/components/ProjectLibrary.test.jsx
git commit -m "feat: persist webcam size per clip in dashboard"
```

### Task 3: Validate and persist `facecam_size` in the Go webcam PATCH endpoint

**Files:**
- Modify: `backend-go/internal/httpapi/deferred_clip_rendering.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Add failing API tests for success, response shape, and invalid sizes.**

Update `TestDeferredClipWebcamRegionPatchPersistsResultAndMetadata` to send:

```json
{"webcam_region":{"x":0.02,"y":0.18,"width":0.23,"height":0.43},"facecam_size":"large"}
```

Decode `facecam_size` from the response and assert it is `large`. Assert the selected result clip and metadata short contain `facecam_size: "large"`, while the neighboring clip remains unchanged.

Add a table-driven test that uses a valid webcam rectangle and each invalid value `"huge"`, `""`, and `"portrait"`; assert HTTP 400 and verify the stored result has no newly persisted invalid size.

Update the S3-backed webcam patch test to send `facecam_size: "small"` and assert the uploaded metadata contains both `webcam_region` and `"facecam_size":"small"`.

- [ ] **Step 2: Run the focused Go tests and verify they fail.**

Run from `backend-go`:

```bash
go test ./internal/httpapi -run 'TestDeferredClipWebcamRegionPatch' -count=1
```

Expected: FAIL because the request struct ignores `facecam_size`, the response omits it, and no size validation/persistence exists.

- [ ] **Step 3: Add a single supported-size validator.**

In `deferred_clip_rendering.go`, add:

```go
const defaultFacecamSize = "medium"

func normalizeFacecamSize(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "small", "medium", "large":
		return value, nil
	default:
		return "", fmt.Errorf("invalid facecam_size: %s", value)
	}
}
```

Use the existing `strings` and `fmt` imports already present in the file.

- [ ] **Step 4: Extend `updateWebcamRegion` without breaking legacy clients.**

Add an optional pointer field to the request struct:

```go
FacecamSize *string `json:"facecam_size"`
```

After loading and validating the selected result clip, determine the saved size as follows:

1. If the request includes `facecam_size`, validate it with `normalizeFacecamSize` and return HTTP 400 before writing metadata when invalid.
2. If omitted, keep the clip’s existing valid `facecam_size`.
3. If the clip has no valid saved value, use `defaultFacecamSize`.

Write the resolved size into `metadataClip["facecam_size"]` and `result.Clips[clipIndex]["facecam_size"]`. Include it in the success response:

```go
writeJSON(w, http.StatusOK, map[string]any{
	"clip_index":    clipIndex,
	"webcam_region": regionMap,
	"facecam_size":  facecamSize,
})
```

Do not modify other clips or unrelated metadata. Preserve the existing atomic metadata write and result persistence sequence.

- [ ] **Step 5: Run the focused Go tests and verify they pass.**

Run:

```bash
gofmt -w internal/httpapi/deferred_clip_rendering.go internal/httpapi/server_test.go
go test ./internal/httpapi -run 'TestDeferredClipWebcamRegionPatch' -count=1
```

Expected: PASS for valid local/S3 updates, invalid sizes, neighboring-clip isolation, and response fields.

- [ ] **Step 6: Commit the API change.**

```bash
git add backend-go/internal/httpapi/deferred_clip_rendering.go backend-go/internal/httpapi/server_test.go
git commit -m "feat: persist streamer webcam size per clip"
```

### Task 4: Verify deferred rendering receives the per-clip size

**Files:**
- Modify: `backend-go/internal/httpapi/server_test.go`
- Inspect only: `backend-go/internal/httpapi/deferred_clip_rendering.go`, `main.py`, `streamer_layout.py`

- [ ] **Step 1: Extend the existing deferred-render metadata test fixture.**

In the test that creates a child render from a saved Streamer Stack clip, add `"facecam_size":"large"` to the parent result clip and assert the created child metadata contains:

```go
if children[0].Metadata["facecam_size"] != "large" {
	t.Fatalf("child metadata lost facecam_size: %#v", children[0].Metadata)
}
```

- [ ] **Step 2: Run the focused deferred-render tests.**

Run from `backend-go`:

```bash
go test ./internal/httpapi -run 'TestDeferredClip.*Render|TestDeferredClipWebcamRegionPatch' -count=1
```

Expected: PASS. No Python change should be necessary because `render_deferred_clip` already reads `clip.facecam_size`, and `streamer_panel_heights` already maps the three supported values.

- [ ] **Step 3: Commit the regression coverage.**

```bash
git add backend-go/internal/httpapi/server_test.go
git commit -m "test: preserve webcam size in deferred renders"
```

### Task 5: Run repository-required verification and inspect change impact

- [ ] **Step 1: Run all focused backend and dashboard tests.**

Run:

```bash
cd backend-go
go test ./internal/httpapi ./internal/workers -count=1
cd ..\dashboard
npm test -- --run src/components/ResultCard/SourceRegionSelector.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ProjectLibrary.test.jsx
```

Expected: all selected Go and Vitest suites pass.

- [ ] **Step 2: Run required dashboard formatting and lint checks.**

From `dashboard`:

```bash
npm run format
npm run format:check
npm run lint
```

Expected: Prettier reports all files checked and ESLint exits successfully with zero warnings.

- [ ] **Step 3: Run the broader backend test suite.**

From `backend-go`:

```bash
go test ./... -count=1
```

Expected: PASS. If an unrelated pre-existing test fails, record its exact package and failure without changing unrelated code.

- [ ] **Step 4: Run GitNexus change detection before the final commit.**

Call `detect_changes()` and verify the diff is limited to the webcam modal, per-clip save route, and their tests. Unexpected execution flows or symbols require investigation before claiming completion.

- [ ] **Step 5: Review the final diff and working tree.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: no whitespace errors; only the planned dashboard/API/test files are changed; no generated artifacts or unrelated modifications are present.
