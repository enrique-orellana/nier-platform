# Viral Hook Inspector Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Local Editor Viral Hook inspector into clear content, layout, timing, and appearance sections without changing any control behavior.

**Architecture:** Keep `LocalEditorHookInspector` as the single owner of the existing hook controls and callbacks. Add semantic section wrappers and spacing/grid classes only; do not change hook state updates, defaults, or data shape. Add a focused component test that verifies the section hierarchy and preserves the existing accessible controls.

**Tech Stack:** React, JSX, Tailwind utility classes, Vitest, Testing Library, Prettier, ESLint, pnpm.

---

### Task 1: Add the failing layout hierarchy test

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx`
- Reference: `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`

- [ ] **Step 1: Write the failing test**

Create a focused test that renders a complete hook and asserts that the inspector exposes four named sections plus the existing controls:

```jsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorHookInspector from "./LocalEditorHookInspector";

const hook = {
  id: "hook",
  text: "Stop scrolling",
  startMs: 0,
  endMs: 3000,
  position: "top",
  size: "M",
  entranceAnimation: "spring",
  color: "#FFFFFF",
  fontSize: 48,
  background: "#111111",
};

describe("LocalEditorHookInspector", () => {
  it("groups hook controls into content, layout, timing, and appearance sections", () => {
    render(
      <LocalEditorHookInspector
        hook={hook}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Viral Hook" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Content" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Timing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();

    expect(screen.getByLabelText("Hook text")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook duration")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook start")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook end")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook font size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Hook" })).toBeInTheDocument();

    expect(within(screen.getByRole("heading", { name: "Layout" }).parentElement.parentElement).getByRole("button", { name: "Top" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `dashboard`:

```powershell
pnpm test -- src/components/local-editor/LocalEditorHookInspector.test.jsx
```

Expected: FAIL because the current inspector has no `Content`, `Layout`, `Timing`, or `Appearance` headings.

### Task 2: Implement the sectioned layout

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`

- [ ] **Step 1: Add semantic section headings and wrappers**

Keep the existing `onChange` calls, labels, aria-labels, preset loops, and remove callback unchanged. Restructure the returned JSX into:

```jsx
<div className="space-y-6">
  <div>
    <h3 className="text-sm font-bold text-white">Viral Hook</h3>
    <section aria-labelledby="hook-content-heading" className="mt-4 space-y-3">
      <h4 id="hook-content-heading" className={sectionHeadingClass}>Content</h4>
      {/* existing Text textarea */}
    </section>
  </div>

  <section aria-labelledby="hook-layout-heading" className={sectionClass}>
    <h4 id="hook-layout-heading" className={sectionHeadingClass}>Layout</h4>
    {/* existing Position, Size, and Entrance controls */}
  </section>

  <section aria-labelledby="hook-timing-heading" className={sectionClass}>
    <h4 id="hook-timing-heading" className={sectionHeadingClass}>Timing</h4>
    {/* existing Duration slider and Start/End inputs */}
  </section>

  <section aria-labelledby="hook-appearance-heading" className={sectionClass}>
    <h4 id="hook-appearance-heading" className={sectionHeadingClass}>Appearance</h4>
    {/* existing Text color, font Size, and Background controls */}
  </section>

  <div className="border-t border-white/10 pt-4">
    {/* existing Remove Hook button */}
  </div>
</div>
```

Use local constants near the component for consistent styling:

```jsx
const sectionClass = "space-y-3 border-t border-white/10 pt-4";
const sectionHeadingClass =
  "text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500";
```

Keep the existing two-column grids for Start/End and font Size/Background, and keep the three-column/two-column option grids for the layout and entrance controls. This preserves the current interaction density while making the group boundaries visible.

- [ ] **Step 2: Run the focused test to verify it passes**

Run:

```powershell
pnpm test -- src/components/local-editor/LocalEditorHookInspector.test.jsx
```

Expected: PASS.

### Task 3: Verify the dashboard and live layout

**Files:**
- Verify: `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx`

- [ ] **Step 1: Run formatting and lint checks**

Run from `dashboard`:

```powershell
pnpm run format
pnpm run format:check
pnpm run lint
```

Expected: all commands complete successfully with no formatting or lint errors.

- [ ] **Step 2: Run the complete dashboard test suite**

Run:

```powershell
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Inspect the live editor in Brave**

Open the supplied local editor URL, select the Viral Hook feature, and confirm visually that:

- Content is the first group.
- Layout, Timing, and Appearance are separated by clear headings and borders.
- Appearance color controls no longer compete with timing controls.
- Remove Hook remains at the bottom as a separated destructive action.
- Existing controls still update the hook normally.

- [ ] **Step 4: Run GitNexus change detection**

From the repository root, run the GitNexus `detect_changes` check with scope `unstaged` after implementation. Confirm that only the intended inspector and focused test are affected before reporting completion.

