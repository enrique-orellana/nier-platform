# Editor Clip Metadata Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show generated clip title, duration, boxed hashtags, YouTube title, and caption in a compact left-side panel when a project clip is opened in the editor.

**Architecture:** Add a presentational `ClipMetadataPanel` component that receives the existing clip object and renders only when generated metadata is available. Pass the clip from `FullScreenEditor` into `LocalEditorTab`, then render the panel above the video preview in the main editor column; the existing result-card and backend contracts remain unchanged.

**Tech Stack:** React 18, Vite, Tailwind CSS, lucide-react, Vitest, Testing Library.

---

### Task 1: Add the failing metadata-panel component test

**Files:**
- Create: `dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Create a representative generated clip and assert that the component renders the title, calculated duration, the two hashtags inside a labeled bordered region, YouTube title, and caption. Also assert that rendering with an empty clip produces no panel.

```jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ClipMetadataPanel from './ClipMetadataPanel';

const clip = {
  start: 12,
  end: 51,
  video_title_for_youtube_short: 'La foto que según él parece Juan Guarnizo',
  video_description_for_tiktok: 'Una chica de Internet tiene una foto de cuerpo entero y le pide ayuda.',
};

describe('ClipMetadataPanel', () => {
  it('renders generated publishing metadata with boxed hashtags', () => {
    render(<ClipMetadataPanel clip={clip} />);

    expect(screen.getByRole('heading', { name: clip.video_title_for_youtube_short })).toBeInTheDocument();
    expect(screen.getByText('39s')).toBeInTheDocument();
    const hashtags = screen.getByRole('group', { name: 'Hashtags' });
    expect(hashtags).toHaveTextContent('#shorts');
    expect(hashtags).toHaveTextContent('#viral');
    expect(screen.getByText('YouTube Title')).toBeInTheDocument();
    expect(screen.getByText(clip.video_title_for_youtube_short, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(clip.video_description_for_tiktok)).toBeInTheDocument();
  });

  it('omits itself when no generated metadata is available', () => {
    const { container } = render(<ClipMetadataPanel clip={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard; npm test -- --run src/components/local-editor/ClipMetadataPanel.test.jsx`

Expected: FAIL because `ClipMetadataPanel` does not exist yet.

### Task 2: Implement the compact left-side metadata component

**Files:**
- Create: `dashboard/src/components/local-editor/ClipMetadataPanel.jsx`

- [ ] **Step 1: Implement the minimal component**

Add a presentational component that:

- returns `null` when there is no title, caption, or usable duration;
- calculates duration from `end - start`, falling back to `duration`;
- formats durations under one minute as rounded seconds and longer clips as `Xm YYs`;
- renders `#shorts` and `#viral` together in a subtle `role="group" aria-label="Hashtags"` box;
- uses responsive Tailwind classes so the panel naturally stacks when its parent becomes narrow.

Use `Youtube`, `Video`, and `Instagram` from `lucide-react` for the two metadata labels, matching the existing result-card visual language.

- [ ] **Step 2: Run the focused test to verify it passes**

Run: `cd dashboard; npm test -- --run src/components/local-editor/ClipMetadataPanel.test.jsx`

Expected: PASS with both tests green.

### Task 3: Pass clip metadata into the project editor and render it on the left

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Add a regression assertion for the editor integration**

Extend the existing project-clip editor test setup so `LocalEditorTab` accepts a `clipMetadata` prop and renders the metadata panel before the player. Assert the representative title and `39s` duration appear while the existing upload-state behavior remains unchanged.

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `cd dashboard; npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`

Expected: FAIL because `LocalEditorTab` does not yet accept or render clip metadata.

- [ ] **Step 3: Thread the clip through `FullScreenEditor`**

When rendering `LocalEditorTab`, pass `clipMetadata={clip}`. Do not alter the editor’s saved manifest, render props, or version APIs.

- [ ] **Step 4: Render the panel in the main/left workspace**

Add `ClipMetadataPanel` to the `main` column before the player container. Keep it hidden for standalone local uploads by relying on the component’s empty-data `null` behavior. Use a responsive wrapper that places the metadata card beside the preview on wide layouts and above it on narrow layouts, while keeping the timeline below the preview.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cd dashboard; npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`

Expected: PASS with the existing local-editor tests and the new integration assertion green.

### Task 4: Verify the complete dashboard change

**Files:**
- No new files.

- [ ] **Step 1: Run the focused component tests**

Run: `cd dashboard; npm test -- --run src/components/local-editor/ClipMetadataPanel.test.jsx src/components/local-editor/LocalEditorTab.test.jsx`

Expected: PASS.

- [ ] **Step 2: Run the dashboard lint and build**

Run: `cd dashboard; npm run lint; npm run build`

Expected: both commands complete successfully without new lint errors or build errors.

- [ ] **Step 3: Review the final diff**

Run: `git diff -- dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/ClipMetadataPanel.jsx dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

Confirm the change is limited to informational metadata display, the hashtag box is subtle, and unrelated existing worktree changes are untouched.

- [ ] **Step 4: Commit the implementation**

```bash
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/ClipMetadataPanel.jsx dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: show clip metadata in editor"
```
