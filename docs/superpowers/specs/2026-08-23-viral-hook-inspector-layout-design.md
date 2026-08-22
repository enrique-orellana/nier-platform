# Viral Hook Inspector Layout Design

## Goal

Improve the visual hierarchy of the Viral Hook settings panel in the local editor without changing any controls, values, or behavior.

## Design

The inspector remains a single-column panel optimized for its narrow width. Controls are grouped into four scan-friendly areas:

1. Hook content: the existing text textarea remains first because it is the primary task.
2. Layout: Position, Size, and Entrance controls are grouped together with consistent spacing.
3. Timing: Duration remains the primary timing control, followed by Start and End inputs in a compact two-column row.
4. Appearance: Text color, numeric font size, and Background are grouped together. Color presets keep their current controls and behavior.

The Remove Hook action remains last and is visually separated as a destructive action.

## Constraints

- Preserve every existing control, label, preset, input, and callback behavior.
- Do not change hook data shape, defaults, persistence, or rendering.
- Use the existing utility classes and local editor styling conventions.
- Keep the layout responsive within the inspector width.

## Verification

- Add a focused component test that verifies the section hierarchy and that existing hook controls remain available.
- Run the focused test and the full dashboard test suite.
- Run `pnpm run format`, `pnpm run format:check`, and `pnpm run lint` from `dashboard`.
- Inspect the live editor in Brave at the supplied local URL.
