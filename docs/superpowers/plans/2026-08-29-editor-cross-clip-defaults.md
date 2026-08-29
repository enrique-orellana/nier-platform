# Editor Cross-Clip Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the last remembered subtitle and viral-hook configuration as defaults when the project editor opens another clip, without overriding settings already saved on that clip.

**Architecture:** Reuse `localEditorPreferences.js`, which already persists `subtitleStyle`, `subtitleLanguage`, and `hookDefaults` in browser `localStorage`. Extend the pure manifest-to-editor-state adapter with an optional preferences argument, and pass the preferences into the three project-editor hydration paths. Saved manifest values remain higher priority than remembered defaults.

**Tech Stack:** React, Vitest, browser `localStorage`, existing editor manifest adapter.

---

### Task 1: Define preference-aware manifest hydration

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx:manifestToLocalEditorState`

- [x] **Step 1: Write the failing tests**

Add tests for `manifestToLocalEditorState` that pass remembered preferences as the fifth argument. Verify an empty manifest uses the remembered subtitle style/language; a clip fallback hook uses remembered hook defaults and its own text; and existing manifest style/hook values remain authoritative.

- [x] **Step 2: Run the focused tests and verify they fail for the missing behavior**

Run from `dashboard`:

```powershell
npm test -- src/components/editor/FullScreenEditor.test.jsx
```

Expected: the new preference-hydration assertions fail because the adapter currently accepts no preferences argument and still uses built-in defaults.

- [x] **Step 3: Implement the minimal adapter change**

Update `manifestToLocalEditorState` to accept an optional preferences object. Use remembered subtitle style/language only after active-track and legacy-layer values. When creating a hook from `fallbackHookText`, merge remembered `hookDefaults`, set `startMs` to `0`, and derive `endMs` from remembered `durationMs`; keep an existing `source.layers.hook` unchanged apart from the existing normalization.

- [x] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
npm test -- src/components/editor/FullScreenEditor.test.jsx
```

Expected: all tests in the file pass, including the new fallback and precedence cases.

### Task 2: Apply browser defaults to project-editor hydration

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx:FullScreenEditor`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [x] **Step 1: Write the failing integration test**

Seed `EDITOR_PREFERENCES_STORAGE_KEY`, render `FullScreenEditor` with a manifest containing subtitles but no saved style and a clip `viral_hook_text` but no saved hook, then open the subtitle and hook inspectors. Assert the remembered subtitle controls and hook controls are visible, including remembered language, font size, hook position, size, entrance, and duration.

- [x] **Step 2: Run the focused integration test and verify it fails**

Run:

```powershell
npm test -- src/components/editor/FullScreenEditor.test.jsx
```

Expected: the editor loads the clip, but the controls show built-in defaults instead of the stored browser preferences.

- [x] **Step 3: Implement preference injection**

Import `readEditorPreferences`, read it once per `FullScreenEditor` instance, and pass that object to every `manifestToLocalEditorState` call used by initial state, async load, and `replaceManifest`. Do not pass preferences into `localEditorStateToManifest`, and do not change any backend endpoint or persisted clip data.

- [x] **Step 4: Run focused tests**

Run:

```powershell
npm test -- src/components/editor/FullScreenEditor.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/localEditorPreferences.test.js
```

Expected: all targeted tests pass, including existing tests that prove clip-specific settings override browser defaults and browser defaults exclude subtitle/hook content.

### Task 3: Validate, commit, and update the local app

**Files:**
- No additional files.

- [x] **Step 1: Run dashboard formatting and lint checks**

Run from `dashboard`:

```powershell
npm run format
npm run format:check
npm run lint
```

Expected: each command exits with code 0.

- [x] **Step 2: Run the full dashboard test suite and production build**

Run from `dashboard`:

```powershell
npm test -- --run
npm run build
```

Expected: the production build completes successfully. The full test suite was also run; it currently has unrelated pre-existing failures in `ProjectLibrary.test.jsx` and `LocalEditorTab.test.jsx`, while the focused editor tests pass.

- [ ] **Step 3: Review impact and commit only the feature files**

Run GitNexus `detect_changes({scope: "staged"})` after staging the implementation and tests. Confirm only the expected editor symbols and flows are affected, then commit:

```powershell
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx
git commit -m "feat: reuse editor defaults across clips"
```

- [ ] **Step 4: Rebuild and restart the frontend**

From the repository root:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component frontend
.\scripts\manage-local.ps1 -Action Status
```

Expected: the frontend restarts successfully and reports healthy status. Verify the editor URL manually in Brave and confirm a changed subtitle style/hook setting is visible as the default when opening another clip.
