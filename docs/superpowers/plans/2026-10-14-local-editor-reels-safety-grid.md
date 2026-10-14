# Local Editor Reels Safety Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible toolbar toggle that overlays the supplied Instagram safety grid on 9:16 local-editor previews without affecting exports.

**Architecture:** Keep toggle state and presentation in `LocalEditorTab`, which already owns the local editor player stage and controls. Render the existing PNG as a pointer-transparent sibling over the preview frame, outside `RemotionPreview`, and show the control only when resolved output dimensions are 9:16. Keep the toggle off on each editor mount and out of project persistence.

**Tech Stack:** React, Tailwind CSS, Vitest, Testing Library, Vite.

---

## File map

- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` for local toggle state, output-ratio gating, preview overlay, and toolbar button.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.test.jsx` for behavior, accessibility, ratio, and render-boundary coverage.
- Include the already-supplied `dashboard/public/ig-safety-grid.png` unchanged in the feature commit so the public asset URL is available in clean checkouts.
- Do not modify `RemotionPreview`, export/render code, aspect-ratio persistence, or other editor consumers.

### Task 1: Add focused safety-grid tests

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [x] **Step 1: Add failing tests for toggle behavior and ratio gating**

Add these tests inside the existing `describe("LocalEditorTab", ...)` block, after the player presentation test. The file already imports `fireEvent`, `render`, `screen`, and `expect`.

```jsx
  it("toggles the Reels safety grid as a preview-only overlay", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
        remotionPreviewProps={{
          videoUrl: "/videos/project.mp4",
          durationInSeconds: 10,
          fps: 30,
          width: 1080,
          height: 1920,
        }}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Grid" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("img", { name: "Instagram Reels safe zones" }),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const overlay = screen.getByRole("img", {
      name: "Instagram Reels safe zones",
    });
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(overlay).toHaveAttribute("src", "/ig-safety-grid.png");
    expect(overlay).toHaveClass("pointer-events-none");
    expect(screen.getByTestId("local-editor-player-stage")).toContainElement(
      overlay,
    );
    expect(
      screen.getByTestId("local-editor-remotion-preview"),
    ).not.toContainElement(overlay);
  });

  it("offers the safety grid only for resolved 9:16 output frames", () => {
    const editorProps = {
      initialVideoUrl: "/videos/project.mp4",
      initialPlaybackDurationMs: 10000,
      remotionPreviewProps: {
        videoUrl: "/videos/project.mp4",
        durationInSeconds: 10,
        fps: 30,
        width: 1080,
        height: 1920,
      },
    };
    const { unmount } = render(
      <LocalEditorTab
        {...editorProps}
        initialEditorState={{ aspectRatio: "16:9" }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Grid" })).not.toBeInTheDocument();
    unmount();

    render(
      <LocalEditorTab
        {...editorProps}
        initialEditorState={{ aspectRatio: "original" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument();
  });
```

- [x] **Step 2: Run the focused test and confirm it fails for the missing feature**

Run from `dashboard`:

```powershell
npm test -- src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests fail because the `Grid` button and safety-grid overlay do not exist yet; existing unrelated tests should not be the cause.

### Task 2: Implement the preview-only toggle

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [x] **Step 1: Add local state and derive whether the output frame is Reels-shaped**

Add the state next to the existing player state:

```jsx
  const [safetyGridVisible, setSafetyGridVisible] = useState(false);
```

After `outputDimensions` is computed, add:

```jsx
  const isReelsAspectRatio =
    formatAspectRatio(outputDimensions.width, outputDimensions.height) ===
    "9:16";
```

`formatAspectRatio` is already imported and uses the resolved output dimensions, so `Original` is eligible only when its actual dimensions reduce to 9:16.

- [x] **Step 2: Layer the supplied image over the preview frame, outside Remotion**

After the existing native-video/`RemotionPreview` conditional and before the closing tag of the relative output-frame wrapper, add:

```jsx
                  {isReelsAspectRatio && safetyGridVisible && (
                    <img
                      src="/ig-safety-grid.png"
                      alt="Instagram Reels safe zones"
                      draggable={false}
                      className="pointer-events-none absolute inset-0 z-20 h-full w-full object-fill"
                    />
                  )}
```

Keep this element as a sibling of the preview branch inside the output-frame wrapper. Do not pass the guide to `RemotionPreview` or any export/render data.

- [x] **Step 3: Add the labeled toggle beside the existing fit/fullscreen controls**

Immediately after the existing `Full` fit button and before the aspect-ratio selector, add:

```jsx
                  {isReelsAspectRatio && (
                    <button
                      type="button"
                      aria-pressed={safetyGridVisible}
                      title={
                        safetyGridVisible
                          ? "Hide Instagram Reels safe zones"
                          : "Show Instagram Reels safe zones"
                      }
                      onClick={() =>
                        setSafetyGridVisible((visible) => !visible)
                      }
                      className={`flex h-7 min-h-7 shrink-0 items-center rounded-md border px-2 text-[10px] font-medium transition-colors ${
                        safetyGridVisible
                          ? "border-violet-300/30 bg-violet-400/10 text-violet-100"
                          : "border-white/10 bg-white/[.02] text-zinc-400 hover:border-white/20 hover:text-zinc-100"
                      }`}
                    >
                      Grid
                    </button>
                  )}
```

The visible `Grid` text provides the accessible name, `aria-pressed` exposes the toggle state, and local `useState(false)` ensures each new editor mount starts with the guide off.

- [x] **Step 4: Re-run the focused tests**

Run from `dashboard`:

```powershell
npm test -- src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests and the full `LocalEditorTab` test file pass.

### Task 3: Validate, commit, and apply to the local editor

**Files:**
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Include unchanged asset: `dashboard/public/ig-safety-grid.png`

- [x] **Step 1: Run required dashboard formatting, lint, and build checks**

Run these commands from `dashboard` in order:

```powershell
npm run format
npm run format:check
npm run lint
npm run build
```

Expected: each command exits successfully. Review the diff afterward in case formatting touched any unrelated files.

- [x] **Step 2: Review the final change set and GitNexus impact**

From the repository root, run:

```powershell
git status --short
git diff --check
git diff -- dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
```

Confirm the supplied PNG is unchanged. The GitNexus refresh may update only the generated symbol/relationship counts in the GitNexus sections of `AGENTS.md` and `CLAUDE.md`; verify those are the only changes in those files. Run GitNexus `detect_changes()` with `scope: "all"`; confirm `LocalEditorTab` is the only changed application symbol and its local-editor flows are the only affected application behavior.

- [ ] **Step 3: Commit only the feature files**

Stage the component, its tests, the supplied asset, the feature plan, and the generated GitNexus count refresh; the design spec is already committed separately.

```powershell
git add -- AGENTS.md CLAUDE.md dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx dashboard/public/ig-safety-grid.png docs/superpowers/plans/2026-10-14-local-editor-reels-safety-grid.md
git diff --cached --check
git status --short
git commit -m "feat(editor): add reels safety grid toggle"
```

Expected: the commit contains only the listed feature files and leaves unrelated user changes untouched.

- [ ] **Step 4: Rebuild and restart the frontend container**

Run from the repository root:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component frontend
.\scripts\manage-local.ps1 -Action Status
```

Expected: the frontend rebuild/restart completes and the local services report healthy/running status.

- [ ] **Step 5: Smoke-check the live editor in Brave**

Use Brave, following the repository browser-testing rule. In the local editor, verify the `Grid` button is off initially for 9:16, toggles the guide over the preview, and leaves playback controls usable. Enter fullscreen and confirm the guide stays aligned; exit fullscreen. Switch to 16:9 and verify the button/guide are absent; switch to `Original` with a 9:16 source and verify the button is available. Confirm the rendered export is unaffected by the preview-only guide.
