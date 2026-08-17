# Standard 9:16 Gameplay Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-clip preview modal that composes the saved gameplay region into a Standard 9:16 frame with temporary zoom controls.

**Architecture:** Keep the feature frontend-only. A new `Standard916Preview` component owns the modal, source-video playback, normalized-region crop math, and temporary zoom state. `ResultCard` opens it, while `ClipRenderControls` exposes the per-clip action and disables it until a valid gameplay region exists; no API, database, or render-pipeline changes are needed.

**Tech Stack:** React, Tailwind CSS, Lucide icons, Vitest, Testing Library, Vite.

---

## File map

- Create `dashboard/src/components/ResultCard/Standard916Preview.jsx` for the modal and 9:16 crop preview.
- Create `dashboard/src/components/ResultCard/Standard916Preview.test.jsx` for component behavior and zoom assertions.
- Modify `dashboard/src/components/ClipRenderControls.jsx` to expose the preview action for clips with or without a gameplay region.
- Modify `dashboard/src/components/ClipRenderControls.test.jsx` to cover the enabled and disabled preview states.
- Modify `dashboard/src/components/ResultCard.jsx` to hold modal state, pass the source clip timing and gameplay region, and render the modal.
- Modify `dashboard/src/components/ProjectLibrary.test.jsx` only if the existing per-clip integration fixture needs an assertion that the preview action is present; no API mock changes are expected.

### Task 1: Build the failing preview-component tests

**Files:**
- Create: `dashboard/src/components/ResultCard/Standard916Preview.test.jsx`

- [ ] **Step 1: Add the test fixture and opening behavior test**

Use a valid normalized region and a short source URL. Assert that the modal renders a 9:16 preview surface, the video uses the supplied URL, and the initial zoom label is `100%`.

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Standard916Preview from './Standard916Preview';

const gameplayRegion = { x: 0.35, y: 0.1, width: 0.55, height: 0.8 };

describe('Standard916Preview', () => {
  it('renders the selected gameplay region in a 9:16 preview', () => {
    render(
      <Standard916Preview
        videoUrl="/videos/source.mp4"
        startTime={12}
        endTime={24}
        gameplayRegion={gameplayRegion}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('standard-916-preview')).toHaveAttribute('data-aspect', '9:16');
    expect(screen.getByTestId('standard-916-preview-video')).toHaveAttribute('src', '/videos/source.mp4');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add zoom, reset, and close tests**

Extend the same test file with behavior assertions. The preview must change its crop transform after zooming in, return to the initial transform after reset, and call `onClose` once when closed.

```jsx
  it('changes and resets temporary zoom without changing clip metadata', () => {
    const onClose = vi.fn();
    render(
      <Standard916Preview
        videoUrl="/videos/source.mp4"
        startTime={12}
        endTime={24}
        gameplayRegion={gameplayRegion}
        onClose={onClose}
      />,
    );

    const video = screen.getByTestId('standard-916-preview-video');
    const initialTransform = video.style.transform;
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('110%')).toBeInTheDocument();
    expect(video.style.transform).not.toBe(initialTransform);
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(video.style.transform).toBe(initialTransform);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run the component tests and verify they fail for the expected reason**

Run from `D:\workspace\openshorts\dashboard`:

```powershell
npm test -- --run src/components/ResultCard/Standard916Preview.test.jsx
```

Expected result: FAIL because `Standard916Preview.jsx` does not exist yet.

### Task 2: Implement the preview modal and crop math

**Files:**
- Create: `dashboard/src/components/ResultCard/Standard916Preview.jsx`

- [ ] **Step 1: Implement normalized-region validation and crop positioning**

Create `hasValidRegion(region)` and calculate the source-video transform from the video’s intrinsic dimensions and the preview container dimensions. At zoom `1.0`, use:

```js
const scale = Math.max(
  containerWidth / (videoWidth * region.width),
  containerHeight / (videoHeight * region.height),
) * zoom;
const left = containerWidth / 2 - (region.x + region.width / 2) * videoWidth * scale;
const top = containerHeight / 2 - (region.y + region.height / 2) * videoHeight * scale;
```

Render the video absolutely inside a black `aspect-[9/16]` surface with `data-testid="standard-916-preview"` and `data-aspect="9:16"`. Apply the calculated `left` and `top` through `transform: translate(${left}px, ${top}px)`, and apply the calculated width and height to `data-testid="standard-916-preview-video"`. This makes zoom changes observable through the transform while keeping the video anchored around the selected region.

- [ ] **Step 2: Add playback timing and temporary zoom state**

Initialize zoom at `1`, change it by `0.1` with `Zoom out` and `Zoom in`, clamp it to `0.6..2.0`, and reset it to `1`. Seek to `startTime` on metadata load. If `endTime` is provided, pause and seek back to `startTime` when playback reaches it. Use the native video controls for play/pause and add accessible zoom/close buttons.

- [ ] **Step 3: Run the preview tests and verify they pass**

```powershell
npm test -- --run src/components/ResultCard/Standard916Preview.test.jsx
```

Expected result: PASS with the preview, zoom, reset, and close assertions green.

- [ ] **Step 4: Commit the isolated component**

```powershell
git add dashboard/src/components/ResultCard/Standard916Preview.jsx dashboard/src/components/ResultCard/Standard916Preview.test.jsx
git commit -m "feat: add Standard 9:16 gameplay preview"
```

### Task 3: Expose the preview action in clip controls

**Files:**
- Modify: `dashboard/src/components/ClipRenderControls.jsx`
- Modify: `dashboard/src/components/ClipRenderControls.test.jsx`

- [ ] **Step 1: Write the failing control tests**

Add one test that renders a valid `gameplayRegion`, clicks `Preview 9:16`, and expects `onPreviewGameplayRegion` to be called. Add another test that renders without a valid region and expects the same button to be disabled with helper text `Select Gameplay Area First`.

```jsx
it('opens the Standard 9:16 preview when gameplay is selected', () => {
  const onPreview = vi.fn();
  render(
    <ClipRenderControls
      status="found"
      gameplayRegion={{ x: 0.3, y: 0.1, width: 0.6, height: 0.8 }}
      onPreviewGameplayRegion={onPreview}
      onRender={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Preview 9:16' }));
  expect(onPreview).toHaveBeenCalledTimes(1);
});

it('disables the preview until a gameplay area exists', () => {
  render(<ClipRenderControls status="found" onPreviewGameplayRegion={vi.fn()} onRender={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Preview 9:16' })).toBeDisabled();
  expect(screen.getByText('Select Gameplay Area First')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the control tests and verify they fail**

```powershell
npm test -- --run src/components/ClipRenderControls.test.jsx
```

Expected result: FAIL because the control does not yet render `Preview 9:16`.

- [ ] **Step 3: Add the preview control and callback prop**

Add `onPreviewGameplayRegion` to the component props. Render the preview action for standard and Streamer Stack clips. It is enabled only when `hasValidRegion(gameplayRegion)` is true, and otherwise remains visible but disabled with the helper text required by the test. Keep the existing render, webcam, gameplay selection, and tracking controls unchanged.

- [ ] **Step 4: Run the control tests and verify they pass**

```powershell
npm test -- --run src/components/ClipRenderControls.test.jsx
```

Expected result: all existing control tests plus the two new preview tests pass.

- [ ] **Step 5: Commit the control integration**

```powershell
git add dashboard/src/components/ClipRenderControls.jsx dashboard/src/components/ClipRenderControls.test.jsx
git commit -m "feat: add per-clip gameplay preview action"
```

### Task 4: Wire `ResultCard` to the modal

**Files:**
- Modify: `dashboard/src/components/ResultCard.jsx`

- [ ] **Step 1: Run the existing ResultCard-adjacent tests before wiring**

```powershell
npm test -- --run src/components/ProjectLibrary.test.jsx src/components/ClipRenderControls.test.jsx
```

Expected result: PASS before the wiring change.

- [ ] **Step 2: Add modal state and callback wiring**

Import `Standard916Preview`, add `showStandard916Preview` state, and pass `onPreviewGameplayRegion={() => setShowStandard916Preview(true)}` into `ClipRenderControls`. Render the modal with `webcamSourceUrl`, `clip.start`, `clip.end`, and `clip.gameplay_region`. Close it by setting the state to false. Keep the existing webcam/gameplay selector modals independent.

```jsx
const [showStandard916Preview, setShowStandard916Preview] = useState(false);

// In ClipRenderControls props:
onPreviewGameplayRegion={() => setShowStandard916Preview(true)}

// Near the existing region selector modals:
{showStandard916Preview && (
  <Standard916Preview
    videoUrl={webcamSourceUrl}
    startTime={clip.start}
    endTime={clip.end}
    gameplayRegion={clip.gameplay_region}
    onClose={() => setShowStandard916Preview(false)}
  />
)}
```

- [ ] **Step 3: Run the integrated dashboard tests**

```powershell
npm test -- --run src/components/ClipRenderControls.test.jsx src/components/ProjectLibrary.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/Standard916Preview.test.jsx
```

Expected result: all focused dashboard tests pass, including the existing per-clip Streamer Stack workflow.

- [ ] **Step 4: Commit the `ResultCard` wiring**

```powershell
git add dashboard/src/components/ResultCard.jsx
git commit -m "feat: wire Standard 9:16 preview into clips"
```

### Task 5: Final verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the focused dashboard regression suite**

```powershell
cd D:\workspace\openshorts\dashboard
npm test -- --run src/components/ClipRenderControls.test.jsx src/components/ProjectLibrary.test.jsx src/components/ResultCard/SourceRegionSelector.test.jsx src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ResultCard/Standard916Preview.test.jsx
```

Expected result: all focused tests pass.

- [ ] **Step 2: Build the dashboard**

```powershell
npm run build
```

Expected result: Vite production build succeeds.

- [ ] **Step 3: Review the final change scope**

Run GitNexus `detect_changes({ repo: "openshorts", scope: "unstaged" })` before any implementation commit and confirm only the preview component, clip controls, `ResultCard`, and their tests are affected. Review `git diff --check` and `git status --short`.

- [ ] **Step 4: Commit the final verified changes if any remain**

```powershell
git add dashboard/src/components/ResultCard/Standard916Preview.jsx dashboard/src/components/ResultCard/Standard916Preview.test.jsx dashboard/src/components/ClipRenderControls.jsx dashboard/src/components/ClipRenderControls.test.jsx dashboard/src/components/ResultCard.jsx
git commit -m "feat: finish Standard 9:16 gameplay preview"
```
