# Version History Tree and Generated Clip Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render editor versions as a parent/child tree and provide a new-tab link to each completed version's generated clip.

**Architecture:** Keep the existing `VersionHistory` component and API contract. Add a pure hierarchy transformation that maps `parent_version_id` to nested children, then render the existing row controls recursively. Use `getApiUrl(version.output_url)` for completed-version media links so relative and absolute output URLs both work.

**Tech Stack:** React, JSX, Tailwind utility classes, Lucide React icons, Vitest, Testing Library, pnpm.

---

### Task 1: Add failing Version History tree and link tests

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] **Step 1: Run the existing focused test before changes**

Run from `dashboard`:

```bash
pnpm exec vitest run src/components/editor/VersionHistory.test.jsx
```

Expected: existing tests pass before the new assertions are added.

- [ ] **Step 2: Add a failing parent/child tree test**

Add a test with a root and child version and assert that the child row is nested in a container marked as a tree group, while the root and child labels are both visible:

```jsx
it("renders child versions beneath their parent", () => {
  render(
    <VersionHistory
      versions={[
        { version_id: "root-version", status: "done" },
        {
          version_id: "child-version",
          parent_version_id: "root-version",
          status: "pending",
        },
      ]}
    />,
  );

  const root = screen.getByText("vroot-v").closest("[data-version-node]");
  const child = screen.getByText("vchild-").closest("[data-version-node]");

  expect(root).toBeInTheDocument();
  expect(child).toBeInTheDocument();
  expect(child.parentElement).toHaveAttribute("role", "group");
});
```

- [ ] **Step 3: Add a failing generated-clip link test**

Add a test using a completed version with a relative output URL and assert the link opens in a new tab with the accessible label and normalized href:

```jsx
it("opens a completed version's generated clip in a new tab", () => {
  render(
    <VersionHistory
      versions={[
        {
          version_id: "ready-version",
          status: "done",
          output_url: "/videos/job/ready.mp4",
        },
      ]}
    />,
  );

  const link = screen.getByRole("link", {
    name: /open generated clip for version ready-version/i,
  });

  expect(link).toHaveAttribute("href", "/videos/job/ready.mp4");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer");
});
```

- [ ] **Step 4: Add a failing no-link test for incomplete output**

Assert that pending and failed versions do not expose an “Open generated clip” link, even if an incomplete record happens to carry no usable output URL:

```jsx
it("does not show a generated clip link for incomplete versions", () => {
  render(
    <VersionHistory
      versions={[{ version_id: "pending-version", status: "pending" }]}
    />,
  );

  expect(screen.queryByRole("link", { name: /open generated clip/i })).toBeNull();
});
```

- [ ] **Step 5: Run the tests and verify the new tests fail for missing behavior**

Run:

```bash
pnpm exec vitest run src/components/editor/VersionHistory.test.jsx
```

Expected: the existing tests pass and the new tree/link assertions fail because the current component renders a flat list and has no generated-clip link.

### Task 2: Implement hierarchy rendering and generated clip links

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.jsx`

- [ ] **Step 1: Run GitNexus impact analysis before editing the component**

Use GitNexus upstream impact analysis for the `VersionHistory` component in `dashboard/src/components/editor/VersionHistory.jsx`. Review direct consumers and warn if the result is HIGH or CRITICAL before proceeding. The component is used by both the full-screen editor and the legacy clip editor, so preserve its existing props and callbacks.

- [ ] **Step 2: Add the minimal tree-building transformation**

Create a local pure helper that indexes versions by `version_id`, assigns each version to its parent's `children` array when the parent exists, and treats missing-parent records as roots. Preserve the incoming order for roots and children.

Use this shape:

```jsx
const buildVersionTree = (versions) => {
  const nodes = new Map(
    versions.map((version) => [version.version_id, { version, children: [] }]),
  );
  const roots = [];

  for (const node of nodes.values()) {
    const parent = nodes.get(node.version.parent_version_id);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
};
```

- [ ] **Step 3: Render nodes recursively with accessible tree groups**

Replace the flat `versions.map(...)` block with a recursive node renderer. Give the outer list `role="tree"`, each row `role="treeitem"`, `aria-level`, and nested child containers `role="group"`. Retain the existing select, Branch, and Delete callbacks and styling, adding only indentation/connector classes for nested nodes.

- [ ] **Step 4: Add the generated clip action**

Import `ExternalLink` from `lucide-react` and `getApiUrl` from `../../config`. Render a separate anchor only when `version.status === "done" && version.output_url`:

```jsx
<a
  aria-label={`Open generated clip for version ${version.version_id}`}
  className="..."
  href={getApiUrl(version.output_url)}
  rel="noreferrer"
  target="_blank"
  title="Open generated clip"
>
  <ExternalLink size={14} />
</a>
```

Keep the anchor separate from the version-selection button so opening the clip never loads the version in the current tab.

- [ ] **Step 5: Run the focused test until green**

Run:

```bash
pnpm exec vitest run src/components/editor/VersionHistory.test.jsx
```

Expected: all VersionHistory tests pass.

### Task 3: Format, lint, and inspect the feature diff

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.jsx`
- Modify: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] **Step 1: Run dashboard formatting**

From `dashboard` run:

```bash
pnpm run format
pnpm run format:check
```

Expected: both commands exit successfully and `format:check` reports no formatting changes.

- [ ] **Step 2: Run dashboard lint**

Run:

```bash
pnpm run lint
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Review the diff and confirm unrelated changes remain unstaged**

Run from the repository root:

```bash
git diff -- dashboard/src/components/editor/VersionHistory.jsx dashboard/src/components/editor/VersionHistory.test.jsx
git status --short
```

Confirm only the VersionHistory implementation and test are part of this feature; preserve all unrelated user edits.

### Task 4: Detect changes and commit the implementation

- [ ] **Step 1: Stage only the implementation and tests**

```bash
git add dashboard/src/components/editor/VersionHistory.jsx dashboard/src/components/editor/VersionHistory.test.jsx
```

- [ ] **Step 2: Run GitNexus staged change detection**

Run GitNexus `detect_changes({ scope: "staged", repo: "openshorts" })`. Confirm the changed files and affected scope match VersionHistory and its known editor consumers. If the result is HIGH or CRITICAL, report it before committing.

- [ ] **Step 3: Commit the implementation**

```bash
git commit -m "Show version history as a tree"
```

- [ ] **Step 4: Verify the commit and preserved worktree state**

```bash
git log -1 --oneline
git status --short
```

Expected: the new implementation commit is `HEAD`, and unrelated pre-existing edits remain unstaged and untouched.
