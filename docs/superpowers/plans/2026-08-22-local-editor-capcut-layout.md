# Local Editor CapCut-Style Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the local editor into a CapCut-inspired workbench with an interactive Details/Subtitles/Viral Hook/Project rail while preserving the existing player, subtitle workspace, editor state, and parent integrations.

**Architecture:** Keep `LocalEditorTab` as the stateful owner of editor behavior and add two small presentational shell components: `LocalEditorFeatureRail` and `LocalEditorFeaturePanel`. The rail changes only the rendered feature panel; the player, timeline, and modal layers stay mounted. Existing `sidePanel` content from `FullScreenEditor` remains passed through unchanged in the persistent right context area; selecting Project marks that context as the active project view without duplicating its controls.

**Tech Stack:** React 18, Tailwind CSS utility classes, lucide-react, Vitest, React Testing Library, Vite.

---

## File map

- Create `dashboard/src/components/local-editor/LocalEditorFeatureRail.jsx` — the four-button interactive feature rail and exported feature metadata.
- Create `dashboard/src/components/local-editor/LocalEditorFeatureRail.test.jsx` — isolated rail rendering, active-state, and callback tests.
- Create `dashboard/src/components/local-editor/LocalEditorFeaturePanel.jsx` — shared feature-panel frame with labelled scrollable region.
- Create `dashboard/src/components/local-editor/LocalEditorFeaturePanel.test.jsx` — isolated panel shell and accessibility tests.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` — add `activeFeature`, render the shell, move the existing feature sections into the selected panel, and keep player/timeline/modal ownership unchanged.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.test.jsx` — integration tests for rail switching and persistent player/timeline DOM.
- No changes to `FullScreenEditor.jsx`, `App.jsx`, persistence, rendering, subtitle models, hook models, or `LocalEditorTimeline.jsx`.

## Task 1: Add the failing rail tests

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorFeatureRail.test.jsx`
- Reference: `dashboard/src/components/local-editor/LocalEditorFeatureRail.jsx` (does not exist yet)

- [ ] **Step 1: Write the failing test.**

Create the test with the existing Vitest/Testing Library conventions:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorFeatureRail, {
  LOCAL_EDITOR_FEATURES,
} from "./LocalEditorFeatureRail";

describe("LocalEditorFeatureRail", () => {
  it("renders the four local-editor feature buttons and marks Details active", () => {
    render(
      <LocalEditorFeatureRail
        activeFeature="details"
        onSelect={vi.fn()}
      />,
    );

    expect(LOCAL_EDITOR_FEATURES.map(({ label }) => label)).toEqual([
      "Details",
      "Subtitles",
      "Viral Hook",
      "Project",
    ]);
    expect(screen.getByRole("navigation", { name: "Editor features" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Subtitles" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("reports the selected feature when a rail button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <LocalEditorFeatureRail activeFeature="details" onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Subtitles" }));

    expect(onSelect).toHaveBeenCalledWith("subtitles");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected red failure.**

Run from `dashboard`:

```bash
npm test -- src/components/local-editor/LocalEditorFeatureRail.test.jsx
```

Expected: Vitest fails because `./LocalEditorFeatureRail` is not defined yet. Do not add production code before observing this failure.

## Task 2: Implement the interactive feature rail

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorFeatureRail.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorFeatureRail.test.jsx`

- [ ] **Step 1: Add the minimal rail implementation.**

Use the existing lucide-react dependency and keep the component presentational:

```jsx
import {
  FileText,
  FolderOpen,
  Info,
  Sparkles,
} from "lucide-react";

export const LOCAL_EDITOR_FEATURES = [
  { id: "details", label: "Details", icon: Info },
  { id: "subtitles", label: "Subtitles", icon: FileText },
  { id: "viral-hook", label: "Viral Hook", icon: Sparkles },
  { id: "project", label: "Project", icon: FolderOpen },
];

export default function LocalEditorFeatureRail({
  activeFeature = "details",
  onSelect,
}) {
  return (
    <nav
      aria-label="Editor features"
      className="flex gap-1 border-b border-white/10 bg-[#17171b] p-1.5 lg:flex-col lg:border-b-0 lg:border-r lg:p-2"
    >
      {LOCAL_EDITOR_FEATURES.map(({ id, label, icon: Icon }) => {
        const active = activeFeature === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            title={label}
            onClick={() => onSelect?.(id)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors lg:flex-none lg:min-w-16 ${active ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-300/30" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Run the focused test and confirm green.**

```bash
npm test -- src/components/local-editor/LocalEditorFeatureRail.test.jsx
```

Expected: both rail tests pass with no console errors.

- [ ] **Step 3: Commit the isolated rail.**

```bash
git add dashboard/src/components/local-editor/LocalEditorFeatureRail.jsx dashboard/src/components/local-editor/LocalEditorFeatureRail.test.jsx
git commit -m "feat: add local editor feature rail"
```

## Task 3: Add the failing feature-panel shell tests

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorFeaturePanel.test.jsx`
- Reference: `dashboard/src/components/local-editor/LocalEditorFeaturePanel.jsx` (does not exist yet)

- [ ] **Step 1: Write the failing test.**

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocalEditorFeaturePanel from "./LocalEditorFeaturePanel";

describe("LocalEditorFeaturePanel", () => {
  it("renders a labelled, scrollable feature region around its content", () => {
    render(
      <LocalEditorFeaturePanel title="Subtitles">
        <div data-testid="subtitle-controls">Subtitle controls</div>
      </LocalEditorFeaturePanel>,
    );

    const panel = screen.getByRole("region", { name: "Subtitles" });
    expect(panel).toHaveAttribute("data-testid", "local-editor-feature-panel");
    expect(panel).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("subtitle-controls")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected red failure.**

```bash
npm test -- src/components/local-editor/LocalEditorFeaturePanel.test.jsx
```

Expected: Vitest fails because `./LocalEditorFeaturePanel` is not defined yet.

## Task 4: Implement the feature-panel shell

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorFeaturePanel.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorFeaturePanel.test.jsx`

- [ ] **Step 1: Add the minimal panel implementation.**

```jsx
export default function LocalEditorFeaturePanel({ title, children }) {
  return (
    <section
      data-testid="local-editor-feature-panel"
      aria-label={title}
      className="min-h-0 overflow-y-auto border-b border-white/10 bg-[#111114] p-4 lg:border-b-0 lg:border-r"
    >
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Run the focused test and confirm green.**

```bash
npm test -- src/components/local-editor/LocalEditorFeaturePanel.test.jsx
```

Expected: the panel test passes.

- [ ] **Step 3: Commit the isolated panel shell.**

```bash
git add dashboard/src/components/local-editor/LocalEditorFeaturePanel.jsx dashboard/src/components/local-editor/LocalEditorFeaturePanel.test.jsx
git commit -m "feat: add local editor feature panel shell"
```

## Task 5: Add failing LocalEditorTab integration tests

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Reference: existing test setup in the same file, including the RemotionPreview mock and `describe("LocalEditorTab")`.

- [ ] **Step 1: Add tests for rail switching and persistent editor regions.**

Add these tests inside the existing `describe("LocalEditorTab")` block:

```jsx
  it("switches feature panels while keeping the player and timeline mounted", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("local-editor-player")).toBeInTheDocument(),
    );

    const player = screen.getByTestId("local-editor-player");
    const timeline = screen.getByTestId("local-editor-timeline-scroll");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Subtitles" }));

    expect(screen.getByRole("button", { name: "Subtitles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("local-editor-player")).toBe(player);
    expect(screen.getByTestId("local-editor-timeline-scroll")).toBe(timeline);
    expect(screen.getByRole("region", { name: "Subtitles" })).toBeInTheDocument();
  });

  it("selects the Project feature and keeps supplied project actions in the context area", () => {
    render(
      <LocalEditorTab
        sidePanel={<div data-testid="project-side-panel">Project actions</div>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Project" }));

    expect(screen.getByTestId("project-side-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("region", { name: "Project context" })).toContainElement(
      screen.getByTestId("project-side-panel"),
    );
  });
```

- [ ] **Step 2: Run the focused integration tests and confirm the expected red failure.**

```bash
npm test -- src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests fail because the feature rail and feature panel do not exist yet. Existing tests may continue to pass; the new failures must be attributable to the missing layout behavior rather than test setup errors.

## Task 6: Integrate the rail and panel without changing editor behavior

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Read before editing: `dashboard/src/components/editor/FullScreenEditor.jsx:925-1015` to preserve the `sidePanel` and `footer` contracts.

Before editing, rerun the required GitNexus blast-radius check:

```text
impact({ repo: "openshorts", target: "LocalEditorTab", direction: "upstream" })
```

The known risk is HIGH: direct callers are `App` and `FullScreenEditor`, with six impacted symbols across three modules. Do not change the public props or move persistence/playback handlers into the new presentational components.

- [ ] **Step 1: Add the feature-shell imports and view state.**

Add beside the existing local-editor imports:

```jsx
import LocalEditorFeaturePanel from "./LocalEditorFeaturePanel";
import LocalEditorFeatureRail, {
  LOCAL_EDITOR_FEATURES,
} from "./LocalEditorFeatureRail";
```

Add beside the existing view-only `useState` values:

```jsx
const [activeFeature, setActiveFeature] = useState("details");
const activeFeatureLabel =
  LOCAL_EDITOR_FEATURES.find(({ id }) => id === activeFeature)?.label ||
  "Details";
```

Do not add `activeFeature` to `editHistory`, `initialEditorState`, `onStateChange`, or any persistence payload.

- [ ] **Step 2: Extract the current feature content into the selected feature panel.**

Use the existing JSX blocks unchanged as children of the new panel:

- The current `ClipMetadataPanel` block at `LocalEditorTab.jsx:2338-2346` becomes the `details` branch.
- The current subtitle settings section beginning at `LocalEditorTab.jsx:2649` and ending at its `SubtitleStyleInspector` becomes the `subtitles` branch. Keep all existing handlers, refs, loading states, labels, and disabled conditions.
- The current Viral Hook section beginning at `LocalEditorTab.jsx:2878` and ending at its `HookInspector` branches becomes the `viral-hook` branch.
- The current `sidePanel` render at the end of the inspector remains the persistent right context content. The `project` feature branch renders a short project-context explanation in the left panel so the action/version controls are not duplicated.

The branch wrapper should follow this shape so the selected panel has one stable accessible region. The subtitle and hook branches contain the unchanged JSX blocks identified above; only their parent location changes:

```jsx
<LocalEditorFeaturePanel title={activeFeatureLabel}>
  {activeFeature === "details" && (
    <ClipMetadataPanel
      clip={clipMetadata}
      subtitleCues={subtitleCues}
      hashtags={clipMetadata?.hashtags}
      onHashtagsChange={onHashtagsChange}
    />
  )}
  {activeFeature === "subtitles" && subtitleFeatureContent}
  {activeFeature === "viral-hook" && hookFeatureContent}
  {activeFeature === "project" && (
    <p className="text-xs leading-5 text-zinc-500">
      Project actions and version history are available in the context panel to the right.
    </p>
  )}
</LocalEditorFeaturePanel>
```

Replace the old always-visible left metadata block and right inspector feature sections with this selected feature panel. Keep the supplied `sidePanel` rendered once in a persistent right context area with `aria-label="Project context"`; do not render duplicate action/version controls in the Project feature panel.

- [ ] **Step 3: Recompose the workbench grid while keeping player and timeline outside the branch.**

Use a desktop-first grid with the rail, feature panel, player, and optional context area, then make the subtitle workspace span the full width:

```jsx
<div className="grid min-h-0 gap-4 p-4 lg:grid-cols-[auto_minmax(240px,300px)_minmax(0,1fr)] xl:grid-cols-[auto_minmax(260px,320px)_minmax(0,1fr)_320px]">
  <LocalEditorFeatureRail
    activeFeature={activeFeature}
    onSelect={setActiveFeature}
  />
  <LocalEditorFeaturePanel title={activeFeatureLabel}>
    {renderFeatureContent()}
  </LocalEditorFeaturePanel>
  <main className="min-w-0 space-y-4">{playerRegion}</main>
  <aside className="min-w-0 space-y-4" aria-label="Project context">
    {sidePanel || (
      <p className="rounded-xl border border-white/10 bg-white/[.02] p-4 text-xs leading-5 text-zinc-500">
        Open the editor from a project to see project actions and version history.
      </p>
    )}
  </aside>
  <section className="min-w-0 lg:col-span-3 xl:col-span-4">
    {subtitleWorkspace}
  </section>
</div>
```

In the implementation, `renderFeatureContent()` returns the four branches above, `playerRegion` means the current player JSX block at `LocalEditorTab.jsx:2348-2608`, and `subtitleWorkspace` means the current Timeline/Cue table JSX block at `LocalEditorTab.jsx:2609-2647`. Keep the player `data-testid="local-editor-player"`, keyboard handlers, fullscreen behavior, and all playback callbacks unchanged. Keep `LocalEditorTimeline`/`SubtitleCueTable` conditional unchanged and outside the feature branch so switching rail buttons does not unmount it. Keep the save-project dialog, projects dialog, subtitle cue modal, error/notices, and footer outside this grid so they retain their existing overlay/placement behavior.

- [ ] **Step 4: Run the focused integration tests and confirm green.**

```bash
npm test -- src/components/local-editor/LocalEditorFeatureRail.test.jsx src/components/local-editor/LocalEditorFeaturePanel.test.jsx src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new rail, panel, and integration tests pass, and all existing `LocalEditorTab` tests pass.

- [ ] **Step 5: Commit the integrated layout.**

```bash
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx dashboard/src/components/local-editor/LocalEditorFeatureRail.jsx dashboard/src/components/local-editor/LocalEditorFeatureRail.test.jsx dashboard/src/components/local-editor/LocalEditorFeaturePanel.jsx dashboard/src/components/local-editor/LocalEditorFeaturePanel.test.jsx
git commit -m "feat: recompose local editor with interactive feature rail"
```

## Task 7: Run repository-mandated dashboard verification

**Files:**
- Verify: `dashboard/src/` and the complete dashboard test suite.

- [ ] **Step 1: Format the dashboard source.**

Run from `dashboard`:

```bash
npm run format
```

Expected: Prettier completes successfully and only formats dashboard source files.

- [ ] **Step 2: Verify formatting.**

```bash
npm run format:check
```

Expected: every checked source file reports formatted.

- [ ] **Step 3: Run lint.**

```bash
npm run lint
```

Expected: ESLint exits 0 with no warnings because the project treats warnings as errors.

- [ ] **Step 4: Run the complete dashboard test suite.**

```bash
npm test
```

Expected: Vitest exits 0 with zero failed tests.

- [ ] **Step 5: Build the dashboard.**

```bash
npm run build
```

Expected: Vite produces a production build and exits 0.

## Task 8: Verify the visual layout in Brave and inspect change impact

**Files:**
- Verify: the running local editor in Brave; no source changes expected in this task.

- [ ] **Step 1: Start the dashboard using the repository's normal local development command.**

From `dashboard`:

```bash
npm run dev -- --host 127.0.0.1
```

Open the printed local URL in Brave. Use a local editor project with a video, subtitles, and a hook so all four rail views have meaningful content.

- [ ] **Step 2: Verify the approved interaction sequence manually in Brave.**

Confirm all of the following:

1. Details is selected on first render.
2. Clicking Subtitles, Viral Hook, and Project updates the left feature panel and active rail styling.
3. The player stays visible and does not reset playback position while switching views.
4. The subtitle timeline/cue table remains visible and keeps its selected cue/playhead state.
5. Subtitle and hook editing still updates the preview.
6. Export Video, Export Subtitles, Reset, Close, Projects, action buttons, and version history remain usable.
7. At a narrower viewport, the rail becomes a compact horizontal control row without hiding the player or timeline.

- [ ] **Step 3: Run the required GitNexus pre-commit change-impact check.**

```text
detect_changes({ repo: "openshorts", scope: "all" })
```

Expected: changed symbols are limited to the local-editor shell/tests, and affected flows are limited to the expected `LocalEditorTab`/`FullScreenEditor`/`App` paths. Investigate any unexpected symbol or process before committing.

- [ ] **Step 4: Review the final diff and status.**

```bash
git diff --check
git status --short
git diff --stat HEAD~1
```

Expected: no whitespace errors, only the planned files are changed, and the final diff matches the approved design.
