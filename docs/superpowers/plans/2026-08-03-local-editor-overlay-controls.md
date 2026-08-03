# Local Editor Overlay Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Viral Hook and subtitle-style parity to `/editor`, with optional/removable overlays and matching local preview/export behavior.

**Architecture:** Keep `hook` nullable and `subtitleCues` empty when their overlays are absent. Add a focused local-editor style module containing defaults, option lists, and canvas/CSS helpers; use it from the inspector, preview, and export renderer so the three surfaces share the same data contract. Keep all changes under `dashboard/src/components/local-editor/` and do not couple the standalone editor to the API-backed modal components.

**Tech Stack:** React, Vitest, React Testing Library, Canvas 2D, Tailwind utility classes, existing local SRT/VTT parser and `renderLocalVideo` helper.

---

### Task 1: Define shared local overlay style contracts

**Files:**
- Create: `dashboard/src/components/local-editor/localEditorStyles.js`
- Create: `dashboard/src/components/local-editor/localEditorStyles.test.js`

- [ ] **Step 1: Write the failing style-contract tests**

Add tests for the exact defaults and helper normalization:

```js
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STYLE,
  HOOK_ENTRANCE_OPTIONS,
  HOOK_SIZE_OPTIONS,
  normalizeSubtitleStyle,
  subtitlePositionClass,
} from './localEditorStyles';

describe('local editor overlay styles', () => {
  it('matches the existing hook options', () => {
    expect(HOOK_SIZE_OPTIONS.map((item) => item.value)).toEqual(['S', 'M', 'L']);
    expect(HOOK_ENTRANCE_OPTIONS.map((item) => item.value)).toEqual(['spring', 'fade', 'slide-up', 'none']);
  });

  it('normalizes subtitle style defaults without discarding overrides', () => {
    expect(normalizeSubtitleStyle({ fontFamily: 'Georgia', bgOpacity: 0.5 })).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      fontFamily: 'Georgia',
      bgOpacity: 0.5,
    });
  });

  it('maps subtitle positions to preview classes', () => {
    expect(subtitlePositionClass('top')).toContain('top');
    expect(subtitlePositionClass('middle')).toContain('top-1/2');
    expect(subtitlePositionClass('bottom')).toContain('bottom');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm test -- --run src/components/local-editor/localEditorStyles.test.js` from `dashboard/`.

Expected: FAIL because `localEditorStyles.js` does not exist yet.

- [ ] **Step 3: Implement the shared constants and helpers**

Create `localEditorStyles.js` with these contracts:

```js
export const HOOK_SIZE_OPTIONS = [
  { value: 'S', label: 'Small' },
  { value: 'M', label: 'Medium' },
  { value: 'L', label: 'Large' },
];

export const HOOK_ENTRANCE_OPTIONS = [
  { value: 'spring', label: 'Bounce' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'none', label: 'None' },
];

export const SUBTITLE_FONT_OPTIONS = ['Verdana', 'Arial', 'Impact', 'Helvetica', 'Georgia', 'Courier New'];
export const SUBTITLE_COLOR_PRESETS = ['#FFFFFF', '#FFDD00', '#00FFFF', '#00FF66', '#FF3333', '#FF66CC'];
export const SUBTITLE_ANIMATION_OPTIONS = [
  { value: 'pop', label: 'Pop' },
  { value: 'word-highlight', label: 'Glow' },
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'none', label: 'None' },
];

export const DEFAULT_SUBTITLE_STYLE = {
  position: 'bottom',
  fontFamily: 'Verdana',
  fontSize: 24,
  fontColor: '#FFFFFF',
  highlightColor: '#FFDD00',
  borderColor: '#000000',
  borderWidth: 2,
  bgColor: '#000000',
  bgOpacity: 0,
  animation: 'pop',
};

export const normalizeSubtitleStyle = (style = {}) => ({ ...DEFAULT_SUBTITLE_STYLE, ...style });

export const subtitlePositionClass = (position) => (
  position === 'top' ? 'top-[8%]' : position === 'middle' ? 'top-1/2 -translate-y-1/2' : 'bottom-[8%]'
);

export const hexToRgba = (hex, opacity) => {
  const value = String(hex || '#000000').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value;
  const red = parseInt(normalized.slice(0, 2), 16) || 0;
  const green = parseInt(normalized.slice(2, 4), 16) || 0;
  const blue = parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, Number(opacity) || 0))})`;
};
```

- [ ] **Step 4: Run the focused style tests and commit**

Run `npm test -- --run src/components/local-editor/localEditorStyles.test.js`; expect all tests to pass. Commit with `git add dashboard/src/components/local-editor/localEditorStyles.js dashboard/src/components/local-editor/localEditorStyles.test.js && git commit -m "feat: add local overlay style contracts"`.

### Task 2: Add failing UI tests for optional/removable controls

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Add hook parity and removal tests**

Extend the existing hook test to assert the controls from the supplied modal and removal behavior:

```jsx
fireEvent.click(screen.getByRole('button', { name: /add viral hook/i }));
expect(screen.getByLabelText('Hook position')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Small' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Bounce' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: /remove hook/i }));
expect(screen.getByText(/add a hook/i)).toBeInTheDocument();
```

- [ ] **Step 2: Add subtitle style and whole-track removal tests**

After importing the existing one-cue SRT in the test setup, select the cue on the timeline and assert the inspector exposes these labels: `Subtitle font`, `Subtitle position`, `Subtitle font size`, `Subtitle text color`, `Subtitle highlight color`, `Subtitle outline width`, `Subtitle background opacity`, and the `Pop` animation option. Then click `Remove Subtitles`, mock `window.confirm` to return `true`, and assert `screen.queryByText('Hello')` is absent and the export subtitles button is disabled.

- [ ] **Step 3: Run the focused UI test and verify it fails**

Run `npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`.

Expected: FAIL because the current inspector has neither hook size/entrance controls nor subtitle style/track removal controls.

### Task 3: Implement editor state, controls, and removal behavior

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Add subtitle style state and hook parity defaults**

Import the local style constants/helpers and initialize:

```jsx
const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
```

Create hooks with `size: 'M'` and `entranceAnimation: 'spring'` in addition to the existing local color/font/background fields. Reset subtitle style in `reset()` and normalize it after subtitle import only through the existing editor state update, not by changing cue timing.

- [ ] **Step 2: Replace the hook inspector with modal-parity controls**

Keep text, start/end, color, numeric font size, and background controls. Add button groups whose accessible names are exactly `Small`, `Medium`, `Large`, `Bounce`, `Fade`, `Slide Up`, and `None`; update `hook.size` and `hook.entranceAnimation` through `onChange`. Add a red `Remove Hook` button that calls a new `removeHook` callback.

The hook section header should render `Add Viral Hook` when `hook` is null and `Reset hook` only when the user explicitly wants to replace an existing hook; the inspector’s `Remove Hook` is the destructive/clearing action.

- [ ] **Step 3: Add a subtitle style inspector**

Keep the existing cue text/start/end/delete inspector and add a second style panel in the Subtitles section. Use controlled fields for:

```jsx
{
  position: 'top' | 'middle' | 'bottom',
  fontFamily: string,
  fontSize: number,
  fontColor: string,
  highlightColor: string,
  borderColor: string,
  borderWidth: number,
  bgColor: string,
  bgOpacity: number,
  animation: 'pop' | 'word-highlight' | 'karaoke' | 'none',
}
```

Use font options and animation options from `localEditorStyles.js`, color inputs plus the existing preset colors, a 0–5 outline-width range, and a background toggle that sets opacity to `0` when disabled and restores `0.5` when enabled. Add `Remove Subtitles` with `window.confirm('Remove all subtitles?')`; on confirmation clear cues, reset style, and clear selection.

- [ ] **Step 4: Pass style into preview/export and hide optional overlays**

Change `renderLocalVideo({ video: videoRef.current, subtitleCues, subtitleStyle, hook, onProgress })`. Render subtitle preview only when a cue exists, using position, font, text color, outline, background opacity, and animation. Render hook preview with its size preset and entrance animation. When `hook === null` or `subtitleCues.length === 0`, no corresponding overlay should be rendered.

- [ ] **Step 5: Run focused tests and commit**

Run `npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`; expect the new controls/removal assertions and all existing tests to pass. Commit with `git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx && git commit -m "feat: add optional local overlay controls"`.

### Task 4: Make local video export match editor styling

**Files:**
- Modify: `dashboard/src/components/local-editor/localEditorExport.js`
- Modify: `dashboard/src/components/local-editor/localEditorExport.test.js`

- [ ] **Step 1: Add failing export helper tests**

Export the pure helpers needed by the renderer and test that the chosen hook size changes font scale, the entrance mode produces a non-default transform/opacity during its opening interval, and subtitle style produces the requested font/background/outline values:

```js
expect(hookVisualState({ size: 'L', entranceAnimation: 'none' }, 100)).toMatchObject({ scale: 1.3, opacity: 1 });
expect(hookVisualState({ size: 'M', entranceAnimation: 'fade' }, 0).opacity).toBe(0);
expect(subtitleVisualStyle({ fontFamily: 'Georgia', fontColor: '#FFDD00', borderWidth: 3, bgColor: '#000000', bgOpacity: 0.5 })).toMatchObject({ fontFamily: 'Georgia', color: '#FFDD00', background: 'rgba(0, 0, 0, 0.5)' });
```

- [ ] **Step 2: Run the export tests and verify they fail**

Run `npm test -- --run src/components/local-editor/localEditorExport.test.js`.

Expected: FAIL because the export module does not expose or implement these visual helpers.

- [ ] **Step 3: Implement deterministic canvas visual helpers**

Add `hookVisualState(hook, elapsedMs)` with size scales `S: 0.8`, `M: 1`, `L: 1.3` and the existing Remotion entrance semantics approximated on canvas: spring scales/ fades in, fade changes opacity over 500 ms, slide-up changes `translateY` and opacity, and none remains fully visible. Add `subtitleVisualStyle(style)` using `normalizeSubtitleStyle`, `hexToRgba`, and a four-direction text shadow/stroke representation suitable for Canvas `strokeText`/`fillText`.

- [ ] **Step 4: Update `renderLocalVideo` inputs and drawing**

Accept `subtitleStyle = DEFAULT_SUBTITLE_STYLE`. Draw subtitles at the selected top/middle/bottom position with the selected font, size, colors, outline, background opacity, and cue-level animation. Draw hooks using `hookVisualState`, applying `context.globalAlpha` and a temporary translated/scaled canvas context, then restore the context before the next overlay. Preserve the existing local-only MediaRecorder flow and optional null/empty behavior.

- [ ] **Step 5: Run export tests and commit**

Run `npm test -- --run src/components/local-editor/localEditorExport.test.js`; expect all tests to pass. Commit with `git add dashboard/src/components/local-editor/localEditorExport.js dashboard/src/components/local-editor/localEditorExport.test.js && git commit -m "feat: export local overlay styles"`.

### Task 5: Full verification and handoff

**Files:**
- Modify: none unless verification reveals a test-only issue.

- [ ] **Step 1: Run all tests**

Run `npm test -- --run` from `dashboard/`; expected result is 20+ test files passing with no failures.

- [ ] **Step 2: Run lint and production build**

Run `npm run lint` and `npm run build` from `dashboard/`; both must exit 0. The known Vite large-chunk warning is acceptable if there are no build errors.

- [ ] **Step 3: Check repository hygiene**

Run `git diff --check` and `git status --short`; expected no whitespace errors and only intentional commits/changes.

- [ ] **Step 4: Review the final diff against the approved spec**

Confirm that hook removal clears timeline/preview/export, subtitle removal clears timeline/preview/export/download, all modal parity controls are present, and no existing `ClipEditor` files were modified.
