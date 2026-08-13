# Social Video Export Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every publishable MP4 follow one validated social-video contract regardless of whether it was produced by native Remotion, Python/FFmpeg, or the browser editor.

**Architecture:** Keep the existing renderers, but centralize canonical dimensions and metadata validation. Native and Python FFmpeg paths will emit explicit H.264/AAC/BT.709/fast-start settings; browser exports will be normalized through the backend before download. Validation will reject files with incorrect dimensions, pixel aspect, rotation, audio parameters, timing, color, or MP4 layout.

**Tech Stack:** Python, FFmpeg/ffprobe, TypeScript, Remotion 4.x, WebCodecs/Mediabunny, Vitest.

---

### Task 1: Add failing tests for canonical social-video policy

**Files:**
- Modify: `master_policy.py`
- Test: existing Python policy/validation tests found with `rg --files -g '*test*' -g 'test_*.py'`

- [ ] **Step 1: Locate the existing Python test modules and their fixtures.**

Run:

```powershell
rg --files -g '*test*' -g 'test_*.py' -g '*_test.py'
rg -n "choose_master_spec|validate_clip_output|master_video_encode_args|MediaProbe" .
```

- [ ] **Step 2: Add tests for canonical output dimensions and explicit SAR normalization.**

The tests must cover a 1920x1080 source and assert that the social output is a canonical 1080x1920 target rather than 608x1080, while retaining a separate opt-in source-preserving helper only if existing callers require it.

- [ ] **Step 3: Run only the new tests and verify they fail for the current 608x1080 behavior.**

```powershell
pytest <new-test-path> -q
```

Expected: failure showing the current dimensions do not meet the canonical social contract.

### Task 2: Implement canonical Python/FFmpeg output

**Files:**
- Modify: `master-export-policy.json`
- Modify: `master_policy.py`
- Modify: `main.py`
- Modify: `video_rendering.py`

- [ ] **Step 1: Update the policy with canonical target dimensions and explicit audio/channel/SAR requirements.**

- [ ] **Step 2: Make Python output use a canonical 9:16 target, `setsar=1`, explicit BT.709 SDR metadata, and audio stereo.**

- [ ] **Step 3: Preserve `+faststart` on the final mux and ensure all streams are mapped deterministically.**

- [ ] **Step 4: Run the focused policy tests and verify they pass.**

### Task 3: Add failing tests for native Remotion render options and output validation

**Files:**
- Modify: `render-service/src/master-policy.test.ts`
- Modify: `render-service/src/output-validation.test.ts`
- Modify: `render-service/src/master-policy.ts`
- Modify: `render-service/src/output-validation.ts`

- [ ] **Step 1: Add a test that requires the native render options to expose the profile, explicit audio sample rate/channels, color, and keyframe policy.**

- [ ] **Step 2: Add validation fixtures that fail for missing SAR/DAR, non-social dimensions, wrong audio sample rate/channels, rotation, non-BT.709 metadata, and excessive duration mismatch.**

- [ ] **Step 3: Run the focused Vitest tests and verify the new assertions fail against the current implementation.**

```powershell
cd render-service
npm test -- --run src/master-policy.test.ts src/output-validation.test.ts
```

### Task 4: Implement native Remotion hardening

**Files:**
- Modify: `render-service/src/master-policy.ts`
- Modify: `render-service/src/render-worker.ts`
- Modify: `render-service/src/output-validation.ts`

- [ ] **Step 1: Pass all Remotion options supported by the installed version and add a post-render FFmpeg normalization only where Remotion cannot express the contract.**

- [ ] **Step 2: Require the renderer validation to check the complete publishable contract, including video/audio streams, dimensions, SAR, rotation, color metadata, and durations.**

- [ ] **Step 3: Keep silent videos valid but make the audio policy explicit rather than accidental.**

- [ ] **Step 4: Run the focused native tests and the TypeScript build.**

### Task 5: Eliminate browser/server dependency drift and normalize browser exports

**Files:**
- Modify: `render-service/package.json`
- Modify: `remotion/package.json`
- Modify: `dashboard/package.json`
- Modify: corresponding lockfiles
- Modify: `dashboard/src/lib/renderInBrowser.js`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Pin every Remotion package to one exact version shared by service, composition, and dashboard.**

- [ ] **Step 2: Add explicit browser bitrate/keyframe/audio settings supported by the installed WebCodecs renderer.**

- [ ] **Step 3: Route browser-produced blobs through the server-side normalization endpoint before download, so browser output receives the same ffprobe validation as native output.**

- [ ] **Step 4: Run dashboard tests/build and verify dependency versions with `npm ls`.**

### Task 6: Add regression coverage and verify real artifacts

**Files:**
- Modify: relevant test files from Tasks 1, 3, and 5
- Create: a small fixture/diagnostic helper only if the repository has an established fixture location

- [ ] **Step 1: Add tests for PTS/DTS ordering, constant frame rate, first-frame keyframe, fast-start MP4 layout, and full decode.**

- [ ] **Step 2: Run all relevant Python, render-service, and dashboard tests.**

- [ ] **Step 3: Build the renderer and dashboard.**

- [ ] **Step 4: Inspect `git diff`, confirm no unrelated changes, and report any remaining limitation requiring a real failed-upload MP4.**
