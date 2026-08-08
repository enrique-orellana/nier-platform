# Editor Actions Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the editor workflow buttons from the fixed full-width strip into a compact Actions card at the top of the right inspector.

**Architecture:** Keep `EditorActionToolbar` as the owner of the seven workflow controls and their existing callbacks/state. Convert it to a normal-flow inspector card, then render it through `FullScreenEditor` inside the right-side panel for both the project editor and local editor paths. The header retains only session/output controls.

**Tech Stack:** React 18, Tailwind CSS, Vitest, Testing Library, Vite.

---

### Task 1: Add failing placement regression tests

**Files:**
- Modify: `dashboard/src/components/editor/EditorActionToolbar.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Add the toolbar card assertions**

Extend the existing `EditorActionToolbar` test with this behavior assertion:

```jsx
it('renders as a compact Actions inspector card', () => {
    render(<EditorActionToolbar onAutoEdit={vi.fn()} onConvertNativeShort={vi.fn()} onSubtitles={vi.fn()} onViralHook={vi.fn()} onDubVoice={vi.fn()} onPost={vi.fn()} onDownload={vi.fn()} />);

    const region = screen.getByRole('region', { name: 'Editor actions' });
    expect(screen.getByRole('heading', { name: 'Actions' })).toBeInTheDocument();
    expect(region).toHaveClass('rounded-xl', 'border', 'p-3');
    expect(region).not.toHaveClass('fixed', 'top-[4.5rem]', 'z-[70]');
});
```

- [ ] **Step 2: Add the full-screen wiring assertion**

Update the existing `renders the complete action toolbar when opened from a result card` test in `FullScreenEditor.test.jsx` so it also proves the toolbar is inside the inspector:

```jsx
const actionsRegion = screen.getByRole('region', { name: 'Editor actions' });
expect(actionsRegion.closest('aside')).toHaveAttribute('aria-label', 'Inspector');
```

Add the same `closest('aside')` assertion to the local-editor workspace test. The local editor’s inspector aside does not currently have an accessible label, so give that aside `aria-label="Inspector"` in the implementation before this assertion is run.

- [ ] **Step 3: Run the focused tests and verify the expected RED state**

Run from `D:\workspace\openshorts\dashboard`:

```powershell
npm test -- --run src/components/editor/EditorActionToolbar.test.jsx src/components/editor/FullScreenEditor.test.jsx
```

Expected: the existing interaction tests pass, while the new tests fail because the toolbar still uses fixed positioning, has no `Actions` heading, and remains in the header rather than an inspector aside.

### Task 2: Move the toolbar into the inspector card

**Files:**
- Modify: `dashboard/src/components/editor/EditorActionToolbar.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Convert `EditorActionToolbar` to a normal-flow card**

Replace the fixed outer wrapper and seven-column responsive layout with this structure, keeping the existing error block and button JSX unchanged:

```jsx
return (
    <div className="rounded-xl border border-white/10 bg-white/[.02] p-3" aria-label="Editor actions" role="region">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Actions</h3>
        {editError && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-red-400" role="alert">
                <AlertCircle size={13} className="shrink-0" />
                <span className="truncate">{editError}</span>
            </div>
        )}
        <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
            {/* Keep the existing seven buttons and their props/classes here. */}
        </div>
    </div>
);
```

The outer card must no longer include `fixed`, `top-[4.5rem]`, `z-[70]`, `bg-surfaceLight/95`, `shadow-lg`, or `backdrop-blur`, so it cannot cover the editor workspace.

- [ ] **Step 2: Wire the project editor toolbar into the right inspector**

In the non-local `FullScreenEditor` branch:

1. Delete the top-level `{editorActions && <EditorActionToolbar {...editorActions} />}` immediately after the header.
2. Render `{editorActions && <EditorActionToolbar {...editorActions} />}` as the first child of the inspector aside, before the `Inspector` heading.

The resulting start of the aside is:

```jsx
<aside className="glass-panel row-span-2 flex flex-col overflow-auto p-5 shadow-lg" aria-label="Inspector">
    {editorActions && <EditorActionToolbar {...editorActions} />}
    <h2 className="mb-5 mt-5 text-xs font-bold uppercase tracking-widest text-primary drop-shadow-sm">
        Inspector
    </h2>
```

Use the existing `mt-5` spacing only when needed to separate the card from the heading; do not change inspector behavior or action callbacks.

- [ ] **Step 3: Wire the local editor toolbar into its inspector aside**

In the `useLocalEditor` branch of `FullScreenEditor`:

1. Remove the `headerActions={editorActions ? <EditorActionToolbar {...editorActions} /> : null}` prop so workflow buttons no longer render beside Undo/Redo/Export.
2. Wrap the supplied side panel in a fragment/container whose first child is the toolbar.
3. Add `aria-label="Inspector"` to the local editor aside in `LocalEditorTab.jsx`, because that aside is the right inspector that receives `sidePanel`.

Use this exact wiring shape:

```jsx
headerActions={null}
sidePanel={(
    <>
        {editorActions && <EditorActionToolbar {...editorActions} />}
        <section className="rounded-xl border border-white/10 bg-white/[.02] p-4" aria-label="Version history">
            {/* Existing VersionHistory section remains unchanged. */}
        </section>
    </>
)}
```

In `LocalEditorTab.jsx`, change only the inspector opening tag from:

```jsx
<aside className="space-y-4">
```

to:

```jsx
<aside className="space-y-4" aria-label="Inspector">
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- --run src/components/editor/EditorActionToolbar.test.jsx src/components/editor/FullScreenEditor.test.jsx
```

Expected: all focused toolbar and full-screen editor tests pass, including both inspector placement assertions.

### Task 3: Full verification and commit

**Files:**
- Review: `dashboard/src/components/editor/EditorActionToolbar.jsx`
- Review: `dashboard/src/components/editor/EditorActionToolbar.test.jsx`
- Review: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Review: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Review: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Run the complete dashboard test suite**

```powershell
cd D:\workspace\openshorts\dashboard
npm test
```

Expected: exit code 0 with all existing and new tests passing.

- [ ] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: exit code 0 and a successful Vite production build. Existing chunk-size warnings are acceptable if no build error occurs.

- [ ] **Step 3: Review the final diff and working tree**

```powershell
cd D:\workspace\openshorts
git diff --check
git diff -- dashboard/src/components/editor/EditorActionToolbar.jsx dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/editor/EditorActionToolbar.test.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx
git status --short
```

Expected: only the planned toolbar, editor wiring, inspector label, and tests are changed; no generated build output is staged.

- [ ] **Step 4: Commit the implementation**

```powershell
git add -- dashboard/src/components/editor/EditorActionToolbar.jsx dashboard/src/components/editor/EditorActionToolbar.test.jsx dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx
git commit -m "fix: move editor actions into inspector"
```

Expected: a new commit is created with a clean working tree afterward.
