# Inspector UX refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the editor inspector hierarchy for adding subtitle cues, selecting timeline items, and translating an entire subtitle track without changing behavior.

**Architecture:** Keep `InspectorPanel` responsible for cue creation and selected-item state. Refine its layout and copy in place, and refine `SubtitleTranslationPanel` as the translation control surface. Preserve existing callbacks, custom events, disabled states, and track-selection behavior.

**Tech Stack:** React, Tailwind utility classes, lucide-react, Vitest, Testing Library.

---

### Task 1: Add failing UX assertions

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Test: `dashboard/src/components/SubtitleTranslationPanel.test.jsx`

- [ ] **Step 1: Add assertions for the compact cue helper and empty state**

Extend the existing editor test that renders without a selected item:

```jsx
expect(screen.getByText(/starts at the current playhead/i)).toBeInTheDocument();
expect(screen.getByText(/nothing selected/i)).toBeInTheDocument();
expect(screen.getByText(/select a clip or cue in the timeline/i)).toBeInTheDocument();
```

- [ ] **Step 2: Add assertions for translation hierarchy**

In the translation panel test, assert the source/target labels and helper copy:

```jsx
expect(screen.getByText(/source track/i)).toBeInTheDocument();
expect(screen.getByText(/translate all .* cues/i)).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Translate entire track' })).toBeInTheDocument();
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm test -- --run src/components/editor/FullScreenEditor.test.jsx src/components/SubtitleTranslationPanel.test.jsx
```

Expected: the existing behavior tests pass, and the new copy assertions fail because the current inspector still uses the old labels and layout.

### Task 2: Refine the inspector layout and copy

**Files:**
- Modify: `dashboard/src/components/editor/InspectorPanel.jsx`

- [ ] **Step 1: Replace the cue block with clearer hierarchy**

Keep dispatching `openshorts:add-subtitle-cue`, but render a compact block with an icon, title, and helper text:

```jsx
const addCueControl = (
  <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
      <Plus size={15} className="text-primary" />
      Add subtitle cue
    </div>
    <p className="mb-3 text-[11px] leading-4 text-zinc-400">
      Starts at the current playhead. Select the cue to edit its text and timing.
    </p>
    <button type="button" className="btn-primary w-full" onClick={addCue} disabled={!canAddSubtitleCue} aria-label="Add subtitle cue">
      Add cue
    </button>
  </div>
);
```

If no subtitle track exists, retain the disabled state and replace the helper text with the existing track-creation guidance.

- [ ] **Step 2: Replace the oversized empty state**

Use a compact panel with an explicit heading and next step:

```jsx
<div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 text-center">
  <p className="text-sm font-semibold text-zinc-300">Nothing selected</p>
  <p className="mt-1 text-xs leading-5 text-zinc-500">Select a clip or cue in the timeline to edit its properties.</p>
</div>
```

- [ ] **Step 3: Run the focused editor tests**

Run the command from Task 1. Expected: all focused tests pass.

### Task 3: Clarify whole-track translation controls

**Files:**
- Modify: `dashboard/src/components/SubtitleTranslationPanel.jsx`

- [ ] **Step 1: Add source-track context and cue-count helper copy**

Keep the current state and callbacks, but add a source context row and make the cue count explicit:

```jsx
<div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 text-xs">
  <span className="text-zinc-500">Source track</span>
  <span className="ml-2 font-semibold text-zinc-200">{sourceLanguage.toUpperCase()}</span>
</div>
<p className="text-[11px] leading-4 text-zinc-500">
  Translates all {sourceCueCount} cues in this track. Timings and audio stay unchanged.
</p>
```

- [ ] **Step 2: Group target selection and action**

Keep the existing target language `<select>` and `Translate entire track` button, but place them in one row on wide panels and stack them on narrow panels. Preserve the existing disabled condition exactly.

- [ ] **Step 3: Run focused translation tests**

Run:

```bash
npm test -- --run src/components/SubtitleTranslationPanel.test.jsx
```

Expected: all translation tests pass, including the existing whole-track callback assertion.

### Task 4: Verify and commit

**Files:**
- Modify: `dashboard/src/components/editor/InspectorPanel.jsx`
- Modify: `dashboard/src/components/SubtitleTranslationPanel.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/SubtitleTranslationPanel.test.jsx`

- [ ] **Step 1: Run the full dashboard verification**

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: all tests pass, lint exits 0, and Vite produces a production build.

- [ ] **Step 2: Commit the implementation**

```bash
git add dashboard/src/components/editor/InspectorPanel.jsx dashboard/src/components/SubtitleTranslationPanel.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/components/SubtitleTranslationPanel.test.jsx
git commit -m "improve: clarify subtitle inspector UX"
```
