# Shadcn UI Migration Design

**Status:** Approved for implementation
**Date:** 2026-11-11
**Scope approval:** The user approved migrating all user-facing pages, using reusable shadcn-style primitives, retaining the existing dark palette, migrating progressively, and preserving editor/media behavior.

## Goal

Migrate the complete OpenShorts user interface to a consistent, locally owned component system based on shadcn/ui. The public landing and legal pages, application shell, all dashboard screens, dialogs, and video-editor chrome should share accessible, reusable controls and consistent visual states.

The migration is a UI implementation change. It must preserve existing workflows, data, navigation, keyboard behavior, media editing, and rendering behavior.

## Current context

- The dashboard is a React 18 and Vite application using JavaScript/JSX and Tailwind CSS 3.
- The interface currently relies on hand-written Tailwind markup and a small set of custom CSS classes. There is no existing shadcn/ui or Radix component layer.
- The dashboard includes the public landing and legal pages, generation and project views, performance and settings screens, dialogs, and a large video editor with specialized media and timeline surfaces.
- The project already uses Lucide icons and has a dark visual theme with navy surfaces, sky-blue primary accents, purple secondary accents, and Outfit/Inter typography.

## Design decision

Add shadcn/ui conventions as source code owned by this repository rather than introducing a separately versioned component package. Use a shared `components/ui` layer for generic controls and composed primitives, plus a small class-name utility. Keep React, Vite, Tailwind CSS 3, and the current icon library in place; do not combine this work with a React or Tailwind major-version upgrade.

The first implementation wave will establish tokens and a small set of high-use primitives. Subsequent waves will migrate user-facing screens and editor chrome one surface at a time. Each surface keeps its existing layout and interactions unless a local inconsistency must be corrected to make the shared component usable.

The visual system will retain the existing dark palette, typography, spacing rhythm, and distinctive OpenShorts styling. shadcn conventions supply consistency and accessibility, not a wholesale default-theme replacement.

## Component and styling architecture

- `dashboard/src/components/ui/` contains reusable primitives such as Button, Card, Badge, Input, Textarea, Label, Select, Checkbox, Switch, Slider, Tabs, Dialog, Dropdown Menu, Tooltip, Popover, Scroll Area, Separator, and Progress as required by actual screens.
- `dashboard/src/lib/utils.js` exposes a `cn()` helper built from `clsx` and `tailwind-merge`, and is the common way to compose variants and caller-provided classes.
- Components use variant definitions for shared intent and size (for example, button variants), semantic HTML, visible keyboard focus, disabled/loading states, and accessible names.
- Radix UI primitives are used for interactive controls that need managed focus, keyboard navigation, portals, or dismissal behavior. Existing Lucide icons remain the icon source.
- Theme values are mapped through CSS variables and Tailwind 3-compatible configuration. Existing app-specific classes are retained only for domain visuals that do not belong in generic controls.
- The shadcn CLI or generated source may be used only when its output is compatible with this repository's React 18, JSX, and Tailwind 3 setup; otherwise, add the corresponding local component source and configuration manually. Do not silently upgrade the styling stack to satisfy a newer generator preset.

## Migration scope

### Included

1. Public landing and legal pages served by the dashboard.
2. Application shell, navigation, global menus, notifications, and shared layout surfaces.
3. Generator, AI Agent, projects/library, performance, and settings screens.
4. Shared modals, confirmations, menus, forms, empty/loading/error states, and result cards.
5. Video-editor surrounding controls, panels, toolbars, settings, menus, and dialogs.
6. Responsive layouts, keyboard access, focus treatment, and state styling across these pages.

### Domain-specific visuals to preserve

The migration will not replace or restyle the internals of the Remotion player, video preview, canvas, timeline rendering surface, waveform/media output, or other specialized editing visuals with generic UI primitives. Their surrounding controls and containers will use the shared component system where appropriate. Existing editing and rendering behavior must remain unchanged.

### Out of scope

- Backend, API, data-model, or generation behavior changes.
- Product-flow changes or feature removals.
- React, Vite, Tailwind, or Remotion major upgrades.
- Rebranding, a new light theme, or a redesign of the product's visual identity.
- Replacing domain-specific charts, media canvases, previews, or timeline implementations with generic components.

## Migration sequence

1. **Foundation:** Add the local component paths/configuration, `cn()` utility, CSS variable tokens, focus-ring conventions, and initial primitives. Confirm the current application still builds before screen migration begins.
2. **Shared shell and simple public pages:** Migrate global navigation and shared layout, then landing/legal page controls and shared cards, badges, buttons, and form fields.
3. **Primary application screens:** Migrate generator, AI Agent, projects/library, performance, and settings screens. Consolidate repeated control patterns as each screen moves.
4. **Dialogs and result flows:** Migrate modal, dropdown, confirmation, result-card, notification, and loading/error interactions to accessible primitives, preserving existing callbacks and state transitions.
5. **Editor chrome:** Migrate the editor toolbar, panels, menus, controls, and dialogs. Keep preview/canvas/timeline/media rendering internals intact.
6. **Legacy cleanup:** Remove superseded generic styles and duplicate control implementations only after all in-scope consumers have moved. Keep domain-specific styling and behavior.

Each wave is independently reviewable and should leave the app usable. Avoid a single broad rewrite of `App.jsx` or the editor.

## Accessibility and interaction requirements

- Interactive primitives support keyboard use and preserve appropriate focus on open, close, and selection.
- Dialogs trap and restore focus correctly, expose a title/description to assistive technology, and retain existing dismissal behavior.
- Icon-only controls have accessible names; form controls have associated labels and useful validation/error announcements.
- Hover, focus-visible, disabled, active, loading, selected, and destructive states are visually distinct in the dark theme.
- Do not reduce contrast or rely on color alone to communicate status.
- Preserve existing responsive behavior and ensure new primitive defaults do not introduce overflow in editor or narrow layouts.

## Acceptance criteria

- Every user-facing page and shared interactive surface within the dashboard uses the common shadcn-based primitive layer for generic UI controls.
- No duplicate ad hoc button, input, select, switch, tab, menu, or dialog implementations remain in the migrated scope without a documented domain-specific reason.
- Existing product flows, URLs, state transitions, shortcuts, editor interactions, and rendering outputs are unchanged.
- All primitive variants visually follow the existing dark brand palette and type scale.
- Keyboard and focus behavior is usable for migrated controls, including menus and dialogs.
- The dashboard formats, lints, and builds successfully; focused UI verification covers each migrated page group and editor-critical controls.

## Risks and mitigations

- **Large surface area:** 112 JSX files are in scope. Migrate in small page groups and track completion so partially migrated controls remain intentional.
- **Editor regressions:** The editor has specialized interaction and rendering surfaces. Keep those implementations intact and migrate only surrounding controls; verify key editing flows after each editor wave.
- **Theme drift:** shadcn defaults can diverge from the existing visual system. Centralize semantic tokens before migrating pages and avoid per-screen overrides where a primitive variant is appropriate.
- **Behavior changes from accessible wrappers:** Radix primitives may change focus, dismissal, or portal behavior. Preserve current interaction requirements and review each conversion as a behavior-preserving refactor.
- **Version incompatibility:** Current shadcn setup guides may assume newer Tailwind defaults. Keep the existing Tailwind 3 toolchain unless a separate approved upgrade is proposed.

## Documentation references

- [shadcn/ui Vite installation guide](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui component catalog](https://ui.shadcn.com/docs/components)
- [shadcn/ui manual installation guide](https://ui.shadcn.com/docs/installation/manual)
