# Local editor timeline cue actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add split, delete-left, and delete-right actions for the selected subtitle cue in the local editor timeline.

**Architecture:** Keep `LocalEditorTimeline` presentational and put cue math in pure `timelineModel.js` helpers. `LocalEditorTab` will apply those helpers through `commitEdit`, update selection, and expose buttons plus keyboard shortcuts only when the playhead is strictly inside the selected subtitle cue.

**Tech Stack:** React, Vitest, Testing Library, lucide-react, Tailwind utility classes.

---

### Task 1: Add pure cue transformation tests

**Files:**
- Modify: `dashboard/src/editor/timelineModel.test.js`
- Modify: `dashboard/src/editor/timelineModel.js`

- [ ] **Step 1: Inspect the existing model test setup**

Run:

```powershell
Get-Content dashboard/src/editor/timelineModel.test.js
```

Use the existing Vitest conventions and imports.

- [ ] **Step 2: Write the failing tests**

Add tests that define the desired pure behavior:

```js
it("splits a cue at an interior playhead while preserving metadata", () => {
  const cue = {
    id: "cue-1",
    type: "subtitle",
    text: "Hello",
    label: "Hello",
    startMs: 1000,
    endMs: 5000,
    start: 1,
    end: 5,
    captions: [{ text: "Hello", startMs: 1000, endMs: 5000 }],
  };

  const result = splitCue(cue, 3000, ["cue-1"]);

  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    id: "cue-1",
    text: "Hello",
    startMs: 1000,
    endMs: 3000,
    start: 1,
    end: 3,
  });
  expect(result[1]).toMatchObject({
    id: "cue-1-split-1",
    text: "Hello",
    startMs: 3000,
    endMs: 5000,
    start: 3,
    end: 5,
  });
  expect(result[0].captions[0]).toMatchObject({
    startMs: 1000,
    endMs: 3000,
  });
  expect(result[1].captions[0]).toMatchObject({
    startMs: 3000,
    endMs: 5000,
  });
});

it("trims a cue on either side of an interior playhead", () => {
  const cue = { id: "cue-1", startMs: 1000, endMs: 5000, start: 1, end: 5 };

  expect(trimCueLeft(cue, 3000)).toMatchObject({
    startMs: 3000,
    endMs: 5000,
    start: 3,
    end: 5,
  });
  expect(trimCueRight(cue, 3000)).toMatchObject({
    startMs: 1000,
    endMs: 3000,
    start: 1,
    end: 3,
  });
});

it("rejects cue transforms outside the cue bounds", () => {
  const cue = { id: "cue-1", startMs: 1000, endMs: 5000 };

  expect(splitCue(cue, 1000, ["cue-1"])).toBeNull();
  expect(splitCue(cue, 5000, ["cue-1"])).toBeNull();
  expect(trimCueLeft(cue, 1000)).toBeNull();
  expect(trimCueRight(cue, 5000)).toBeNull();
});
```

- [ ] **Step 3: Run the model tests and verify the expected failure**

Run:

```powershell
cd dashboard
npx vitest run src/editor/timelineModel.test.js
```

Expected: FAIL because `splitCue`, `trimCueLeft`, and `trimCueRight` are not exported yet.

- [ ] **Step 4: Implement the minimal pure helpers**

In `dashboard/src/editor/timelineModel.js`, add and export:

```js
const cueWithBounds = (cue, startMs, endMs) => ({
  ...cue,
  startMs,
  endMs,
  start: startMs / 1000,
  end: endMs / 1000,
  captions: Array.isArray(cue.captions)
    ? cue.captions.map((caption) => ({ ...caption, startMs, endMs }))
    : cue.captions,
});

export function splitCue(cue, playheadMs, existingIds = []) {
  const startMs = Number(cue?.startMs);
  const endMs = Number(cue?.endMs);
  const splitMs = Math.round(Number(playheadMs));
  if (!(startMs < splitMs && splitMs < endMs)) return null;
  const usedIds = new Set(existingIds || []);
  let suffix = 1;
  while (usedIds.has(`${cue.id}-split-${suffix}`)) suffix += 1;
  return [
    cueWithBounds(cue, startMs, splitMs),
    cueWithBounds(cue, splitMs, endMs),
  ].map((nextCue, index) =>
    index === 0 ? nextCue : { ...nextCue, id: `${cue.id}-split-${suffix}` },
  );
}

export const trimCueLeft = (cue, playheadMs) => {
  const split = splitCue(cue, playheadMs, [cue?.id]);
  return split ? split[1] : null;
};

export const trimCueRight = (cue, playheadMs) => {
  const split = splitCue(cue, playheadMs, [cue?.id]);
  return split ? split[0] : null;
};
```

The implementation must preserve cue metadata while keeping both numeric millisecond and second fields synchronized.

- [ ] **Step 5: Run the model tests and verify they pass**

Run:

```powershell
npx vitest run src/editor/timelineModel.test.js
```

Expected: all tests in that file pass.

### Task 2: Add editor action behavior tests

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Add failing toolbar and keyboard tests**

Using the existing local-editor render helper and fixture style, add tests for:

```jsx
it("offers cue actions only for an interior selected subtitle cue", async () => {
  renderLocalEditor({
    subtitleCues: [
      { id: "cue-1", text: "Caption", startMs: 1000, endMs: 5000 },
    ],
    playheadMs: 3000,
  });

  await user.click(screen.getByRole("button", { name: "Caption" }));

  expect(screen.getByRole("button", { name: "Split cue" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Delete left of playhead" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Delete right of playhead" })).toBeEnabled();
});

it("splits the selected cue, selects the right result, and can undo it", async () => {
  render(
    <LocalEditorTab
      initialVideoUrl="/videos/project.mp4"
      initialPlaybackDurationMs={10000}
      initialEditorState={{
        subtitleCues: [
          { id: "cue-1", text: "Caption", startMs: 1000, endMs: 5000 },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Caption" }));
  await user.click(screen.getByRole("button", { name: "Split cue" }));
  expect(screen.getAllByRole("button", { name: "Caption" })).toHaveLength(2);
  expect(
    screen.getAllByRole("button", { name: "Caption" }).at(-1),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Timeline undo" }));
  expect(screen.getAllByRole("button", { name: "Caption" })).toHaveLength(1);
});

it("trims the selected cue from either side and supports Q/W shortcuts", async () => {
  render(
    <LocalEditorTab
      initialVideoUrl="/videos/project.mp4"
      initialPlaybackDurationMs={10000}
      initialEditorState={{
        subtitleCues: [
          { id: "cue-1", text: "Caption", startMs: 1000, endMs: 5000 },
        ],
      }}
    />,
  );
  const workspace = screen.getByTestId("local-editor-subtitle-workspace");
  fireEvent.click(screen.getByRole("button", { name: "Caption" }));
  fireEvent.keyDown(workspace, { key: "q" });
  expect(screen.getByRole("button", { name: "Caption" })).toHaveStyle({
    left: "30%",
  });
  fireEvent.click(screen.getByRole("button", { name: "Timeline undo" }));
  fireEvent.keyDown(workspace, { key: "w" });
  expect(screen.getByRole("button", { name: "Caption" })).toHaveStyle({
    width: "20%",
  });
});
```

Use `userEvent` as already configured in this test file. Assert observable cue boundaries through the existing timeline/table output rather than testing React state directly.

- [ ] **Step 2: Run the focused tests and verify they fail for missing controls**

Run:

```powershell
npx vitest run src/components/local-editor/LocalEditorTab.test.jsx -t "cue actions"
```

Expected: FAIL because the three action buttons do not exist.

- [ ] **Step 3: Add parent-level cue action handlers**

Import `splitCue`, `trimCueLeft`, and `trimCueRight` from `../../editor/timelineModel`.

Add a derived boolean after `selectedCue`:

```js
const selectedSubtitleCueIsEditable = Boolean(
  selected?.type === "subtitle" &&
    selectedCue &&
    playheadMs > selectedCue.startMs &&
    playheadMs < selectedCue.endMs,
);
```

Add handlers that use `commitEdit` and update selection:

```js
const applyCueAction = (action) => {
  if (!selectedSubtitleCueIsEditable) return;
  const cueId = selected.id;
  const currentCue = subtitleCues.find((cue) => cue.id === cueId);
  if (!currentCue) return;
  if (action === "split") {
    const replacement = splitCue(
      currentCue,
      playheadMs,
      subtitleCues.map((cue) => cue.id),
    );
    if (!replacement) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: current.subtitleCues.flatMap((cue) =>
        cue.id === cueId ? replacement : [cue],
      ),
    }));
    setSelected({ id: replacement[1].id, type: "subtitle" });
    return;
  }
  const nextCue =
    action === "delete-left"
      ? trimCueLeft(currentCue, playheadMs)
      : trimCueRight(currentCue, playheadMs);
  if (!nextCue) return;
  commitEdit((current) => ({
    ...current,
    subtitleCues: current.subtitleCues.map((cue) =>
      cue.id === cueId ? nextCue : cue,
    ),
  }));
};
```

Keep the action handler separate from `removeSelectedTimelineItem`, because these actions trim/split without deleting the entire cue.

- [ ] **Step 4: Add keyboard handling for the three shortcuts**

Extend `handleTimelineKeyDown` after the existing input guard and before marker handling:

```js
const key = event.key.toLowerCase();
if ((event.ctrlKey || event.metaKey) && key === "b") {
  event.preventDefault();
  applyCueAction("split");
  return;
}
if (!event.ctrlKey && !event.metaKey && key === "q") {
  event.preventDefault();
  applyCueAction("delete-left");
  return;
}
if (!event.ctrlKey && !event.metaKey && key === "w") {
  event.preventDefault();
  applyCueAction("delete-right");
  return;
}
```

Do not intercept these keys while typing in an input, textarea, or select.

- [ ] **Step 5: Add compact buttons to the existing timeline action bar**

Place the buttons beside the existing delete action in `LocalEditorTab.jsx`:

```jsx
<span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />
<button
  type="button"
  aria-label="Split cue"
  title="Split cue (Ctrl/Cmd+B)"
  onClick={() => applyCueAction("split")}
  disabled={busy || !selectedSubtitleCueIsEditable}
  className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
>
  <Split size={14} />
</button>
<button
  type="button"
  aria-label="Delete left of playhead"
  title="Delete left of playhead (Q)"
  onClick={() => applyCueAction("delete-left")}
  disabled={busy || !selectedSubtitleCueIsEditable}
  className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
>
  <DeleteLeftIcon />
</button>
<button
  type="button"
  aria-label="Delete right of playhead"
  title="Delete right of playhead (W)"
  onClick={() => applyCueAction("delete-right")}
  disabled={busy || !selectedSubtitleCueIsEditable}
  className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
>
  <DeleteRightIcon />
</button>
```

Use lucide icons if an exact equivalent exists; otherwise add small inline SVG components in the same file with `aria-hidden="true"`. Keep the controls visually consistent with the existing compact toolbar.

- [ ] **Step 6: Run the focused editor tests and verify they pass**

Run:

```powershell
npx vitest run src/components/local-editor/LocalEditorTab.test.jsx -t "cue actions"
```

Expected: all cue-action tests pass.

### Task 3: Regression verification and commit

**Files:**
- Verify: `dashboard/src/editor/timelineModel.js`
- Verify: `dashboard/src/editor/timelineModel.test.js`
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Run the complete focused local-editor test set**

Run:

```powershell
npx vitest run src/editor/timelineModel.test.js src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/LocalEditorTimeline.test.jsx
```

Expected: all selected test files pass.

- [ ] **Step 2: Run required dashboard formatting and lint checks**

Run:

```powershell
npm run format
npm run format:check
npm run lint
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: build completes successfully. Existing bundle-size warnings are acceptable if no new errors appear.

- [ ] **Step 4: Run GitNexus change detection**

Run the GitNexus `detect_changes()` check and confirm only the timeline cue action symbols and their tests are affected.

- [ ] **Step 5: Commit the implementation**

```powershell
git add dashboard/src/editor/timelineModel.js dashboard/src/editor/timelineModel.test.js dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "Add local editor timeline cue actions"
```
