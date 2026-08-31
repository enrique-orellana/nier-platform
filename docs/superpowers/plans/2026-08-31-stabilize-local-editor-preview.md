# Local Editor Preview Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Local Editor preview seeking, frame stepping, playback, audio, and Standard/Streamer layout transitions use one deterministic clip-relative clock.

**Architecture:** The editor playhead remains clip-relative and is the only value used by the timeline and transport. Remotion’s Player frame is the presentation clock; one native media element publishes media time for audio/subtitle synchronization, while visual layout layers never compete to publish or reset the clock. All seek paths update the editor clock and the Player through one helper, with source offsets applied only at the native-media boundary.

**Tech Stack:** React 18, Remotion Player 4.0.509, TypeScript Remotion compositions, Vitest, Testing Library, ESLint, Prettier.

---

### Task 1: Capture the broken playback contract with focused tests

**Files:**
- Modify: `dashboard/src/components/RemotionPreview.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/remotion/compositions/ShortVideo.test.jsx`

- [ ] **Step 1: Add a failing test for an explicit paused seek**

Add a test that renders `RemotionPreview` paused at frame 12 after the Player has emitted frame 0, then rerenders with frame 12 and asserts `seekTo(12)` is called exactly once.

- [ ] **Step 2: Add a failing test for frame stepping with a master-video offset**

Render `LocalEditorTab` with a Remotion preview whose source begins at 34.2 seconds, dispatch `ArrowRight` on the player region, and assert the preview receives frame `1` while the clip-relative timecode becomes one frame, not 34.2 seconds.

- [ ] **Step 3: Add a failing test for layout transitions sharing one media clock**

Render `ShortVideo` with adjacent Standard and Streamer segments and assert only the dedicated audio clock reports media time; the visual Standard/Streamer media elements must not publish competing clock updates.

- [ ] **Step 4: Run only the new tests and verify each fails for the intended synchronization behavior**

Run from `dashboard`:

```powershell
npm test -- src/components/RemotionPreview.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/remotion/compositions/ShortVideo.test.jsx
```

Expected: the new assertions fail because seek/playback state and layout media-clock ownership are currently split across several effects and media elements.

### Task 2: Introduce one clip-relative preview clock contract

**Files:**
- Modify: `dashboard/src/components/local-editor/localEditorPlayback.js`
- Modify: `dashboard/src/components/local-editor/localEditorPlayback.test.js`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/RemotionPreview.jsx`

- [ ] **Step 1: Add tested clock helpers**

Add pure helpers that clamp a clip-relative millisecond value, convert it to a bounded Remotion frame, and convert a clip-relative value to a source-media time using `clipStartMs`; cover zero, fractional-frame, negative, and end-of-range values.

- [ ] **Step 2: Route all editor seeks through the helpers**

Make timeline clicks, transport buttons, Home/End, and ArrowLeft/ArrowRight update the same clamped clip-relative playhead before seeking Remotion or native video. Do not derive the clip clock from a delayed frame callback while paused.

- [ ] **Step 3: Make Remotion controlled seeking edge-triggered**

Track the last requested frame and the last emitted Player frame separately. On paused external changes, seek only when the requested frame differs; on play/pause transitions, preserve the Player’s actual frame and do not replay a stale editor state into the Player.

- [ ] **Step 4: Run the focused clock tests and confirm they pass**

Run the commands in Task 1 and:

```powershell
npm test -- src/components/local-editor/localEditorPlayback.test.js
```

Expected: all focused clock and keyboard-seek tests pass.

### Task 3: Make the Remotion preview own media synchronization centrally

**Files:**
- Modify: `dashboard/src/remotion/compositions/ShortVideo.tsx`
- Modify: `dashboard/src/remotion/compositions/ShortVideo.test.jsx`
- Modify: `dashboard/src/remotion/lib/layoutSegments.ts`
- Modify: `dashboard/src/remotion/lib/layoutSegments.test.ts`

- [ ] **Step 1: Keep the hidden audio decoder as the sole native clock publisher**

The audio-only `BrowserVideo` publishes media time for the editor and subtitles. Standard and Streamer visual panels remain muted and must not call the editor clock callback, including during cuts and crossfades.

- [ ] **Step 2: Synchronize every visual layer to the current composition frame on seek**

When paused or when a seek/source/rate change is detected, assign the same source-media target to each visual video element. When playing, let the shared Player timeline advance all elements without independent layout-driven resets.

- [ ] **Step 3: Reset and prime media elements on source/segment transitions**

Ensure layout slot reuse does not leave a visual element at a previous segment’s frame. Preserve the slot identity for crossfades, but make source/frame synchronization explicit when the active slot’s presentation changes.

- [ ] **Step 4: Use the clip-relative composition frame for layout selection**

Resolve Standard/Streamer segments from the composition frame or the centralized media clock consistently, with boundaries treated deterministically so a frame at a cut cannot render the wrong layout.

- [ ] **Step 5: Run Remotion composition tests and verify both layout modes**

Run:

```powershell
npm test -- src/remotion/compositions/ShortVideo.test.jsx src/remotion/lib/layoutSegments.test.ts
```

Expected: visual layers render at the requested frame, layout boundaries select the expected segment, and only the audio clock drives media-time callbacks.

### Task 4: Harden Local Editor lifecycle and end-of-range behavior

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/RemotionPreview.jsx`
- Modify: `dashboard/src/components/RemotionPreview.test.jsx`

- [ ] **Step 1: Add failing tests for rapid seek, play/pause, and range end**

Cover repeated arrow presses while paused, seek while playing, switching Standard to Streamer at a cut, non-looping playback stopping at the final frame, looping returning to clip-relative zero, and a source offset staying out of the displayed timecode.

- [ ] **Step 2: Implement lifecycle cleanup and stale-callback guards**

Cancel pending clock timers/animation frames on unmount and source changes, ignore callbacks from a previous source, and clear the media-clock-active state when playback stops or a seek begins.

- [ ] **Step 3: Make range end and loop behavior use the same seek path**

Stop at the final valid composition frame, or seek to clip-relative zero for looping, without writing a master-source time into the clip timeline.

- [ ] **Step 4: Run all Local Editor and preview tests**

```powershell
npm test -- src/components/RemotionPreview.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/localEditorPlayback.test.js
```

Expected: all playback regression tests pass with no timer-related warnings.

### Task 5: Full frontend verification and change-impact review

**Files:**
- Review only files changed by Tasks 1–4.

- [ ] **Step 1: Run the complete dashboard test suite**

```powershell
npm test
```

- [ ] **Step 2: Run required formatting, lint, and build checks**

```powershell
npm run format
npm run format:check
npm run lint
npm run build
```

- [ ] **Step 3: Run GitNexus change detection**

Use GitNexus `detect_changes({ scope: "all", repo: "nier-platform" })`, review the affected symbols and execution flows, and confirm they are limited to preview/timeline/composition consumers expected by this plan.

- [ ] **Step 4: Review the final diff and repository status**

Confirm unrelated user changes are preserved and only the planned files are included before committing.

