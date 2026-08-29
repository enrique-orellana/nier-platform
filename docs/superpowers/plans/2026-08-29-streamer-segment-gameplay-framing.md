# Per-Segment Streamer Gameplay Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Let users drag the exact gameplay framing for each selected Streamer layout segment in the preview, persist it in the version manifest, and render the same framing in the final video.

**Architecture:** Keep the existing clip-level \`gameplay_region\` as the validated outer boundary and add optional \`gameplay_focus\` and \`gameplay_zoom\` overrides to each layout segment. The dashboard preview and final Remotion composition will resolve the same effective framing from the active segment, while a preview-only overlay edits the selected segment and commits one undoable change on pointer-up.

**Tech Stack:** React, Remotion Player, TypeScript/TSX, JavaScript, Zod, Vitest, Testing Library, Prettier, ESLint, GitNexus, Docker/PowerShell local-app workflow.

---

## File map

- Modify \`dashboard/src/remotion/lib/types.ts\` and \`remotion/src/lib/types.ts\` to define normalized gameplay focus and segment overrides.
- Modify \`dashboard/src/editor/layoutTimelineModel.js\`, \`dashboard/src/remotion/lib/layoutSegments.ts\`, and \`remotion/src/lib/layoutSegments.ts\` to preserve, normalize, and resolve the new fields.
- Create \`dashboard/src/remotion/lib/gameplayFraming.ts\` and \`remotion/src/lib/gameplayFraming.ts\` for identical pure crop math used by preview and final rendering.
- Modify \`dashboard/src/remotion/compositions/ShortVideo.tsx\` and \`remotion/src/compositions/ShortVideo.tsx\` to apply per-segment framing without changing overlays or audio timing.
- Create \`dashboard/src/remotion/components/GameplayCropEditor.tsx\` for the preview-only drag/resize overlay.
- Modify \`dashboard/src/components/RemotionPreview.jsx\` and \`dashboard/src/components/local-editor/LocalEditorTab.jsx\` to pass preview-only editing callbacks and commit segment changes.
- Extend \`dashboard/src/editor/layoutTimelineModel.test.js\`, \`dashboard/src/remotion/lib/layoutSegments.test.ts\`, \`dashboard/src/remotion/lib/gameplayFraming.test.ts\`, \`dashboard/src/remotion/components/GameplayCropEditor.test.jsx\`, and \`dashboard/src/components/local-editor/LocalEditorTab.test.jsx\` with failing tests before implementation.
- Extend \`render-service/src/layoutSegments.test.ts\` and \`render-service/src/version-manifest.test.ts\` to verify render handoff and legacy compatibility.

## Task 1: Add the per-segment framing contract

**Files:**
- Modify: \`dashboard/src/remotion/lib/types.ts:80-120\`
- Modify: \`remotion/src/lib/types.ts:80-120\`
- Modify: \`dashboard/src/editor/layoutTimelineModel.js:22-62\`
- Modify: \`dashboard/src/remotion/lib/layoutSegments.ts:1-190\`
- Modify: \`remotion/src/lib/layoutSegments.ts:1-145\`
- Test: \`dashboard/src/editor/layoutTimelineModel.test.js\`
- Test: \`dashboard/src/remotion/lib/layoutSegments.test.ts\`
- Test: \`render-service/src/layoutSegments.test.ts\`

- [ ] **Step 1: Run GitNexus impact analysis for the segment normalizers and timeline model.**

Run \`impact\` upstream for \`normalizeLayoutSegments\` in both Remotion files, \`splitLayoutSegment\`, and \`updateLayoutSegment\` in \`dashboard/src/editor/layoutTimelineModel.js\`. If any result is HIGH or CRITICAL, stop and report the direct callers and affected processes before editing.

- [ ] **Step 2: Write the failing model tests.**

Add these assertions to \`dashboard/src/editor/layoutTimelineModel.test.js\`:

~~~js
it("preserves per-segment gameplay framing through normalization", () => {
  const normalized = normalizeLayoutSegments(
    [{
      id: "layout-1",
      startMs: 0,
      endMs: 12000,
      format: "streamer_stack",
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    }],
    12000,
  );

  expect(normalized[0]).toMatchObject({
    gameplay_focus: { x: 0.62, y: 0.44 },
    gameplay_zoom: 1.18,
  });
});

it("copies gameplay framing when a layout segment is split", () => {
  const result = splitLayoutSegment(
    [{
      id: "layout-1",
      startMs: 0,
      endMs: 12000,
      format: "streamer_stack",
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    }],
    "layout-1",
    5000,
  );

  expect(result).toEqual([
    expect.objectContaining({
      endMs: 5000,
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    }),
    expect.objectContaining({
      startMs: 5000,
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    }),
  ]);
});
it("clears only the selected segment framing override", () => {
  const result = clearLayoutSegmentFraming(
    [{
      id: "layout-1",
      startMs: 0,
      endMs: 12000,
      format: "streamer_stack",
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    }],
    "layout-1",
  );

  expect(result[0]).not.toHaveProperty("gameplay_focus");
  expect(result[0]).not.toHaveProperty("gameplay_zoom");
});
~~~

Add corresponding resolver coverage in both layout-segment test files:

~~~ts
it("keeps framing overrides on normalized resolved segments", () => {
  const segments = normalizeLayoutSegments({
    format: "standard",
    gameplay_zoom: 1,
    segments: [{
      id: "streamer",
      startMs: 0,
      endMs: 5000,
      format: "streamer_stack",
      gameplay_focus: { x: 0.7, y: 0.35 },
      gameplay_zoom: 1.4,
    }],
  }, 150, 30);

  expect(segments[0]).toMatchObject({
    gameplay_focus: { x: 0.7, y: 0.35 },
    gameplay_zoom: 1.4,
  });
});
~~~

- [ ] **Step 3: Run the focused tests and verify they fail for the missing fields.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/editor/layoutTimelineModel.test.js src/remotion/lib/layoutSegments.test.ts; Pop-Location
Push-Location render-service; npm test -- --run src/layoutSegments.test.ts; Pop-Location
~~~

Expected: FAIL because normalized Remotion segments currently discard unknown framing fields.

- [ ] **Step 4: Add the shared type fields and bounded normalization.**

Add the following types to both \`types.ts\` files:

~~~ts
export interface SourcePoint {
  x: number;
  y: number;
}

export interface LayoutSegmentConfig {
  id: string;
  startMs: number;
  endMs: number;
  format: LayoutFormat;
  transition?: LayoutTransition;
  transitionDurationMs?: number;
  gameplay_focus?: SourcePoint;
  gameplay_zoom?: number;
}
~~~

Add \`gameplay_focus\` and \`gameplay_zoom\` to the segment schemas, with focus coordinates in \`[0, 1]\` and zoom in \`[0.6, 2]\`. Keep the existing clip-level fields and make the layout schema retain the existing source-region fields.

In \`dashboard/src/editor/layoutTimelineModel.js\`, normalize optional fields without inventing an override when one was not saved:

~~~js
const normalizeGameplayFocus = (focus) => {
  const x = Number(focus?.x);
  const y = Number(focus?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
};

const normalizeGameplayZoom = (zoom) => {
  if (zoom == null || zoom === "") return undefined;
  const value = Number(zoom);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0.6, Math.min(2, value));
};
~~~

Use these helpers in \`normalizeSegment\` and preserve the rest of the segment object. The existing spread-based split and update functions must continue to copy these fields.

Add an explicit \`clearLayoutSegmentFraming(segments, segmentId)\` helper that
destructures \`gameplay_focus\` and \`gameplay_zoom\` out of only the matching
segment. Do not implement Reset by spreading \`{ gameplay_focus: undefined }\`;
the keys must be absent so fallback to clip-level settings remains observable in
saved JSON.

In both Remotion layout normalizers, spread the source segment into each normalized segment and normalize the optional focus/zoom fields so render-time resolution cannot receive NaN or out-of-range values.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run the commands from Step 3. Expected: all focused model and resolver tests PASS.

- [ ] **Step 6: Commit the contract changes.**

~~~powershell
git add dashboard/src/remotion/lib/types.ts remotion/src/lib/types.ts dashboard/src/editor/layoutTimelineModel.js dashboard/src/remotion/lib/layoutSegments.ts remotion/src/lib/layoutSegments.ts dashboard/src/editor/layoutTimelineModel.test.js dashboard/src/remotion/lib/layoutSegments.test.ts render-service/src/layoutSegments.test.ts
git commit -m "feat: preserve streamer framing per layout segment"
~~~

## Task 2: Make crop resolution segment-aware in preview and final rendering

**Files:**
- Create: \`dashboard/src/remotion/lib/gameplayFraming.ts\`
- Create: \`remotion/src/lib/gameplayFraming.ts\`
- Modify: \`dashboard/src/remotion/compositions/ShortVideo.tsx:40-485\`
- Modify: \`remotion/src/compositions/ShortVideo.tsx:35-315\`
- Test: \`dashboard/src/remotion/lib/gameplayFraming.test.ts\`
- Test: \`dashboard/src/remotion/compositions/ShortVideo.test.jsx\`

- [ ] **Step 1: Run GitNexus impact analysis for \`cropRegionToPanel\`, \`StreamerPanel\`, and \`LayoutVideoLayer\` in both composition files.**

Use the exact file paths to disambiguate symbols. Review the direct callers and affected preview/render processes; warn about HIGH or CRITICAL results before editing.

- [ ] **Step 2: Write the failing crop-resolution tests.**

Create \`dashboard/src/remotion/lib/gameplayFraming.test.ts\` with:

~~~ts
import { describe, expect, it } from "vitest";
import { resolveGameplayCrop } from "./gameplayFraming";

const region = { x: 0.2, y: 0.1, width: 0.7, height: 0.8 };

describe("resolveGameplayCrop", () => {
  it("uses the supplied focus and zoom", () => {
    const crop = resolveGameplayCrop({
      region,
      sourceAspect: 16 / 9,
      panelAspect: 1080 / 1192,
      focus: { x: 0.72, y: 0.38 },
      zoom: 1.6,
    });

    expect(crop.x).toBeGreaterThan(region.x);
    expect(crop.y).toBeGreaterThanOrEqual(region.y);
    expect(crop.width).toBeLessThan(region.width);
    expect(crop.height).toBeLessThan(region.height);
  });

  it("clamps focus to the selected gameplay region", () => {
    const crop = resolveGameplayCrop({
      region,
      sourceAspect: 16 / 9,
      panelAspect: 1080 / 1192,
      focus: { x: 2, y: -1 },
      zoom: 1,
    });

    expect(crop.x).toBeGreaterThanOrEqual(region.x);
    expect(crop.y).toBeGreaterThanOrEqual(region.y);
    expect(crop.x + crop.width).toBeLessThanOrEqual(region.x + region.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(region.y + region.height);
  });
});
~~~

Add a composition test that gives the active segment a different focus/zoom from the clip-level layout and verifies the Streamer gameplay panel uses the segment values.

- [ ] **Step 3: Run the crop tests and verify they fail.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/remotion/lib/gameplayFraming.test.ts src/remotion/compositions/ShortVideo.test.jsx; Pop-Location
~~~

Expected: FAIL because the pure crop resolver and segment-aware panel inputs do not yet exist.

- [ ] **Step 4: Extract identical pure crop helpers in dashboard and Remotion.**

Each \`gameplayFraming\` module must export:

~~~ts
export interface GameplayFramingInput {
  region: SourceRegion;
  sourceAspect: number;
  panelAspect: number;
  zoom?: number;
  focus?: SourcePoint;
}

export function resolveGameplayCrop(input: GameplayFramingInput): SourceRegion;
export function cropVideoStyle(crop: SourceRegion): React.CSSProperties;
~~~

Move the existing \`normalizeRegion\`, \`cropRegionToPanel\`, and \`cropVideoStyle\` behavior into these modules while preserving the current defaults, zoom bounds, and edge clamping. Keep the two files behaviorally identical because the dashboard preview and final renderer are separate build roots.

- [ ] **Step 5: Resolve effective segment framing in both compositions.**

When rendering the active segment, use:

~~~ts
const gameplayFocus = segment.gameplay_focus ?? layout?.gameplay_focus;
const gameplayZoom = segment.gameplay_zoom ?? layout?.gameplay_zoom;
~~~

Pass those values into the gameplay \`StreamerPanel\`. Do not apply segment framing to the webcam panel or Standard layout. During crossfade, each layer must receive its own segment values. Keep subtitle, hook, effect, and media clock code unchanged.

- [ ] **Step 6: Run crop, composition, and existing render tests.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/remotion/lib/gameplayFraming.test.ts src/remotion/compositions/ShortVideo.test.jsx src/remotion/lib/layoutSegments.test.ts; Pop-Location
Push-Location render-service; npm test -- --run src/layoutSegments.test.ts src/version-manifest.test.ts; Pop-Location
~~~

Expected: PASS, including existing Standard/Streamer transition and source-region coverage.

- [ ] **Step 7: Commit the segment-aware crop implementation.**

~~~powershell
git add dashboard/src/remotion/lib/gameplayFraming.ts dashboard/src/remotion/lib/gameplayFraming.test.ts remotion/src/lib/gameplayFraming.ts dashboard/src/remotion/compositions/ShortVideo.tsx remotion/src/compositions/ShortVideo.tsx dashboard/src/remotion/compositions/ShortVideo.test.jsx
git commit -m "feat: render segment-specific streamer framing"
~~~

## Task 3: Add the preview-only direct crop interaction

**Files:**
- Create: \`dashboard/src/remotion/components/GameplayCropEditor.tsx\`
- Test: \`dashboard/src/remotion/components/GameplayCropEditor.test.jsx\`
- Modify: \`dashboard/src/remotion/compositions/ShortVideo.tsx\`
- Modify: \`dashboard/src/remotion/lib/types.ts\`
- Modify: \`dashboard/src/components/RemotionPreview.jsx\`

- [ ] **Step 1: Run GitNexus impact analysis for \`RemotionPreview\` and the dashboard \`ShortVideo\` composition.**

Review preview callers and the Player input-prop flow. This is a shared preview component; warn before proceeding if GitNexus reports HIGH or CRITICAL risk.

- [ ] **Step 2: Write failing overlay interaction tests.**

Create a component test that renders a source region and crop, then verifies:

~~~jsx
it("moves the gameplay crop and commits only after pointer-up", () => {
  const onChange = vi.fn();
  render(
    <GameplayCropEditor
      region={{ x: 0.2, y: 0.1, width: 0.7, height: 0.8 }}
      crop={{ x: 0.35, y: 0.2, width: 0.35, height: 0.5 }}
      onChange={onChange}
      onDone={vi.fn()}
      onReset={vi.fn()}
    />,
  );

  const frame = screen.getByTestId("gameplay-crop-frame");
  fireEvent.pointerDown(frame, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(frame, { clientX: 130, clientY: 120 });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerUp(frame, { clientX: 130, clientY: 120 });
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("exposes reset and done actions", () => {
  const onReset = vi.fn();
  const onDone = vi.fn();
  render(
    <GameplayCropEditor
      region={region}
      crop={crop}
      onChange={vi.fn()}
      onDone={onDone}
      onReset={onReset}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Reset gameplay framing" }));
  fireEvent.click(screen.getByRole("button", { name: "Done framing gameplay" }));
  expect(onReset).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledOnce();
});
~~~

- [ ] **Step 3: Run the overlay tests and verify they fail.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/remotion/components/GameplayCropEditor.test.jsx; Pop-Location
~~~

Expected: FAIL because the component and preview-only composition props do not yet exist.

- [ ] **Step 4: Implement \`GameplayCropEditor\`.**

Render the effective gameplay region as the source view, dim outside the crop, draw the crop frame and four handles, and expose keyboard-accessible Reset and Done buttons. Use pointer capture on the frame. Convert pointer deltas to normalized source coordinates, clamp them to the outer gameplay region, and emit a draft \`{ focus, zoom }\` only on pointer-up. Use the same \`resolveGameplayCrop\` helper to calculate the frame so the visible rectangle matches the render.

- [ ] **Step 5: Add preview-only props without affecting render requests.**

Add optional fields to the dashboard composition props:

~~~ts
gameplayCropEditing?: boolean;
onGameplayCropChange?: (next: { focus: SourcePoint; zoom: number }) => void;
onGameplayCropReset?: () => void;
onGameplayCropDone?: () => void;
~~~

Pass these through \`RemotionPreview\` only in the in-browser Player input props. When \`isRendering\` is true or \`gameplayCropEditing\` is false, do not mount the editor overlay and do not call any editing callback. The preview-only fields must not be added to the render-service request payload.

- [ ] **Step 6: Run overlay, Player, and composition tests.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/remotion/components/GameplayCropEditor.test.jsx src/components/RemotionPreview.test.jsx src/remotion/compositions/ShortVideo.test.jsx; Pop-Location
~~~

Expected: PASS with the existing media-clock, Standard layout, and preview tests unchanged.

- [ ] **Step 7: Commit the preview interaction.**

~~~powershell
git add dashboard/src/remotion/components/GameplayCropEditor.tsx dashboard/src/remotion/components/GameplayCropEditor.test.jsx dashboard/src/remotion/compositions/ShortVideo.tsx dashboard/src/remotion/lib/types.ts dashboard/src/components/RemotionPreview.jsx dashboard/src/components/RemotionPreview.test.jsx
git commit -m "feat: add streamer gameplay crop preview"
~~~

## Task 4: Wire the selected timeline segment and persistence into the editor

**Files:**
- Modify: \`dashboard/src/components/local-editor/LocalEditorTab.jsx:220-390,800-860,2060-2140,2500-2670\`
- Modify: \`dashboard/src/components/local-editor/LocalEditorTimeline.jsx:120-470\`
- Test: \`dashboard/src/components/local-editor/LocalEditorTab.test.jsx\`
- Test: \`dashboard/src/components/local-editor/localEditorPersistence.test.js\`

- [ ] **Step 1: Run GitNexus impact analysis for \`LocalEditorTab\`, \`handleLayoutSelect\`, \`updateSelectedLayout\`, \`commitEdit\`, and \`LocalEditorTimeline\`.**

Review the editor state, undo/redo, persistence, and timeline-selection callers. Warn about HIGH or CRITICAL risk before editing.

- [ ] **Step 2: Write failing editor tests.**

Extend \`LocalEditorTab.test.jsx\` with these behaviors:

~~~jsx
it("shows gameplay framing only for a selected Streamer segment", () => {
  const layoutSegments = [
    { id: "layout-1", startMs: 0, endMs: 5000, format: "standard" },
    { id: "layout-2", startMs: 5000, endMs: 10000, format: "streamer_stack" },
  ];
  render(
    <LocalEditorTab
      initialVideoUrl="/videos/project.mp4"
      initialPlaybackDurationMs={10000}
      initialEditorState={{ ...controlledEditorState, layoutSegments }}
      initialStateKey="gameplay-framing-visibility"
    />,
  );

  expect(screen.queryByRole("button", { name: "Frame gameplay" })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByTestId("local-editor-layout-segment")[1]);
  expect(screen.getByRole("button", { name: "Frame gameplay" })).toBeInTheDocument();
});

it("commits one segment framing edit and leaves the clip defaults untouched", () => {
  const layoutSegments = [{
    id: "layout-1",
    startMs: 0,
    endMs: 10000,
    format: "streamer_stack",
    gameplay_zoom: 1,
  }];
  render(
    <LocalEditorTab
      initialVideoUrl="/videos/project.mp4"
      initialPlaybackDurationMs={10000}
      initialEditorState={{ ...controlledEditorState, layoutSegments }}
      initialStateKey="gameplay-framing-commit"
    />,
  );

  fireEvent.click(screen.getByTestId("local-editor-layout-segment"));
  fireEvent.click(screen.getByRole("button", { name: "Frame gameplay" }));
  fireEvent.click(screen.getByTestId("gameplay-crop-frame"));
  fireEvent.pointerUp(screen.getByTestId("gameplay-crop-frame"), {
    clientX: 180,
    clientY: 140,
  });

  expect(screen.getByTestId("local-editor-undo")).not.toBeDisabled();
});
~~~

Add a persistence test that writes a history snapshot containing \`gameplay_focus\` and \`gameplay_zoom\`, reads it back, and expects both fields to remain on the same segment.

- [ ] **Step 3: Run editor tests and verify they fail.**

Run:

~~~powershell
Push-Location dashboard; npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/localEditorPersistence.test.js; Pop-Location
~~~

Expected: FAIL because the toolbar action, framing draft state, and callback wiring do not yet exist.

- [ ] **Step 4: Add local draft state and segment-aware preview layout.**

In \`LocalEditorTab\`, add state for the active framing editor and a draft:

~~~js
const [gameplayFramingSegmentId, setGameplayFramingSegmentId] = useState(null);
const [gameplayFramingDraft, setGameplayFramingDraft] = useState(null);
~~~

Derive \`previewLayout\` by replacing only the selected segment's optional \`gameplay_focus\` and \`gameplay_zoom\` with the draft while framing is active. Do not mutate the clip-level \`remotionPreviewProps.layout\` defaults.

Close framing mode when the selected segment changes, when the Layout track is deselected, and when the selected segment is Standard. Entering framing mode pauses playback and seeks the playhead to the selected Streamer segment start so the preview shows that segment's layout.

- [ ] **Step 5: Add the timeline toolbar action and callback handlers.**

Place a compact button with a crop icon beside the existing Layout controls:

~~~jsx
{selectedLayoutSegment?.format === "streamer_stack" && (
  <button
    type="button"
    aria-label="Frame gameplay"
    title="Frame gameplay in preview"
    aria-pressed={gameplayFramingSegmentId === selectedLayoutSegment.id}
    onClick={beginGameplayFraming}
    disabled={busy}
  >
    <Crop size={12} aria-hidden="true" />
    Frame
  </button>
)}
~~~

\`onGameplayCropChange\` updates only the local draft. \`onGameplayCropDone\` commits \`{ gameplay_focus, gameplay_zoom }\` to the selected segment through \`updateSelectedLayout\` and exits framing. Reset calls \`clearLayoutSegmentFraming\` so the two keys are deleted from the selected segment, then exits. Use one \`commitEdit\` call per completed interaction so undo/redo remains clean.

- [ ] **Step 6: Pass callbacks to \`RemotionPreview\` and preserve saved history.**

Pass:

~~~jsx
gameplayCropEditing={gameplayFramingSegmentId === selectedLayoutSegment?.id}
onGameplayCropChange={handleGameplayCropChange}
onGameplayCropReset={resetGameplayFraming}
onGameplayCropDone={finishGameplayFraming}
~~~

The existing \`previewLayout\` is already used by export; because the committed segment fields live in \`editHistory.present.layoutSegments\`, export and saved editor history automatically receive the selected framing.

- [ ] **Step 7: Run editor and persistence tests.**

Run the commands from Step 3. Expected: PASS, including mode close on Standard selection/deselection, per-segment undo/redo, and local-storage round-trip.

- [ ] **Step 8: Commit editor integration.**

~~~powershell
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTimeline.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx dashboard/src/components/local-editor/localEditorPersistence.test.js
git commit -m "feat: edit streamer framing per timeline segment"
~~~

## Task 5: Verify manifest compatibility and final-render handoff

**Files:**
- Modify: \`render-service/src/version-manifest.test.ts\`
- Modify: \`render-service/src/render-props.test.ts\`
- Modify: \`dashboard/src/components/editor/FullScreenEditor.jsx\` only if a test demonstrates segment fields are dropped during version hydration

- [ ] **Step 1: Run GitNexus impact analysis for \`manifestToVersionRenderProps\` and \`buildRenderProps\`.**

Review the render request path and verify whether cloned manifest layout data already passes segment fields. Warn before changing route or render-props code if risk is HIGH or CRITICAL.

- [ ] **Step 2: Write the manifest round-trip tests.**

Add a fixture whose layout contains:

~~~ts
segments: [{
  id: "layout-2",
  startMs: 8000,
  endMs: 16000,
  format: "streamer_stack",
  gameplay_focus: { x: 0.62, y: 0.44 },
  gameplay_zoom: 1.18,
}]
~~~

Assert \`manifestToVersionRenderProps(manifest, metadata).layout.segments[0]\` contains the same focus and zoom, and assert \`buildRenderProps\` preserves the layout object unchanged. Include a legacy fixture without segment framing and assert it still produces a valid layout.

- [ ] **Step 3: Run the focused render-service tests.**

Run:

~~~powershell
Push-Location render-service; npm test -- --run src/version-manifest.test.ts src/render-props.test.ts; Pop-Location
~~~

Expected: PASS if the existing clone-based manifest path already preserves the fields; otherwise the test identifies the exact boundary that needs a minimal preservation fix.

- [ ] **Step 4: Run the full dashboard, renderer, and Remotion type checks.**

Run:

~~~powershell
Push-Location dashboard; npm test; npm run format; npm run format:check; npm run lint; Pop-Location
Push-Location render-service; npm test; npm run build; Pop-Location
Push-Location remotion; npm run build; Pop-Location
~~~

Expected: all tests pass, dashboard formatting is clean, lint has zero warnings, and both TypeScript builds succeed.

- [ ] **Step 5: Commit any minimal manifest fix and verification tests.**

~~~powershell
git add render-service/src/version-manifest.test.ts render-service/src/render-props.test.ts dashboard/src/components/editor/FullScreenEditor.jsx
git commit -m "test: preserve streamer framing in render handoff"
~~~

If \`FullScreenEditor.jsx\` remains unchanged, stage only the two test files.

## Task 6: Review scope, restart the inline app, and smoke-test the feature

**Files:** No new production files; verification and live-app workflow only.

- [ ] **Step 1: Run GitNexus change detection before the final commit.**

Run the GitNexus \`detect_changes\` tool with repository \`nier-platform\`, scope \`all\`, and worktree \`D:\\workspace\\openshorts\`. Confirm affected symbols are limited to gameplay framing, timeline editor, preview, and render-props flows. Investigate any unrelated changed symbol.

- [ ] **Step 2: Review worktree and staged paths.**

Run:

~~~powershell
git status --short
git diff --stat 271b218..HEAD
git diff --check 271b218..HEAD
~~~

Preserve unrelated user changes and stage only files belonging to this feature.

- [ ] **Step 3: Apply the committed changes to the live app.**

Because the feature modifies dashboard and Remotion/render-service code, run from the repository root:

~~~powershell
.\\scripts\\manage-local.ps1 -Action Restart
~~~

Wait for the command to finish successfully; do not claim the live app is updated on a build-only result.

- [ ] **Step 4: Verify service status and focused health checks.**

Run:

~~~powershell
.\\scripts\\manage-local.ps1 -Action Status
Invoke-WebRequest -UseBasicParsing http://localhost:18575/ -TimeoutSec 10
Invoke-RestMethod http://localhost:13101/health -TimeoutSec 10
~~~

Expected: frontend responds, the native renderer health endpoint is healthy, and the selected services are running.

- [ ] **Step 5: Perform the browser smoke test in Brave.**

Open the provided local editor URL in Brave and verify:

1. Standard segment selection has no crop action.
2. Streamer segment selection shows \`Frame gameplay\` in the timeline toolbar.
3. Framing mode shows the source gameplay region, dimmed outside crop, handles, Reset, and Done.
4. Dragging and zooming changes only the selected Streamer segment.
5. Splitting a framed segment copies framing to both halves.
6. Deselecting Layout closes framing mode.
7. Preview playback stays continuous across Standard/Streamer boundaries.
8. Rendering the version produces the same gameplay crop in the final output.

- [ ] **Step 6: Report the implementation commits, checks, and live-app result.**

Include the final commit hashes, focused/full test results, format/lint results, GitNexus change scope, restart result, and any browser smoke-test limitation.
