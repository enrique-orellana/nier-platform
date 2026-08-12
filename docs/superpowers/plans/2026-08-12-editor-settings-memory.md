# Local Editor Settings Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist only the latest subtitle and viral-hook settings in browser storage and reuse them for new local-editor clips without copying previous clip content.

**Architecture:** Add a versioned, best-effort `localStorage` preference record separate from project history. `LocalEditorTab` initializes empty new-editor state from those preferences, saves only allowlisted settings after explicit setting changes, and leaves existing project histories authoritative.

**Tech Stack:** React, browser `localStorage`, Vitest, Testing Library, existing local-editor IndexedDB persistence.

---

## Contract and files

Preference key: `openshorts_local_editor_preferences_v1`

Preference shape:

```json
{
  "version": 1,
  "subtitleStyle": {},
  "subtitleLanguage": "en",
  "hookDefaults": {
    "position": "top",
    "size": "M",
    "entranceAnimation": "spring",
    "durationMs": 2500,
    "color": "#ffffff",
    "fontSize": 48,
    "background": "#111111",
    "fontFamily": "Arial"
  }
}
```

The allowlist excludes subtitle cues, cue text, word captions, hook text, hook id, and project selection state.

### Task 1: Add isolated editor-preference persistence helpers

**Files:**
- Create: `dashboard/src/components/local-editor/localEditorPreferences.js`
- Create: `dashboard/src/components/local-editor/localEditorPreferences.test.js`
- Modify: `dashboard/src/components/local-editor/localEditorPersistence.js:14-20`
- Modify: `dashboard/src/components/local-editor/localEditorPersistence.test.js:1-12`

- [ ] **Step 1: Write failing preference-helper tests**

Test defaults, round-trip persistence, malformed storage, and content exclusion:

```js
import {
    EDITOR_PREFERENCES_STORAGE_KEY,
    createDefaultEditorPreferences,
    readEditorPreferences,
    saveEditorPreferences,
    updateEditorPreferencesFromState,
} from './localEditorPreferences';

describe('local editor preferences', () => {
    beforeEach(() => localStorage.clear());

    it('returns built-in preferences when nothing has been saved', () => {
        expect(readEditorPreferences()).toEqual(createDefaultEditorPreferences());
    });

    it('round-trips the versioned settings record', () => {
        const preferences = createDefaultEditorPreferences();
        preferences.subtitleLanguage = 'es';
        preferences.hookDefaults.position = 'center';
        expect(saveEditorPreferences(preferences)).toBe(true);
        expect(JSON.parse(localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY))).toEqual(preferences);
        expect(readEditorPreferences()).toEqual(preferences);
    });

    it('falls back to defaults for malformed or incompatible records', () => {
        localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, '{bad json');
        expect(readEditorPreferences()).toEqual(createDefaultEditorPreferences());
        localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 99 }));
        expect(readEditorPreferences()).toEqual(createDefaultEditorPreferences());
    });

    it('extracts settings without persisting clip content', () => {
        const result = updateEditorPreferencesFromState(createDefaultEditorPreferences(), {
            subtitleCues: [{ id: 'cue-1', text: 'Do not copy me', startMs: 0, endMs: 1000 }],
            subtitleStyle: { fontSize: 56 },
            subtitleLanguage: 'it',
            hook: {
                id: 'hook', text: 'Do not copy this hook', startMs: 0, endMs: 4200,
                position: 'bottom', size: 'L', entranceAnimation: 'fade',
                color: '#00ff00', fontSize: 72, background: '#222222', fontFamily: 'Arial',
            },
        });
        expect(result.subtitleStyle.fontSize).toBe(56);
        expect(result.subtitleLanguage).toBe('it');
        expect(result.hookDefaults).toMatchObject({ position: 'bottom', size: 'L', durationMs: 4200 });
        expect(result).not.toHaveProperty('subtitleCues');
        expect(result.hookDefaults).not.toHaveProperty('text');
        expect(result.hookDefaults).not.toHaveProperty('id');
    });
});
```

Extend `localEditorPersistence.test.js` with an assertion that `createEmptyEditorHistory(preferences)` always returns `subtitleCues: []` and `hook: null`, while applying the supplied subtitle style and language.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
cd dashboard
npm test -- --run src/components/local-editor/localEditorPreferences.test.js src/components/local-editor/localEditorPersistence.test.js
```

Expected: FAIL because the preference module and parameterized empty-history behavior do not exist.

- [ ] **Step 3: Implement `localEditorPreferences.js`**

Use the existing style and hook constants. The implementation must validate the version, normalize subtitle style, constrain hook position/size/animation/duration, and catch all `localStorage` failures:

```js
import { HOOK_FONT_FAMILY } from '../../remotion/lib/hookVisual';
import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle } from './localEditorStyles';

export const EDITOR_PREFERENCES_STORAGE_KEY = 'openshorts_local_editor_preferences_v1';
export const EDITOR_PREFERENCES_VERSION = 1;
const DEFAULT_HOOK_DEFAULTS = {
    position: 'top', size: 'M', entranceAnimation: 'spring', durationMs: 2500,
    color: '#ffffff', fontSize: 48, background: '#111111', fontFamily: HOOK_FONT_FAMILY,
};
const clampDuration = (value) => Math.max(2000, Math.min(15000, Number(value) || 2500));

export const createDefaultEditorPreferences = () => ({
    version: EDITOR_PREFERENCES_VERSION,
    subtitleStyle: normalizeSubtitleStyle(DEFAULT_SUBTITLE_STYLE),
    subtitleLanguage: 'en',
    hookDefaults: { ...DEFAULT_HOOK_DEFAULTS },
});

export const normalizeEditorPreferences = (snapshot) => {
    const defaults = createDefaultEditorPreferences();
    if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== EDITOR_PREFERENCES_VERSION) return defaults;
    const hook = snapshot.hookDefaults && typeof snapshot.hookDefaults === 'object' ? snapshot.hookDefaults : {};
    return {
        version: EDITOR_PREFERENCES_VERSION,
        subtitleStyle: normalizeSubtitleStyle(snapshot.subtitleStyle),
        subtitleLanguage: String(snapshot.subtitleLanguage || 'en').toLowerCase(),
        hookDefaults: {
            ...defaults.hookDefaults,
            position: ['top', 'center', 'bottom'].includes(hook.position) ? hook.position : defaults.hookDefaults.position,
            size: ['S', 'M', 'L'].includes(hook.size) ? hook.size : defaults.hookDefaults.size,
            entranceAnimation: ['spring', 'fade', 'slide-up', 'none'].includes(hook.entranceAnimation) ? hook.entranceAnimation : defaults.hookDefaults.entranceAnimation,
            durationMs: clampDuration(hook.durationMs),
            color: String(hook.color || defaults.hookDefaults.color),
            fontSize: Number(hook.fontSize) || defaults.hookDefaults.fontSize,
            background: String(hook.background || defaults.hookDefaults.background),
            fontFamily: String(hook.fontFamily || defaults.hookDefaults.fontFamily),
        },
    };
};

export const readEditorPreferences = () => {
    try {
        const stored = localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY);
        return stored ? normalizeEditorPreferences(JSON.parse(stored)) : createDefaultEditorPreferences();
    } catch {
        return createDefaultEditorPreferences();
    }
};

export const saveEditorPreferences = (preferences) => {
    try {
        localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeEditorPreferences(preferences)));
        return true;
    } catch {
        return false;
    }
};

export const updateEditorPreferencesFromState = (preferences, state) => {
    const current = normalizeEditorPreferences(preferences);
    const next = {
        ...current,
        subtitleStyle: normalizeSubtitleStyle(state?.subtitleStyle),
        subtitleLanguage: String(state?.subtitleLanguage || current.subtitleLanguage).toLowerCase(),
    };
    if (state?.hook) {
        next.hookDefaults = {
            ...current.hookDefaults,
            position: state.hook.position,
            size: state.hook.size,
            entranceAnimation: state.hook.entranceAnimation,
            durationMs: clampDuration(Number(state.hook.endMs) - Number(state.hook.startMs)),
            color: state.hook.color,
            fontSize: state.hook.fontSize,
            background: state.hook.background,
            fontFamily: state.hook.fontFamily,
        };
    }
    return normalizeEditorPreferences(next);
};
```

Add an optional `preferences` argument to `createEmptyEditorHistory` in `localEditorPersistence.js`:

```js
export const createEmptyEditorHistory = (preferences = null) => ({
    past: [],
    present: {
        subtitleCues: [],
        subtitleStyle: normalizeSubtitleStyle(preferences?.subtitleStyle),
        subtitleLanguage: String(preferences?.subtitleLanguage || 'en').toLowerCase(),
        hook: null,
    },
    future: [],
});
```

It must still create empty cues and a null hook. Leave `readEditorHistory` unchanged for legacy migration.

- [ ] **Step 4: Run persistence tests and commit**

```powershell
cd dashboard
npm test -- --run src/components/local-editor/localEditorPreferences.test.js src/components/local-editor/localEditorPersistence.test.js
cd ..
git add dashboard/src/components/local-editor/localEditorPreferences.js dashboard/src/components/local-editor/localEditorPreferences.test.js dashboard/src/components/local-editor/localEditorPersistence.js dashboard/src/components/local-editor/localEditorPersistence.test.js
git commit -m "feat: persist local editor settings"
```

Expected: focused tests pass before the commit.

### Task 2: Apply remembered settings to new clips and save explicit setting changes

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx:16,302-305,423-455,560-565,680-683,695,1080-1088`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx:1-50,130-220,380-420`

- [ ] **Step 1: Write failing component tests**

Add tests for new-clip initialization, fresh hook content, settings-only persistence, and project-state authority:

```jsx
it('uses remembered settings without copying previous content', async () => {
    localStorage.setItem('openshorts_local_editor_preferences_v1', JSON.stringify({
        version: 1,
        subtitleStyle: { fontSize: 56, fontColor: '#00FF00' },
        subtitleLanguage: 'it',
        hookDefaults: { position: 'center', size: 'L', entranceAnimation: 'fade', durationMs: 4200, color: '#00ff00', fontSize: 72, background: '#222222', fontFamily: 'Arial' },
    }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
    expect(screen.getByLabelText('Subtitle font size')).toHaveValue(56);
    expect(screen.getByLabelText('Subtitle source language')).toHaveValue('it');
    expect(screen.queryByLabelText('Subtitle text')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /toggle viral hook settings/i }));
    fireEvent.click(screen.getByRole('button', { name: /add viral hook/i }));
    expect(screen.getByLabelText('Hook text')).toHaveValue('Your viral hook');
    expect(screen.getByRole('button', { name: 'Center' })).toHaveClass('bg-white');
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('bg-white');
    expect(screen.getByRole('button', { name: 'Fade' })).toHaveClass('bg-white');
});

it('saves changed settings but excludes subtitle and hook text', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
    fireEvent.change(screen.getByLabelText('Subtitle font size'), { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: /toggle viral hook settings/i }));
    fireEvent.click(screen.getByRole('button', { name: /add viral hook/i }));
    fireEvent.change(screen.getByLabelText('Hook text'), { target: { value: 'Clip-specific text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('openshorts_local_editor_preferences_v1')).subtitleStyle.fontSize).toBe(64));
    const saved = JSON.parse(localStorage.getItem('openshorts_local_editor_preferences_v1'));
    expect(saved.hookDefaults.position).toBe('bottom');
    expect(saved).not.toHaveProperty('subtitleCues');
    expect(saved.hookDefaults).not.toHaveProperty('text');
});

it('keeps supplied existing project settings instead of applying global defaults', async () => {
    localStorage.setItem('openshorts_local_editor_preferences_v1', JSON.stringify({ version: 1, subtitleStyle: { fontSize: 64 }, subtitleLanguage: 'it', hookDefaults: { position: 'bottom' } }));
    render(<LocalEditorTab initialEditorState={{ subtitleCues: [{ id: 'cue-1', text: 'Saved cue', startMs: 0, endMs: 1000 }], subtitleStyle: { fontSize: 32 }, subtitleLanguage: 'es', hook: null }} initialStateKey="saved-project" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
    expect(screen.getByLabelText('Subtitle font size')).toHaveValue(32);
    expect(screen.getByLabelText('Subtitle source language')).toHaveValue('es');
});
```

- [ ] **Step 2: Run the component tests and verify RED**

```powershell
cd dashboard
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests fail because initialization still uses the old defaults, `addHook` still uses hardcoded settings, and controls do not write the preference key.

- [ ] **Step 3: Initialize new editor state from preferences**

Import `readEditorPreferences`, `saveEditorPreferences`, and `updateEditorPreferencesFromState`. Replace the new-editor initializer with:

```jsx
const [editHistory, setEditHistory] = useState(() => {
    const preferences = readEditorPreferences();
    const history = createEmptyEditorHistory(preferences);
    return initialEditorState
        ? { ...history, present: { ...history.present, ...initialEditorState } }
        : history;
});
const editorPreferencesRef = useRef(readEditorPreferences());

const rememberEditorSettings = (state) => {
    const next = updateEditorPreferencesFromState(editorPreferencesRef.current, state);
    editorPreferencesRef.current = next;
    saveEditorPreferences(next);
};
```

Do not call `readEditorHistory()` for a new editor state. Keep it for legacy migration. Existing `initialEditorState` and `loadStoredProject` hydration must continue to use their supplied project state and must not call `rememberEditorSettings`.

- [ ] **Step 4: Reuse hook defaults while keeping fresh text**

Replace the hardcoded hook object in `addHook` with:

```jsx
const addHook = () => {
    if (hook && !window.confirm('Replace the current viral hook?')) return;
    const { durationMs: hookDurationMs, ...hookDefaults } = editorPreferencesRef.current.hookDefaults;
    const nextHook = {
        id: 'hook', text: 'Your viral hook', startMs: 0,
        endMs: Math.min(hookDurationMs, durationMs), ...hookDefaults,
    };
    rememberEditorSettings({ ...editHistoryRef.current.present, hook: nextHook });
    commitEdit((current) => ({ ...current, hook: nextHook }));
    setSelected({ id: 'hook', type: 'hook' });
    setHookOpen(true);
};
```

Update `updateHook` so visual/timing changes are remembered but hook text is ignored by the helper. Leave `removeHook` without a preference call:

```jsx
const updateHook = (nextHook, options) => {
    const normalizedHook = clampCue(nextHook, durationMs);
    rememberEditorSettings({ ...editHistoryRef.current.present, hook: normalizedHook });
    commitEdit((current) => ({ ...current, hook: normalizedHook }), options);
};
```

- [ ] **Step 5: Persist subtitle style and language only from controls**

Add explicit handlers:

```jsx
const updateSubtitleStyle = (nextStyle) => {
    rememberEditorSettings({ ...editHistoryRef.current.present, subtitleStyle: nextStyle });
    commitEdit((current) => ({ ...current, subtitleStyle: nextStyle }));
};

const updateSubtitleLanguage = (nextLanguage) => {
    rememberEditorSettings({ ...editHistoryRef.current.present, subtitleLanguage: nextLanguage });
    commitEdit((current) => ({ ...current, subtitleLanguage: nextLanguage }));
};
```

Wire `SubtitleStyleInspector onChange={updateSubtitleStyle}` and the source-language `<select>` to `updateSubtitleLanguage`. Do not call the helpers from `removeSubtitles`, undo, redo, cue edits, or hook removal. Change `startNewProject` to call `createEmptyEditorHistory(editorPreferencesRef.current)` so it resets content while reusing the latest settings.

- [ ] **Step 6: Run focused tests, lint, and commit the integration**

```powershell
cd dashboard
npm test -- --run src/components/local-editor/localEditorPreferences.test.js src/components/local-editor/localEditorPersistence.test.js src/components/local-editor/LocalEditorTab.test.jsx
npm run lint
cd ..
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: reuse local editor settings"
```

Expected: focused tests pass and lint exits 0 before committing.

### Task 3: Run complete verification and deploy locally

**Files:**
- No source changes expected.

- [ ] **Step 1: Run frontend verification**

```powershell
cd dashboard
npm test
npm run lint
npm run build
```

Expected: all frontend tests pass, lint exits 0, and Vite builds successfully. Existing informational Mediabunny/Browserslist warnings may remain.

- [ ] **Step 2: Run backend verification**

```powershell
cd ..
py -m pytest -q
```

Expected: the existing backend suite remains green; no backend code changes are expected.

- [ ] **Step 3: Deploy locally**

```powershell
& .\scripts\deploy-local.ps1 -KubeContext docker-desktop
```

Expected: backend, frontend, renderer, and translation deployments roll out successfully.

- [ ] **Step 4: Verify the deployed editor behavior**

Open `http://openshorts.127.0.0.1.nip.io`, set subtitle and hook settings, start a new project, and confirm the new clip has no previous cue or hook text but reuses the settings. Reopen an existing saved project and confirm its project-specific settings remain unchanged.

- [ ] **Step 5: Verify repository state**

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors, no generated build artifacts staged, and unrelated user changes preserved.
