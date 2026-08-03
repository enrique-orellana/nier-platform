# Standalone Local Editor Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a standalone /editor tab for local video upload, SRT/VTT subtitle editing, viral hook overlays, and browser-local export without changing the existing backend ClipEditor.

**Architecture:** Keep all feature-specific code in dashboard/src/components/local-editor/. Use browser File/object URLs, native video, canvas, and MediaRecorder. Add only route/navigation/render wiring to App.jsx and routing.js; the new tab must not depend on backend manifests, versions, jobs, or APIs.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Tailwind utilities, lucide-react, and native HTML5 video/canvas/MediaRecorder APIs.

---

### Task 1: Add the /editor route

**Files:** Modify dashboard/src/routing.js; test dashboard/src/routing.test.js.

- [ ] Write this failing test:

~~~js
it('maps the standalone local editor tab to /editor', () => {
  expect(getPathForTab('editor')).toBe('/editor');
  expect(getTabFromPath('/editor')).toBe('editor');
  expect(parseRoute('/editor')).toMatchObject({ tab: 'editor', projectId: null, clipIndex: null, editor: false, versionId: null });
});
~~~

- [ ] Run from dashboard: npm test -- src/routing.test.js. Expected: FAIL because editor is not in TAB_PATHS.
- [ ] Add editor: '/editor' to TAB_PATHS.
- [ ] Run the same test. Expected: PASS.
- [ ] Commit with: git add dashboard/src/routing.js dashboard/src/routing.test.js; git commit -m "feat: add local editor route".

### Task 2: Add pure SRT/VTT parsing and SRT serialization

**Files:** Create dashboard/src/components/local-editor/subtitleFormats.js and subtitleFormats.test.js.

- [ ] Write failing tests for SRT multiline text, VTT headers/identifiers/settings, extension detection, malformed/empty files, and serialization:

~~~js
import { describe, expect, it } from 'vitest';
import { parseSubtitleFile, parseSrt, parseVtt, serializeSrt } from './subtitleFormats';

describe('subtitle formats', () => {
  it('parses SRT', () => {
    expect(parseSrt('1\n00:00:01,200 --> 00:00:03,400\nFirst\nSecond')).toEqual([
      { id: 'subtitle-1', text: 'First\nSecond', startMs: 1200, endMs: 3400 },
    ]);
  });
  it('parses VTT', () => {
    expect(parseVtt('WEBVTT\n\nintro\n00:00:00.500 --> 00:00:02.000 align:center\nHello')).toEqual([
      { id: 'intro', text: 'Hello', startMs: 500, endMs: 2000 },
    ]);
  });
  it('rejects TXT and malformed input', () => {
    expect(() => parseSubtitleFile('a.txt', 'Hi')).toThrow('Only .srt and .vtt');
    expect(() => parseSrt('')).toThrow('No subtitle cues found');
  });
  it('serializes milliseconds to SRT timestamps', () => {
    expect(serializeSrt([{ text: 'Hello', startMs: 1200, endMs: 3400 }]))
      .toBe('1\n00:00:01,200 --> 00:00:03,400\nHello\n');
  });
});
~~~

- [ ] Run npm test -- src/components/local-editor/subtitleFormats.test.js. Expected: FAIL because the module does not exist.
- [ ] Implement parseSrt, parseVtt, parseSubtitleFile, and serializeSrt. Normalize every cue to { id, text, startMs, endMs }, preserve line breaks, ignore VTT settings after the end timestamp, and throw readable errors for unsupported extensions, bad timestamps, empty cues, and endMs <= startMs.
- [ ] Run the same test. Expected: PASS.
- [ ] Commit with: git add dashboard/src/components/local-editor/subtitleFormats.js dashboard/src/components/local-editor/subtitleFormats.test.js; git commit -m "feat: add local subtitle format utilities".

### Task 3: Add local timeline and export helpers

**Files:** Create dashboard/src/components/local-editor/LocalEditorTimeline.jsx, localEditorExport.js, and localEditorExport.test.js.

- [ ] Write failing tests:

~~~js
import { describe, expect, it } from 'vitest';
import { activeCueAt, chooseRecordingMimeType, formatClock } from './localEditorExport';

describe('local editor export helpers', () => {
  it('finds a cue active at the playhead', () => {
    const cue = { id: 'one', startMs: 1000, endMs: 2000 };
    expect(activeCueAt([cue], 1000)).toEqual(cue);
    expect(activeCueAt([cue], 2000)).toBeNull();
  });
  it('formats the player clock', () => expect(formatClock(65000)).toBe('01:05'));
  it('chooses a supported mime type', () => {
    expect(chooseRecordingMimeType((type) => type === 'video/webm')).toBe('video/webm');
  });
});
~~~

- [ ] Run npm test -- src/components/local-editor/localEditorExport.test.js. Expected: FAIL because the module does not exist.
- [ ] Implement activeCueAt, formatClock, chooseRecordingMimeType, and renderLocalVideo. The renderer must draw video plus active subtitles/hook to a canvas, capture the canvas stream, add source audio when available, record with MediaRecorder, report progress, restore original video state in finally, and reject clearly when browser APIs are unavailable.
- [ ] Implement LocalEditorTimeline with ruler, Viral Hook row, Subtitles row, selection, seek, drag, and resize. Use moveCue and resizeCue from dashboard/src/editor/timelineModel.js.
- [ ] Run npm test -- src/editor/timelineModel.test.js src/components/local-editor/localEditorExport.test.js. Expected: PASS.
- [ ] Commit with: git add dashboard/src/components/local-editor; git commit -m "feat: add local editor timeline and export helpers".

### Task 4: Build the isolated LocalEditorTab

**Files:** Create dashboard/src/components/local-editor/LocalEditorTab.jsx and LocalEditorTab.test.jsx.

- [ ] Write failing component tests for empty state, local upload, SRT import, hook editing, and Reset:

~~~jsx
it('shows local-only upload', () => {
  render(<LocalEditorTab />);
  expect(screen.getByRole('heading', { name: 'Local Editor' })).toBeInTheDocument();
  expect(screen.getByText(/stays in your browser/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/upload video/i)).toBeInTheDocument();
});
~~~

- [ ] Run npm test -- src/components/local-editor/LocalEditorTab.test.jsx. Expected: FAIL because LocalEditorTab.jsx does not exist.
- [ ] Implement state for videoFile, videoUrl, durationMs, playheadMs, subtitleCues, hook, selected, error, busy, and progress. Use URL.createObjectURL, revoke old URLs on replacement/reset/unmount, support input accept video/* and drag/drop, set duration from onLoadedMetadata, and clamp cue times.
- [ ] Add subtitle input accept .srt/.vtt, read file.text(), call parseSubtitleFile, confirm before replacing existing cues, and preserve the old track on errors.
- [ ] Add subtitle inspector text/start/end/delete fields and hook inspector text/start/end/position/color/font-size/background fields. The Add Viral Hook default is:

~~~js
{ id: 'hook', text: 'Your viral hook', startMs: 0, endMs: Math.min(2500, durationMs), position: 'top', color: '#ffffff', fontSize: 48, background: '#111111' }
~~~

- [ ] Add native video playback and overlays: active subtitles bottom-centered; active hook at top/center/bottom. Use activeCueAt for preview and export.
- [ ] Add Export Video using renderLocalVideo and local filename openshorts-local-editor.webm. Add Export Subtitles using serializeSrt and filename openshorts-subtitles.srt. Disable unavailable/busy actions. Reset pauses, revokes URL, clears all local state, and returns to upload.
- [ ] Run npm test -- src/components/local-editor. Expected: PASS.
- [ ] Commit with: git add dashboard/src/components/local-editor; git commit -m "feat: add standalone local editor tab".

### Task 5: Wire navigation and view rendering

**Files:** Modify dashboard/src/App.jsx; test dashboard/src/routing.test.js.

- [ ] Import LocalEditorTab and Scissors. Add after Clip Generator:

~~~jsx
<button onClick={() => navigateToTab('editor')} className={activeTab === 'editor' ? 'active-nav-classes' : 'inactive-nav-classes'}>
  <Scissors size={20} />
  <span className="font-medium hidden lg:block">Local Editor</span>
</button>
~~~

Replace both class string examples with the existing sidebar classes used by the Clip Generator button, preserving the established dark OpenShorts styling and activeTab conditional.

- [ ] Render {activeTab === 'editor' && <LocalEditorTab />} with no API/project props.
- [ ] Run npm test -- src/routing.test.js and npm run lint. Expected: PASS and lint code 0 with no warnings.
- [ ] Commit with: git add dashboard/src/App.jsx dashboard/src/routing.js dashboard/src/routing.test.js; git commit -m "feat: expose local editor in app navigation".

### Task 6: Integrated verification

- [ ] From dashboard run npm test. Expected: zero failed tests.
- [ ] Run npm run build. Expected: Vite code 0.
- [ ] Run npm run lint. Expected: ESLint code 0 with no errors/warnings.
- [ ] Run git diff --check and git status --short. Expected: no whitespace errors and only intentional source/test changes.
- [ ] Start npm run dev -- --host 127.0.0.1 and manually verify /editor: local upload, SRT/VTT-only import, timeline movement/resizing, subtitle editing, hook timing/styling, local SRT download, local video export or readable browser capability error, and Reset.
- [ ] Commit only verified fixes with: git add dashboard/src/components/local-editor dashboard/src/App.jsx dashboard/src/routing.js dashboard/src/routing.test.js; git commit -m "fix: polish local editor verification findings".
