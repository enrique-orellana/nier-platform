# Shadcn UI Migration Implementation Plan

> **For agentic workers:** Execute task by task in the current checkout. Preserve editor/media behavior. Do not create tests unless the user asks; use the repository-required formatter/linter and build checks, plus focused Brave visual review.

**Goal:** Migrate all dashboard-served user-facing pages to a reusable shadcn/ui-based component system while preserving the OpenShorts dark theme, current flows, and editor/media behavior.

**Architecture:** Add locally owned JSX primitives in `dashboard/src/components/ui/`, powered by Radix UI where interactive accessibility primitives are needed, with `cn()`/CVA helpers and CSS-variable theme tokens compatible with Tailwind 3. Migrate the app in surface-sized groups. Keep data/state/business logic and specialized Remotion/media/timeline internals intact.

**Tech Stack:** React 18, JavaScript/JSX, Vite 5, Tailwind CSS 3, Radix UI, class-variance-authority, clsx, tailwind-merge, Lucide React.

**Design spec:** `docs/superpowers/specs/2026-11-11-shadcn-ui-migration-design.md`

## File and Component Structure

### Shared foundation

- Modify: `dashboard/package.json` and lockfile
  Responsibility: add only the Radix primitives and styling utilities required by the migrated controls; keep existing React, Vite, and Tailwind major versions.
- Modify: `dashboard/tailwind.config.js` and `dashboard/src/index.css`
  Responsibility: map semantic CSS variables to the existing dark colors and focus treatment while retaining editor-specific scrollbar and animation rules.
- Create: `dashboard/src/lib/utils.js`
  Responsibility: export `cn()` using `clsx` and `tailwind-merge`.
- Create: `dashboard/src/components/ui/` primitives
  Responsibility: own reusable Button, Card, Badge, Input, Textarea, Label, Select, Checkbox, Switch, Slider, Tabs, Dialog, Dropdown Menu, Tooltip, Popover, Scroll Area, Separator, and Progress primitives that are confirmed in use. Add variants and composition helpers only when needed.

### User-facing surfaces to migrate

- Modify: `dashboard/src/Landing.jsx`, `dashboard/src/Legal.jsx`, `dashboard/src/Root.jsx`
  Responsibility: migrate shared links/actions and any page controls; preserve route and landing-launch behavior.
- Modify: `dashboard/src/App.jsx` and `dashboard/src/App.css`
  Responsibility: migrate the app shell, navigation, shared form/control surfaces, and top-level dialogs without rewriting data fetching or workflow state.
- Modify: `dashboard/src/components/*.jsx` (32 files) and `dashboard/src/components/ResultCard/*.jsx` (18 files)
  Responsibility: migrate shared generation, library, performance, settings, result, and modal surfaces using common primitives.
- Modify: `dashboard/src/components/editor/*.jsx` (21 files)
  Responsibility: migrate editor panels, toolbar controls, menus, forms, and dialogs; leave the Remotion player and specialized canvas/timeline rendering internals alone.
- Modify: `dashboard/src/components/local-editor/*.jsx` (29 files)
  Responsibility: migrate local-editor chrome, controls, dialogs, and settings while preserving editing state, shortcuts, and media rendering.
- Modify: `dashboard/src/index.css` and `dashboard/src/App.css` after all consumers move
  Responsibility: remove superseded generic `.btn-primary`/`.input-field` and duplicate control styling; retain domain-specific glass, media, timeline, and scrollbar styling where still used.

## Execution Rules

- Work inline on the current `main` checkout; do not create a worktree or branch unless the user asks.
- Before editing an existing function/component symbol, use the configured GitNexus/codegraph impact tool for that symbol. Report any high/critical blast radius before editing. If the indexed tool is unavailable, record that limitation and rely on focused import/call-site searches rather than claiming an analysis ran.
- Preserve existing state, callback props, API calls, route handling, shortcuts, and generated output. Convert only presentation/interaction wrappers.
- Do not make an unrelated Tailwind or React upgrade.
- Do not add or run tests unless the user asks. Follow the repository's mandatory dashboard formatting/linting checks and run the production build after migration.
- Use Brave for any visual review. If the Brave browser surface is unavailable, report that and use static validation only.
- Keep each migration slice coherent and inspect the diff before moving to the next slice.

## Tasks

### 1. Inventory and baseline

- [x] Inventory generic buttons, inputs, selects, tabs, switches, dialogs, dropdowns, and global control classes across dashboard JSX files.
- [x] Map generic control usage to shared primitives and identify media/timeline surfaces to preserve.
- [x] Record the working tree and inspect the dashboard lockfile; it was stale (Vite 4 resolved while the manifest required Vite 5), so reconcile it with the manifest and UI dependencies.
- [x] Confirm CSS token usage and keep relative imports; leave Vite proxy configuration unchanged.

### 2. Add the shadcn foundation

- [x] Add `cn()` plus `class-variance-authority`, `clsx`, and `tailwind-merge`.
- [x] Add React 18-compatible Radix packages for the shared UI layer.
- [x] Add Tailwind 3-compatible semantic theme variables using relative imports.
- [x] Implement reusable controls with explicit variants, focus/disabled states, and dark-theme colors.
- [x] Preserve editor animations, scrollbars, timeline overflow rules, and component callbacks.
- [x] Run the production build successfully after establishing the foundation.

### 3. Migrate shared shell and public pages

- [x] Migrate landing/legal controls and cards to shared components where applicable; Root had no generic controls to migrate.
- [x] Migrate app shell and navigation controls without moving workflow state.
- [x] Preserve route parsing, hash navigation, launch behavior, responsive layout, and existing callback semantics through presentation-only edits.
- [ ] Inspect the public pages and main shell in Brave at desktop and narrow widths.

### 4. Migrate general dashboard and result surfaces

- [x] Migrate generic controls in reusable components and ResultCard surfaces; migrate standard modal flows to Dialog primitives while retaining the pointer-through subtitle-cue inspector.
- [x] Use shared buttons, fields, selects, cards, and status badges in generator, AI, library, performance, and settings screens.
- [x] Preserve generation requests, provider selection, project persistence, result actions, and existing modal dismissal behavior.
- [x] Search for remaining native controls; they remain in tests and shared primitive implementations. The contextual subtitle-cue inspector remains custom to preserve pointer-through editing.
- [ ] Inspect primary dashboard workflows in Brave.

### 5. Migrate editor and local-editor chrome

- [x] Migrate generic controls in editor panels while retaining timeline and preview rendering internals.
- [x] Migrate generic controls in local-editor panels while retaining timeline and media rendering internals.
- [x] Keep media preview, Remotion canvas, waveform, track rendering, timeline geometry, keyboard shortcuts, and rendering logic unchanged.
- [ ] Compare editor interactions before and after each slice, including opening/closing panels, selecting media, adjusting controls, timeline navigation, and export initiation.
- [ ] Inspect the editor in Brave at its normal workspace size and a narrow viewport.

### 6. Remove superseded styles and finish the migration

- [x] Confirm user-facing native buttons, inputs, textareas, and selects use `components/ui`; remaining native markup is test code or primitive internals.
- [x] Remove superseded `.btn-primary` and `.input-field` styles after confirming there are no remaining consumers.
- [x] Keep domain visuals, glass treatments, animation, scrollbars, and media-specific CSS that still have consumers.
- [x] Run `npm run format`, `npm run format:check`, `npm run lint`, and `npm run build` from `dashboard`.
- [x] Review the final diff; changes are limited to UI wrappers, styles, dependencies, and the migration documents.
- [ ] If a code commit is requested, review staged scope and run the required GitNexus change detection before committing.

## Definition of Done

- Every user-facing page and shared generic interactive surface uses the same locally owned shadcn-style primitives and theme tokens.
- Generic button, input, select, tab, switch, menu, and dialog patterns are consistent; remaining custom controls have a specific domain reason.
- Current routes, workflows, keyboard behavior, editor behavior, and rendered media remain intact.
- Desktop and narrow layouts are visually checked in Brave when available.
- Required formatter, lint, and build checks pass; no unrelated files are included in the final changes.



## Implementation status

- Generic buttons, inputs, textareas, and selects in app source use shared primitives; native markup remains only in tests and component implementations.
- Shared Button, Input, Textarea, NativeSelect, Card, Badge, and Dialog components are adopted across public pages, dashboard screens, and editor chrome. Full-screen editor surfaces, timelines, and the pointer-through subtitle-cue inspector keep their domain-specific wrappers.
- Format, lint, and production build pass. Brave visual review could not run because the browser access host was unavailable in this session.
