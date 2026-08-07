# Visual Audio Reference Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real browser-decoded audio waveform as the last lane in the standalone `/editor` timeline so users can manually align hook and subtitle cues to the source audio.

**Architecture:** Keep waveform state isolated in a new `AudioWaveform` component. `LocalEditorTab` passes its active video URL through `LocalEditorTimeline`; the timeline owns layout/order while the waveform component loads and downsamples audio data. The feature is reference-only and does not change editor history, manifest persistence, playback, or export.

**Tech Stack:** React 18, Vitest, React Testing Library, Vite, `@remotion/media-utils` 4.0.447, existing Tailwind utility classes.

---

## File map

- Create `dashboard/src/components/local-editor/AudioWaveform.jsx` for browser audio loading, session caching, peak-bar normalization, and loading/error/success rendering.
- Create `dashboard/src/components/local-editor/AudioWaveform.test.jsx` with mocked media-utils behavior for success, loading, missing URL, and rejection states.
- Modify `dashboard/src/components/local-editor/LocalEditorTimeline.jsx` to accept `videoUrl`, add the bottom `Audio` lane, and preserve the existing cue/playhead interactions.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` to pass its active `videoUrl` into `LocalEditorTimeline`.
- Extend `dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx` with lane-order and audio reference assertions.
- Extend `dashboard/src/components/local-editor/LocalEditorTab.test.jsx` with an uploaded-video assertion that the audio lane is present in the actual editor.

### Task 1: Add failing waveform component tests

**Files:**
- Create: `dashboard/src/components/local-editor/AudioWaveform.test.jsx`
- Create: `dashboard/src/components/local-editor/AudioWaveform.jsx` (empty module export only until the test is run)

- [ ] **Step 1: Write the failing tests for the media-utils contract**

Create the test with module mocks so it does not decode real media in JSDOM:

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioData, getWaveformPortion } from '@remotion/media-utils';
import AudioWaveform from './AudioWaveform';

vi.mock('@remotion/media-utils', () => ({
    getAudioData: vi.fn(),
    getWaveformPortion: vi.fn(),
}));

describe('AudioWaveform', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads real audio data and renders peak bars', async () => {
        getAudioData.mockResolvedValue({ durationInSeconds: 4, channelWaveforms: [new Float32Array([0, 0.5, 1, 0.25])] });
        getWaveformPortion.mockReturnValue([
            { index: 0, amplitude: 0.25 },
            { index: 1, amplitude: 0.8 },
            { index: 2, amplitude: 0.45 },
        ]);

        render(<AudioWaveform videoUrl="blob:demo" durationMs={4000} sampleCount={3} />);

        await waitFor(() => expect(screen.getAllByTestId('audio-waveform-bar')).toHaveLength(3));
        expect(getAudioData).toHaveBeenCalledWith('blob:demo');
        expect(getWaveformPortion).toHaveBeenCalledWith(expect.objectContaining({
            audioData: expect.any(Object),
            startTimeInSeconds: 0,
            durationInSeconds: 4,
            numberOfSamples: 3,
        }));
        expect(screen.getByTestId('audio-waveform')).toHaveAttribute('aria-label', 'Audio waveform');
    });

    it('keeps the lane usable when audio decoding fails', async () => {
        getAudioData.mockRejectedValue(new Error('unsupported audio'));

        render(<AudioWaveform videoUrl="blob:bad" durationMs={4000} sampleCount={3} />);

        await waitFor(() => expect(screen.getByText('Audio waveform unavailable')).toBeInTheDocument());
        expect(screen.getByTestId('audio-waveform')).toBeInTheDocument();
    });

    it('shows a no-source state without attempting a decode', () => {
        render(<AudioWaveform durationMs={4000} sampleCount={3} />);

        expect(screen.getByText('No audio source')).toBeInTheDocument();
        expect(getAudioData).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `dashboard`:

```bash
npm test -- src/components/local-editor/AudioWaveform.test.jsx
```

Expected: FAIL because `AudioWaveform.jsx` does not yet implement the component and no waveform bars/states are rendered.

- [ ] **Step 3: Commit the failing-test checkpoint**

```bash
git add dashboard/src/components/local-editor/AudioWaveform.jsx dashboard/src/components/local-editor/AudioWaveform.test.jsx
git commit -m "test: specify audio waveform states"
```

### Task 2: Implement the isolated browser waveform

**Files:**
- Modify: `dashboard/src/components/local-editor/AudioWaveform.jsx`
- Test: `dashboard/src/components/local-editor/AudioWaveform.test.jsx`

- [ ] **Step 1: Implement the minimal loading/cache/peak-bar component**

Use this implementation shape, keeping decoded audio data module-scoped so it survives rerenders but not page reloads. Cache the decoded data rather than sampled bars so a later timeline-width change can request a different bar count without decoding again:

```jsx
import React, { useEffect, useState } from 'react';
import { getAudioData, getWaveformPortion } from '@remotion/media-utils';

const audioDataCache = new Map();
const DEFAULT_SAMPLE_COUNT = 192;

export default function AudioWaveform({ videoUrl = '', durationMs = 1, sampleCount = DEFAULT_SAMPLE_COUNT }) {
    const [state, setState] = useState({ status: videoUrl ? 'loading' : 'empty', bars: [] });

    useEffect(() => {
        let active = true;
        const durationSeconds = Math.max(0.001, Number(durationMs || 0) / 1000);

        if (!videoUrl) {
            setState({ status: 'empty', bars: [] });
            return () => { active = false; };
        }

        setState({ status: 'loading', bars: [] });
        const audioDataPromise = audioDataCache.get(videoUrl) || getAudioData(videoUrl).then((audioData) => {
            audioDataCache.set(videoUrl, audioData);
            return audioData;
        });
        audioDataPromise
            .then((audioData) => getWaveformPortion({
                audioData,
                startTimeInSeconds: 0,
                durationInSeconds: durationSeconds,
                numberOfSamples: Math.max(1, sampleCount),
            }))
            .then((bars) => {
                if (!active) return;
                setState({ status: 'ready', bars });
            })
            .catch(() => {
                if (active) setState({ status: 'error', bars: [] });
            });

        return () => { active = false; };
    }, [durationMs, sampleCount, videoUrl]);

    return (
        <div data-testid="audio-waveform" aria-label="Audio waveform" className="pointer-events-none flex h-full items-center gap-px overflow-hidden px-1">
            {state.status === 'ready' && state.bars.map((bar) => {
                const amplitude = Math.max(0.06, Math.min(1, Number(bar.amplitude) || 0));
                return <span key={bar.index} data-testid="audio-waveform-bar" className="w-px shrink-0 rounded-full bg-emerald-400/80" style={{ height: `${Math.max(8, amplitude * 84)}%` }} />;
            })}
            {state.status !== 'ready' && <span className="px-2 text-[10px] text-zinc-600">{state.status === 'loading' ? 'Loading waveform…' : state.status === 'empty' ? 'No audio source' : 'Audio waveform unavailable'}</span>}
        </div>
    );
}
```

The component must not revoke object URLs; `LocalEditorTab` owns those URLs. The `active` flag prevents late decode results from updating a changed video.

- [ ] **Step 2: Run the focused tests to verify the implementation passes**

```bash
npm test -- src/components/local-editor/AudioWaveform.test.jsx
```

Expected: PASS with three tests.

- [ ] **Step 3: Commit the isolated component**

```bash
git add dashboard/src/components/local-editor/AudioWaveform.jsx dashboard/src/components/local-editor/AudioWaveform.test.jsx
git commit -m "feat: render browser audio waveform peaks"
```

### Task 3: Add the audio lane as the final timeline element

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx`
- Test: `dashboard/src/components/local-editor/AudioWaveform.test.jsx`

- [ ] **Step 1: Add the failing timeline assertions**

Extend the existing timeline test file with these tests. Mock the focused waveform child at the top of `LocalEditorTimeline.test.jsx` so these tests isolate lane layout and do not attempt to decode media:

```jsx
vi.mock('./AudioWaveform', () => ({
    default: ({ videoUrl }) => <div data-testid="audio-waveform" data-video-url={videoUrl} />,
}));
```

```jsx
it('renders the audio lane after every cue lane', () => {
    render(<LocalEditorTimeline durationMs={10000} videoUrl="blob:demo" hook={{ id: 'hook', text: 'Hook', startMs: 0, endMs: 1000 }} subtitleCues={[{ id: 'cue-1', text: 'Caption', startMs: 1000, endMs: 2000 }]} />);

    const canvas = screen.getByTestId('local-editor-timeline-canvas');
    const lanes = [...canvas.querySelectorAll('[data-testid$="-track"]')];
    expect(lanes.map((lane) => lane.dataset.testid)).toEqual([
        'local-editor-hook-track',
        'local-editor-subtitles-track',
        'local-editor-audio-track',
    ]);
    expect(screen.getByText('Audio')).toBeInTheDocument();
});

it('keeps the audio lane present without a video URL', () => {
    render(<LocalEditorTimeline durationMs={10000} />);

    expect(screen.getByTestId('local-editor-audio-track')).toBeInTheDocument();
    expect(screen.getByText('No audio source')).toBeInTheDocument();
});
```

Add `data-testid` attributes to the existing hook/subtitle track wrappers while making the new audio track so the order assertion is structural rather than dependent on text duplication.

- [ ] **Step 2: Run the focused timeline tests to verify they fail**

```bash
npm test -- src/components/local-editor/LocalEditorTimeline.test.jsx
```

Expected: FAIL because `LocalEditorTimeline` does not accept `videoUrl`, does not render an audio lane, and has no lane test IDs.

- [ ] **Step 3: Implement the final audio lane without changing cue handlers**

In `LocalEditorTimeline.jsx`:

1. Import `AudioWaveform`.
2. Add `videoUrl = ''` to the component props.
3. Add `data-testid="local-editor-hook-track"` and `data-testid="local-editor-subtitles-track"` to the existing two lane wrappers.
4. Append this lane after the subtitle `Track`, before the existing playhead overlay:

```jsx
<div data-testid="local-editor-audio-track" className="flex min-h-12 w-full items-stretch border-b border-white/10 last:border-b-0">
    <div className="flex w-36 shrink-0 items-center bg-white/[.03] px-3 text-[11px] font-medium text-zinc-300">Audio</div>
    <div className="relative shrink-0 bg-black/20" style={{ width: `${timelineWidth}px` }}>
        <AudioWaveform videoUrl={videoUrl} durationMs={safeDuration} sampleCount={Math.max(96, Math.min(240, Math.ceil(timelineWidth / 4)))} />
    </div>
</div>
```

Keep the playhead overlay after this lane so it continues to cross every lane. Do not add pointer handlers to the audio lane or change `Track`'s cue drag/resize implementation.

- [ ] **Step 4: Run the timeline tests to verify they pass**

```bash
npm test -- src/components/local-editor/LocalEditorTimeline.test.jsx
```

Expected: PASS, including the existing cue movement/width tests and the new bottom-lane assertions.

- [ ] **Step 5: Commit the timeline integration**

```bash
git add dashboard/src/components/local-editor/LocalEditorTimeline.jsx dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx
git commit -m "feat: add audio reference lane to local timeline"
```

### Task 4: Pass the active video URL from the editor and verify the user path

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Add the failing integration assertion**

Extend `shows timeline controls after selecting a video` in `LocalEditorTab.test.jsx` with:

```jsx
expect(screen.getByTestId('local-editor-audio-track')).toBeInTheDocument();
expect(screen.getByTestId('audio-waveform')).toBeInTheDocument();
```

Mock the focused waveform child at the top of the file so the integration test can assert the URL passed through the real editor:

```jsx
vi.mock('./AudioWaveform', () => ({
    default: ({ videoUrl }) => <div data-testid="audio-waveform" data-video-url={videoUrl} />,
}));
```

Assert after upload:

```jsx
expect(screen.getByTestId('audio-waveform')).toHaveAttribute('data-video-url', 'blob:demo');
```

- [ ] **Step 2: Run the integration test to verify it fails**

```bash
npm test -- src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: FAIL because `LocalEditorTab` currently omits the `videoUrl` prop and the timeline does not yet expose the new audio lane through the editor path.

- [ ] **Step 3: Pass `videoUrl` into `LocalEditorTimeline`**

Update the existing JSX call in `LocalEditorTab.jsx` from:

```jsx
<LocalEditorTimeline durationMs={durationMs} subtitleCues={subtitleCues} hook={hook} selectedId={selected?.id} onSelect={handleTimelineSelect} onChange={handleTimelineChange} onChangeStart={beginTimelineEdit} onChangeEnd={endTimelineEdit} playheadMs={playheadMs} onSeek={handleSeek} />
```

to:

```jsx
<LocalEditorTimeline videoUrl={videoUrl} durationMs={durationMs} subtitleCues={subtitleCues} hook={hook} selectedId={selected?.id} onSelect={handleTimelineSelect} onChange={handleTimelineChange} onChangeStart={beginTimelineEdit} onChangeEnd={endTimelineEdit} playheadMs={playheadMs} onSeek={handleSeek} />
```

Do not add waveform data to `editHistory.present`; it is derived from the current video and should not create undo entries.

- [ ] **Step 4: Run the integration tests to verify they pass**

```bash
npm test -- src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: PASS, with the uploaded-video editor showing the Audio lane and passing the active blob URL to the waveform.

- [ ] **Step 5: Commit the editor wiring**

```bash
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: wire active video into audio reference track"
```

### Task 5: Run the full verification suite and review the rendered behavior

**Files:**
- Verify: `dashboard/src/components/local-editor/AudioWaveform.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Verify: related test files listed above

- [ ] **Step 1: Run all dashboard tests**

```bash
npm test
```

Expected: PASS with no regressions in local-editor cue movement, undo/redo, subtitle import, and export tests.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: PASS with zero warnings or errors. Fix only issues caused by this feature before continuing.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: PASS and produce the normal Vite output in `dashboard/dist`.

- [ ] **Step 4: Manually inspect `/editor` with a playable video**

Open `http://openshorts.127.0.0.1.nip.io/editor`, load a video, and confirm:

1. The Audio lane is below Subtitles.
2. The waveform bars line up with the same ruler and playhead as the cues.
3. Dragging a subtitle or hook cue still changes its timing.
4. A video with no decodable audio shows the fallback text without breaking the timeline.

- [ ] **Step 5: Review the final diff and working tree**

```bash
git diff -- dashboard/src/components/local-editor
git status --short
```

Expected: only the planned component, timeline/editor wiring, and focused tests are changed; no generated build output or unrelated files are staged.

- [ ] **Step 6: Commit the verified result**

```bash
git add dashboard/src/components/local-editor
git commit -m "test: verify visual audio reference track"
```
