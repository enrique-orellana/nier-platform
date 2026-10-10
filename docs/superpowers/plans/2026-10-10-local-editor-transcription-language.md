# Local Editor Transcription Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose the language spoken in a video before generating subtitles in the Local Editor.

**Architecture:** Add an Audio language selector to the Local Editor's subtitle Track controls. Store its value in the existing `ai_transcription_language_v1` preference and send it through the existing transcription header. Notify the mounted App when the preference changes so AI Settings stays synchronized; do not add project persistence or backend endpoints.

**Tech Stack:** React, localStorage, Vitest, Testing Library, Vite, GitNexus.

---

## File map

- `dashboard/src/components/local-editor/LocalEditorTab.jsx` — selector state, preference update, and Track-controls UI.
- `dashboard/src/components/local-editor/LocalEditorTab.test.jsx` — default/saved selection, change handling, disabled state, and both transcription request paths.
- `dashboard/src/components/local-editor/localEditorAi.js` — shared preference read/write helpers and change-event name; `getLocalAiHeaders()` reads the same helper.
- `dashboard/src/App.jsx` — listen for Local Editor preference changes and keep AI Settings' controlled value current.
- `dashboard/src/App.test.jsx` — verify the AI Settings language selector responds to the shared change event.

Do not change `localEditorPersistence.js`, `AISettingsPanel.jsx`, backend routes, or transcription workers: the preference is global, the Settings selector already exists, and both backend transcription routes already accept the language header.

## Task 1: Add the Local Editor audio-language selector

**Files:**

- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorAi.js`

- [x] **Step 1: Write failing Local Editor tests**

In the existing direct-upload subtitle-generation test, open Track settings and select Italian before clicking Generate subtitles:

```jsx
fireEvent.change(screen.getByLabelText("Audio language"), {
  target: { value: "it" },
});
expect(localStorage.getItem("ai_transcription_language_v1")).toBe("it");
```

Assert the direct-upload request contains:

```jsx
headers: expect.objectContaining({
  "X-AI-Transcription-Language": "it",
}),
```

In the existing streamed project-clip test, select Spanish before generating and assert the request has `headers["X-AI-Transcription-Language"] === "es"`. Add a separate initial-state assertion that an empty preference renders Audio language as `auto`, and that a saved `de` preference renders as `de`.

Add a test that holds the mocked transcription request pending, starts generation, and asserts `screen.getByLabelText("Audio language")` is disabled while transcription runs.

- [x] **Step 2: Run the tests and confirm the expected failure**

Run from `dashboard`:

```powershell
npm test -- src/components/local-editor/LocalEditorTab.test.jsx -t "Audio language|generates subtitles from the local video|generates subtitles for a streamed project clip"
```

Expected: FAIL because the Local Editor does not yet render an Audio language selector.

- [x] **Step 3: Add shared transcription-language preference helpers**

In `localEditorAi.js`, centralize the key and event name, provide a defaulting getter, and persist plus announce changes:

```js
export const TRANSCRIPTION_LANGUAGE_CHANGE_EVENT =
  "local-editor-transcription-language-change";
const TRANSCRIPTION_LANGUAGE_STORAGE_KEY = "ai_transcription_language_v1";

export const getLocalTranscriptionLanguage = () =>
  localStorage.getItem(TRANSCRIPTION_LANGUAGE_STORAGE_KEY) || "auto";

export const setLocalTranscriptionLanguage = (language) => {
  const nextLanguage = language || "auto";
  localStorage.setItem(TRANSCRIPTION_LANGUAGE_STORAGE_KEY, nextLanguage);
  window.dispatchEvent(
    new CustomEvent(TRANSCRIPTION_LANGUAGE_CHANGE_EVENT, {
      detail: nextLanguage,
    }),
  );
  return nextLanguage;
};
```

Change `getLocalAiHeaders()` to use `getLocalTranscriptionLanguage()` for `X-AI-Transcription-Language`. The existing `localEditorAi.test.js` test for forwarding the saved transcription language should continue to cover this header behavior; the Local Editor tests above cover preference reading and writing through the UI.

- [x] **Step 4: Render and wire the selector**

In `LocalEditorTab.jsx`, import the two helpers, initialize component state from the getter, and save each selection through the setter:

```jsx
const [transcriptionLanguage, setTranscriptionLanguage] = useState(
  getLocalTranscriptionLanguage,
);

const handleTranscriptionLanguageChange = (event) => {
  setTranscriptionLanguage(setLocalTranscriptionLanguage(event.target.value));
};
```

Add an accessible `Audio language` select in the Track actions panel immediately before the subtitle action buttons. Include `<option value="auto">Auto-detect</option>` followed by `Object.entries(SUBTITLE_LANGUAGES)`; bind `value` and `onChange` to the state and handler, use the existing dark select styling, and set `disabled={generatingSubtitles}`.

- [x] **Step 5: Verify event and busy-state coverage**

The failing test from Step 1 should prove the selector disables during generation. Task 2's App synchronization test should prove `setLocalTranscriptionLanguage("it")` persists the value and dispatches the shared event.

- [x] **Step 6: Run focused tests**

Run:

```powershell
npm test -- src/components/local-editor/localEditorAi.test.js src/components/local-editor/LocalEditorTab.test.jsx -t "transcription language|Audio language|generates subtitles from the local video|generates subtitles for a streamed project clip"
```

Expected: all selected tests PASS; direct-upload and project-clip requests carry the selected language.

## Task 2: Keep AI Settings synchronized

**Files:**

- Modify: `dashboard/src/App.jsx`
- Test: `dashboard/src/App.test.jsx`

- [x] **Step 1: Add a failing App synchronization test**

In the existing `/settings` test setup, render `App`, dispatch the same custom event used by the Local Editor, and assert that the controlled AI Settings selector updates:

```jsx
import { setLocalTranscriptionLanguage } from "./components/local-editor/localEditorAi";

act(() => {
  setLocalTranscriptionLanguage("it");
});
expect(screen.getByLabelText("Transcription source language")).toHaveValue(
  "it",
);
```

- [x] **Step 2: Run the test and confirm it fails**

Run from `dashboard`:

```powershell
npm test -- src/App.test.jsx -t "transcription language changes from the Local Editor"
```

Expected: FAIL because App does not yet listen for Local Editor preference changes.

- [x] **Step 3: Synchronize App state with the shared preference**

In `App.jsx`, initialize `transcriptionLanguage` with `getLocalTranscriptionLanguage()`. Add an effect that subscribes to the shared event and removes the listener on unmount:

```jsx
useEffect(() => {
  const handleTranscriptionLanguageChange = (event) => {
    setTranscriptionLanguage(event.detail || "auto");
  };
  window.addEventListener(
    TRANSCRIPTION_LANGUAGE_CHANGE_EVENT,
    handleTranscriptionLanguageChange,
  );
  return () =>
    window.removeEventListener(
      TRANSCRIPTION_LANGUAGE_CHANGE_EVENT,
      handleTranscriptionLanguageChange,
    );
}, []);
```

Update the existing Settings change handler to call `setLocalTranscriptionLanguage(nextLanguage)` and update App state with its returned normalized value. Keep the existing AI Settings props and UI unchanged.

- [x] **Step 4: Run the App synchronization test**

Run:

```powershell
npm test -- src/App.test.jsx -t "transcription language changes from the Local Editor"
```

Expected: PASS; the Settings selector changes to Italian after receiving the event.

## Task 3: Validate, commit, and apply to the local editor

**Files:** all implementation and test files listed above.

- [x] **Step 1: Review current changes and preserve existing work**

Run `git status --short` and inspect `git diff`. Preserve the already-uncommitted aspect-ratio test assertion cleanup in `LocalEditorTab.test.jsx`; do not discard it or stage unrelated files. Before editing each production symbol, run GitNexus upstream impact analysis for `LocalEditorTab`, `generateSubtitles`, `getLocalAiHeaders`, `App`, and `handleTranscriptionLanguageChange`; report any HIGH or CRITICAL result before proceeding. Before committing, run GitNexus `detect_changes()` and review affected execution flows.

- [x] **Step 2: Run the dashboard formatter, formatter check, and linter**

Run from `dashboard`:

```powershell
npm run format
npm run format:check
npm run lint
```

Expected: all commands exit 0.

- [x] **Step 3: Run the full dashboard tests and production build**

Run from `dashboard`:

```powershell
npm test -- --reporter=dot
npm run build
```

Expected: Vitest exits 0 and Vite reports a successful production build. Record any existing non-blocking bundle-size warning separately.

- [x] **Step 4: Review and commit only the requested feature changes**

Review `git diff --check`, `git status --short`, and the complete diff. Stage only the transcription-language implementation and tests; preserve the pre-existing aspect-ratio test edit as separate unstaged work. Run GitNexus `detect_changes()` on the staged diff, then commit:

For `LocalEditorTab.test.jsx`, use `git add -p dashboard/src/components/local-editor/LocalEditorTab.test.jsx`: answer `n` for the existing aspect-ratio selector hunk and `y` for the new transcription-language hunks. Stage the other feature files by exact path.

```powershell
git commit -m "feat: select local editor transcription language"
```

- [x] **Step 5: Restart and smoke-check the frontend**

From the repository root run:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component frontend
.\scripts\manage-local.ps1 -Action Status
```

In Brave, open the Local Editor, expand Subtitles → Track, and verify Audio language shows the saved value and offers Auto-detect plus the supported languages. Do not click Generate subtitles during the smoke check; the automated request tests verify the header without sending a user's video.

## Self-review

- Spec coverage: selector placement, existing language choices, Auto-detect default, shared Settings preference, busy-state disabling, transcription header on both request paths, separate translation workflow, frontend verification, and local smoke check are all represented above.
- Scope: no per-project persistence, translation automation, backend route, or transcription-worker changes are included.
- Worktree note: follow the user's established inline-work preference; do not create a worktree for execution.
